import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DEFAULT_THERMAL, simulateThermal, validateThermal } from '../src/architect/thermal.ts'
import { DEFAULT_POWER, simulatePower, generationFor } from '../src/architect/power.ts'
import { powerTradeoffs } from '../src/architect/tradeoffs.ts'
import { buildSeries, solve, CELL_PASS } from '../src/architect/solver.ts'
import type { SolarSeries } from '../src/architect/power.ts'

const SIGMA = 5.670374419e-8
let checks = 0
const check = (v: boolean, message: string) => { checks++; assert.ok(v, message) }
const near = (a: number, b: number, message: string, tol = 1e-6) => check(Math.abs(a - b) < tol, `${message}: ${a} vs ${b}`)

/** A constant-geometry solar series: dark (sun down, no flux) unless lit. */
const makeSolar = (n: number, lit: boolean): SolarSeries => ({
  azimuth: new Float64Array(n),
  elevation: Float64Array.from({ length: n }, () => (lit ? 90 : -90)),
  fraction: Float64Array.from({ length: n }, () => (lit ? 1 : 0)),
  fluxScale: Float64Array.from({ length: n }, () => 1),
})

// --- Steady-state hold: with no internal heat and no Sun, the heater exactly
//     balances radiation and the node holds the setpoint forever. ---
const dark = makeSolar(240, false)
const held = { ...DEFAULT_THERMAL, internalHeatFraction: 0 }
const qRad = held.radiativeCoeffM2 * SIGMA * (held.setpointK ** 4 - held.sinkK ** 4)
let run = simulateThermal(dark, 0, 48, held, 0, true)
near(run.minTempK, held.setpointK, 'Heater holds setpoint with no internal heat', 1e-6)
near(run.heaterW[0], qRad, 'Hourly heater equals radiative loss at setpoint', 1e-6)
near(run.heaterEnergyWh, qRad * 48, 'Heater energy integrates the steady loss', 1e-4)
check(run.pass && run.firstFreezeH === null, 'Held node survives')

// --- Freeze: zero heater, no Sun, no internal heat → node decays below survival. ---
run = simulateThermal(dark, 0, 200, { ...DEFAULT_THERMAL, internalHeatFraction: 0, heaterMaxW: 0 }, 0, true)
check(!run.pass && run.firstFreezeH !== null, 'No heater freezes the node')
check(run.minTempK < DEFAULT_THERMAL.survivalK, 'Minimum drops below survival')
check(run.points.every((p) => Number.isFinite(p.tempK) && p.tempK >= DEFAULT_THERMAL.sinkK - 1e-6), 'Cooling is finite and bounded below by the sink')
for (let i = 1; i < run.points.length; i++) check(run.points[i].tempK <= run.points[i - 1].tempK + 1e-9, 'Unheated node cools monotonically toward the sink')

// --- Monotonicity of heater energy in the physical parameters. ---
const base = simulateThermal(dark, 0, 100, held, 0)
check(simulateThermal(dark, 0, 100, { ...held, sinkK: held.sinkK - 30 }, 0).heaterEnergyWh > base.heaterEnergyWh - 1e-9, 'Colder sink needs at least as much heat')
check(simulateThermal(dark, 0, 100, { ...held, radiativeCoeffM2: held.radiativeCoeffM2 / 2 }, 0).heaterEnergyWh < base.heaterEnergyWh + 1e-9, 'Smaller radiator needs no more heat')
check(simulateThermal(dark, 0, 100, held, 500).heaterEnergyWh < base.heaterEnergyWh + 1e-9, 'Internal dissipation offsets heater demand')

// --- Sunlight warms: an illuminated absorbing surface reduces heater energy. ---
const lit = makeSolar(240, true)
check(simulateThermal(lit, 0, 100, { ...held, absorptivityAreaM2: 1 }, 0).heaterEnergyWh < base.heaterEnergyWh - 1e-9, 'Absorbed sunlight reduces heater demand')

// --- Stability with a large radiator (short time constant, stiff step). ---
run = simulateThermal(dark, 0, 100, { ...DEFAULT_THERMAL, internalHeatFraction: 0, heaterMaxW: 0, radiativeCoeffM2: 20 }, 0, true)
check(run.points.every((p) => Number.isFinite(p.tempK)), 'Stiff configuration stays finite (semi-implicit step)')
check(run.minTempK >= held.sinkK - 1e-6, 'Node never overshoots below the sink')

// --- Invalid inputs rejected. ---
assert.throws(() => validateThermal({ ...DEFAULT_THERMAL, survivalK: DEFAULT_THERMAL.setpointK + 10 }))
assert.throws(() => validateThermal({ ...DEFAULT_THERMAL, sinkK: DEFAULT_THERMAL.setpointK }))
assert.throws(() => simulateThermal(dark, 0, dark.elevation.length + 1, held, 0))
assert.throws(() => simulateThermal(dark, 0, 10, held, -1))

// --- Battery coupling: the heater series raises demand and can only remove windows. ---
const heater = Float64Array.from({ length: 10 }, () => 50)
const cfg = { ...DEFAULT_POWER, capacityWh: 1000, loadW: 100, initialPct: 100, chargeEfficiencyPct: 100, dischargeEfficiencyPct: 100 }
const noHeat = simulatePower(new Float64Array(10), 0, 10, cfg)
const withHeat = simulatePower(new Float64Array(10), 0, 10, cfg, false, heater)
near(withHeat.demandWh - noHeat.demandWh, 500, 'Heater draw adds exactly to battery demand')
check(withHeat.minPct <= noHeat.minPct + 1e-9, 'Heater draw cannot improve the battery')

const read = (p: string) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'))
const slug = 'malapert-massif'
const series = buildSeries(slug, read(`ephemeris/${slug}.sun.json`).rows, read(`ephemeris/${slug}.earth.json`).rows, read(`horizons/${slug}.json`))
const c = { missionDays: 7, minLitPct: 0, maxDarkH: 720, minLinkPct: 0, maxGapH: 720, power: { ...DEFAULT_POWER, capacityWh: 2000, loadW: 50 } }
const range = { firstStart: 0, lastStart: 2000, stepH: 12 }
const powered = solve([series], c, range)
const withThermal = solve([series], { ...c, thermal: { ...DEFAULT_THERMAL, heaterMaxW: 40 } }, range)
check(withThermal.passCount <= powered.passCount, 'Thermal survival only removes windows a battery alone accepted')
for (let i = 0; i < withThermal.starts.length; i++) {
  if (withThermal.strips[slug][i] === CELL_PASS) check(powered.strips[slug][i] === CELL_PASS, 'Every thermal-passing window also passes battery alone')
}

// --- Repair/heater consistency: a thermal-aware battery repair must actually
//     pass the same heater-included model the verdict uses (guards the bug where
//     powerTradeoffs ignored heater draw). ---
{
  const cfg = { ...DEFAULT_POWER, panelAreaM2: 0, loadW: 50, capacityWh: 1000, initialPct: 100, reservePct: 20, chargeEfficiencyPct: 100, dischargeEfficiencyPct: 100 }
  const tc = { ...DEFAULT_THERMAL, internalHeatFraction: 0 } // force the heater to run in the dark
  const gen = (c: typeof cfg) => generationFor(dark, c)
  const heaterFor = (c: typeof cfg) => simulateThermal(dark, 0, 120, tc, c.loadW).heaterW

  const aware = powerTradeoffs(dark, 0, 120, cfg, tc).find((t) => t.key === 'capacityWh')!.value
  check(aware !== null, 'Thermal-aware battery repair returns a value')
  const cAware = { ...cfg, capacityWh: aware! }
  check(simulatePower(gen(cAware), 0, 120, cAware, false, heaterFor(cAware)).pass, 'Thermal-aware repair passes the heater-included model')

  const naive = powerTradeoffs(dark, 0, 120, cfg).find((t) => t.key === 'capacityWh')!.value
  check(naive !== null && naive! < aware!, 'Ignoring heater underestimates the required battery')
  const cNaive = { ...cfg, capacityWh: naive! }
  check(!simulatePower(gen(cNaive), 0, 120, cNaive, false, heaterFor(cNaive)).pass, 'The heater-blind repair would fail once heater draw is included')
}

console.log(`Thermal survival checks passed (${checks} assertions plus invalid-input checks).`)
