import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { availableSunFraction, solarDiscFraction, eclipseFactor, SUN_RADIUS_DEG, EARTH_RADIUS_DEG, centerVisible, panelWattsPerM2 } from '../src/lib/science.ts'
import { DEFAULT_POWER, simulatePower, generationFor, validatePower } from '../src/architect/power.ts'
import { buildSeries, solve, evaluateWindow, CELL_PASS } from '../src/architect/solver.ts'

let checks = 0
const check = (v: boolean, message: string) => { checks++; assert.ok(v, message) }
const near = (a: number, b: number, message: string, tol = 1e-7) => check(Math.abs(a - b) < tol, `${message}: ${a} vs ${b}`)
near(solarDiscFraction(0, 0), 0.5, 'Half-disc at ridge')
near(solarDiscFraction(-SUN_RADIUS_DEG, 0), 0, 'Disc fully masked')
near(solarDiscFraction(SUN_RADIUS_DEG, 0), 1, 'Disc fully clear')
check(!centerVisible(0, 0) && centerVisible(0.0001, 0), 'Strict centre-clearance definition')
near(eclipseFactor(0, 0, 0, 0), 0, 'Total eclipse')
near(eclipseFactor(0, 0, 180, 0), 1, 'No eclipse')

// Independent numerical integration of the overlap of two angular circles.
for (const d of [0.70, 0.8, 0.95, 1.05, 1.2]) {
  let visibleArea = 0
  const dx = 2 * SUN_RADIUS_DEG / 20000
  for (let j = 0; j < 20000; j++) {
    const x = -SUN_RADIUS_DEG + (j + 0.5) * dx
    const sunHalf = Math.sqrt(Math.max(0, SUN_RADIUS_DEG ** 2 - x ** 2))
    const earthHalf = Math.sqrt(Math.max(0, EARTH_RADIUS_DEG ** 2 - (x - d) ** 2))
    visibleArea += 2 * Math.max(0, sunHalf - earthHalf) * dx
  }
  near(eclipseFactor(0, 0, d, 0), visibleArea / (Math.PI * SUN_RADIUS_DEG ** 2), 'Eclipse vs quadrature', 2e-5)
}
near(availableSunFraction(0, 0, 180, 0, 0), 0.5, 'Terrain partial sunlight preserved')
near(availableSunFraction(0, 0, 0, 0, -1), 0, 'Eclipse removes power despite terrain clearance')
near(panelWattsPerM2(90, 0.5), 1361 * 0.28 * 0.5, 'Partial disc scales electrical output')
near(panelWattsPerM2(-1), 0, 'Back of horizontal panel receives no direct power')

const config = { ...DEFAULT_POWER, capacityWh: 1000, initialPct: 100, reservePct: 20, loadW: 100, chargeEfficiencyPct: 100, dischargeEfficiencyPct: 100 }
let run = simulatePower(new Float64Array(10), 0, 10, config, true)
near(run.firstReserveH!, 8, 'Analytical reserve-crossing time')
near(run.endPct, 0, 'Ten hours depletes 1 kWh at 100 W')
near(run.unmetWh, 0, 'Exactly reaching zero supplies all requested energy')
check(!run.pass, 'Reserve breach fails even with no unmet load')
run = simulatePower(new Float64Array(12), 0, 12, config)
near(run.unmetWh, 200, 'Unmet energy after exhaustion')
near(run.firstUnmetH!, 10, 'Analytical depletion time')
check(!simulatePower(new Float64Array(12), 0, 12, { ...config, reservePct: 0 }).pass, 'Zero reserve cannot hide unmet load')
check(simulatePower(new Float64Array(8), 0, 8, config).pass, 'Exactly on reserve is accepted')
run = simulatePower(new Float64Array([200, 200]), 0, 2, { ...config, initialPct: 90, chargeEfficiencyPct: 50 })
near(run.endPct, 100, 'Charging includes conversion losses')
near(run.lossesWh, 100, 'Charge loss accounted')
run = simulatePower(new Float64Array([200, 200]), 0, 2, { ...config, initialPct: 95, chargeEfficiencyPct: 50 })
near(run.curtailedWh, 100, 'Full battery curtails surplus')
run = simulatePower(new Float64Array(2), 0, 2, { ...config, dischargeEfficiencyPct: 50 })
near(run.endPct, 60, 'Discharging includes conversion losses')
check(!simulatePower(new Float64Array([1000]), 0, 1, { ...config, initialPct: 10 }).pass, 'Initial reserve failure persists after recharge')
assert.throws(() => simulatePower(new Float64Array(1), 0, 2, config))
assert.throws(() => simulatePower(new Float64Array([NaN]), 0, 1, config))
assert.throws(() => validatePower({ ...config, capacityWh: 0 }))
assert.throws(() => validatePower({ ...config, dischargeEfficiencyPct: 0 }))

const solar = { azimuth: new Float64Array([0, 180]), elevation: new Float64Array([0, 0]), fraction: new Float64Array([1, 1]) }
const fixed = generationFor(solar, { ...config, panelAreaM2: 1, efficiencyPct: 100, orientation: 'fixed', tiltDeg: 90, azimuthDeg: 0 })
near(fixed[0], 1361, 'Vertical north panel faces northern horizon Sun')
near(fixed[1], 0, 'Fixed panel rejects light from behind')
near(generationFor(solar, { ...config, orientation: 'horizontal' })[0], 0, 'Horizontal panel at horizon')

// Random histories check conservation and monotonicity, including saturation and depletion.
let seed = 7261
const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
for (let trial = 0; trial < 200; trial++) {
  const c = { ...config, initialPct: random() * 100, loadW: random() * 300, chargeEfficiencyPct: 80, dischargeEfficiencyPct: 90 }
  const watts = Float64Array.from({ length: 72 }, () => random() < 0.4 ? 0 : random() * 600)
  const base = simulatePower(watts, 0, watts.length, c)
  const finalEnergy = base.endPct / 100 * c.capacityWh
  near(c.initialPct / 100 * c.capacityWh + base.generatedWh,
    finalEnergy + base.demandWh - base.unmetWh + base.curtailedWh + base.lossesWh, 'Energy conserved', 1e-6)
  const heavier = simulatePower(watts, 0, watts.length, { ...c, loadW: c.loadW * 1.2 })
  check(heavier.minPct <= base.minPct + 1e-8 && heavier.unmetWh >= base.unmetWh - 1e-8, 'More demand cannot improve reserve or unmet load')
  const larger = simulatePower(watts, 0, watts.length, { ...c, capacityWh: c.capacityWh * 2 })
  check(larger.unmetWh <= base.unmetWh + 1e-8, 'Larger battery cannot increase unmet load')
}

// Actual data: battery constraints must only remove visibility-passing windows.
const read = (p: string) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url), 'utf8'))
const slug = 'malapert-massif'
const series = buildSeries(slug, read(`ephemeris/${slug}.sun.json`).rows, read(`ephemeris/${slug}.earth.json`).rows, read(`horizons/${slug}.json`))
const c = { missionDays: 3, minLitPct: 40, maxDarkH: 48, minLinkPct: 40, maxGapH: 48 }
const range = { firstStart: 0, lastStart: 1000, stepH: 6 }
const visibility = solve([series], c, range)
const powered = solve([series], { ...c, power: { ...DEFAULT_POWER, capacityWh: 1000 } }, range)
check(powered.passCount <= visibility.passCount, 'Battery filtering is a subset of visibility filtering')
check(powered.passCount < visibility.passCount, 'Battery actually changes outcomes')
for (let i = 0; i < powered.starts.length; i++) {
  if (powered.strips[slug][i] === CELL_PASS) check(visibility.strips[slug][i] === CELL_PASS, 'Every passing powered result meets visibility limits')
}
check(series.hours === read(`ephemeris/${slug}.sun.json`).rows.length - 1, 'Last row is not an extra hour')
check(Number.isFinite(evaluateWindow(series, series.hours - 72, series.hours, { ...c, power: DEFAULT_POWER }).margin), 'Mission can end exactly at coverage boundary')
assert.throws(() => evaluateWindow(series, series.hours - 71, series.hours + 1, c))
console.log(`Science and battery checks passed (${checks} assertions plus invalid-input checks).`)
