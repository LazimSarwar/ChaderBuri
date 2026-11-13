import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import type { Constraints } from '../src/architect/solver.ts'
import { horizonAt } from '../src/data.ts'
import { parseRowT } from '../src/lib/sim.ts'
import { sampleSky, sunVerdict } from '../src/lib/science.ts'
import { nextHorizonCrossing } from '../src/lib/attribution.ts'
import { missionTrace, missionConsequence } from '../src/lib/missionConsequence.ts'
import { dsnPasses, xbLinkBudget, XB_BUDGET_DEFAULTS } from '../src/lib/dsn.ts'
import { visorGroups, visorDigest, formatEta, formatMet, formatRate, type VisorInputs } from '../src/lib/visorData.ts'

let checks = 0
const check = (v: unknown, m: string) => { assert.ok(v, m); checks++ }
const read = (p: string) => JSON.parse(readFileSync('public/data/' + p, 'utf8'))

// Fixture: the reference lander at Malapert Massif, touchdown at the hour the decision guide uses.
const slug = 'malapert-massif', sun = read(`ephemeris/${slug}.sun.json`), earth = read(`ephemeris/${slug}.earth.json`), horizon = read(`horizons/${slug}.json`)
// Same values as REFERENCE in src/architect/reference.ts (that module is not node-loadable).
const c: Constraints = { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }
const series = buildSeries(slug, sun.rows, earth.rows, horizon), touchdown = 1104
const startMs = parseRowT(sun.rows[0].t).getTime()
const at = (row: number, touchdownRow: number | null = touchdown): VisorInputs => ({
  slug, row, touchdownRow, series, constraints: c, sun: sampleSky(sun.rows, row), earth: sampleSky(earth.rows, row), horizon,
  sunRows: sun.rows, earthRows: earth.rows, epoch: new Date(startMs + row * 3600000),
})

// Power system agrees exactly with the mission consequence model.
const row = touchdown + 30.5, groups = visorGroups(at(row)), [power, link, env, clock] = groups
const expected = missionConsequence(missionTrace(series, { id: 0, slug, row: touchdown, c })!, row)!
check(power.headline.value === expected.batteryPct!.toFixed(1) && power.headline.unit === '%', 'Battery matches the mission consequence model')
check(power.details.find(d => d.id === 'generation')!.value === expected.generationW!.toFixed(0), 'Generation matches the model')
check(power.details.find(d => d.id === 'load')!.value === expected.demandW!.toFixed(0), 'Load matches the model')
check(power.headline.kind === 'calculated' && /Assumed lander: 3.08 m² array, 1200 W load/.test(power.headline.assumption!), 'Power values say which lander they assume')
check(power.headline.status === (expected.belowReserve ? 'fail' : expected.flow === 'solar surplus' || expected.flow === 'balanced' ? 'ok' : 'warn'), 'Battery status follows reserve and energy flow')
check(visorGroups(at(touchdown + 14 * 24 + 5))[0].headline.value === 'not assessed', 'No battery value after the mission window (no extrapolation)')
check(visorGroups(at(row, null))[0].headline.value === 'not assessed' && /Awaiting touchdown/.test(visorGroups(at(row, null))[0].headline.assumption!), 'No battery value before touchdown')

// Earth link: geometry from the terrain horizon, rate is an estimate, never an operational pass.
const e = sampleSky(earth.rows, row), clearance = e.el - horizonAt(horizon, e.az)
check(link.details[0].value.replace('−', '-').startsWith((clearance >= 0 ? '+' : '-') + Math.abs(clearance).toFixed(1)), 'Earth clearance matches the horizon test')
const epoch = new Date(startMs + row * 3600000), station = dsnPasses(epoch).filter(s => s.ok).sort((a, b) => b.elevDeg - a.elevDeg)[0]
if (clearance > 0 && station) {
  const rate = formatRate(xbLinkBudget(e.rangeKm!, station.elevDeg, XB_BUDGET_DEFAULTS.gtDbK34m, 1).maxDataRateKbps)
  check(link.headline.value === rate.value && link.headline.unit === rate.unit, 'Link rate matches the X-band budget')
  check(link.headline.kind === 'estimated' && link.headline.label === 'Estimated link opportunity' && /not an operational DSN pass/.test(link.headline.assumption!), 'The link is labelled an estimate, not a DSN pass')
} else check(link.headline.status !== 'ok', 'Without Earth or a station there is no link opportunity')
const eta = nextHorizonCrossing(earth.rows, epoch, horizon, !(clearance > 0))?.hours ?? null
check(link.details[1].value === formatEta(eta), 'Earthset / Earthrise countdown matches the horizon crossing')
// Find a masked hour and check the link says so.
let masked = -1
for (let r = touchdown; r < touchdown + 400; r++) { const s = sampleSky(earth.rows, r); if (s.el < horizonAt(horizon, s.az)) { masked = r; break } }
if (masked >= 0) check(visorGroups(at(masked))[1].headline.value === 'masked' && visorGroups(at(masked))[1].headline.status === 'fail', 'Masked Earth reads as no link')

// Environment: solar elevation and disc state from the same verdict as the planner.
const s = sampleSky(sun.rows, row), state = sunVerdict(s.el, horizonAt(horizon, s.az), s.radiusDeg)
check(env.headline.label === `Sunlight · ${state}` && env.headline.unit === '°', 'Sunlight state matches the planner verdict')
check(env.headline.status === (state === 'lit' ? 'ok' : state === 'grazing' ? 'warn' : 'fail'), 'Sunlight status colour follows the disc state')

// Mission clock.
check(clock.headline.value === formatMet(30.5) && formatMet(30.5) === 'T+1d 06:30' && formatMet(.2) === 'T+00:12', 'Mission clock counts from touchdown')
check(visorGroups(at(touchdown + 3, touchdown + .4))[3].headline.value === 'T+02:36' && visorGroups(at(touchdown + 3, touchdown + .4))[0].headline.value === visorGroups(at(touchdown + 2.6))[0].headline.value, 'Power and clock both count from the exact touchdown')
check(visorGroups(at(touchdown + .4, touchdown + .4))[0].headline.value === '90.0', 'The battery starts at its initial charge at touchdown')
check(clock.details.find(d => d.id === 'mission-day')!.value === '2 of 14', 'Mission day counts from day 1')
check(clock.headline.kind === 'illustrative', 'The simulated touchdown clock is marked illustrative')

// Every reading names its kind and source; numbers carry units.
for (const g of groups) for (const r of [g.headline, ...g.details]) {
  check(['measured', 'calculated', 'estimated', 'illustrative'].includes(r.kind) && r.source.length > 3, `${g.id}.${r.id} names its kind and source`)
  if (/^[+−-]?\d/.test(r.value) && !/T\+|\d{4}-\d{2}/.test(r.value)) check(r.unit.length > 0, `${g.id}.${r.id} has a unit`)
}
check(formatEta(null) === 'beyond the cached window' && formatEta(.4) === 'within the hour' && formatEta(50) === 'in 2.1 d' && formatEta(12.4) === 'in 12 h', 'Countdowns read naturally')
check(formatRate(2100).unit === 'Mbps' && formatRate(512).unit === 'kbps', 'Rates switch units')

// Digest for Chader Buri: every readout, labelled by group, with status and kind.
const digest = visorDigest(groups)
check(digest.length === groups.reduce((n, g) => n + 1 + g.details.length, 0) && digest.every(d => d.label.includes(':') && d.source), 'The visor digest lists every readout with its source')

// Countdowns keep counting within a scene hour (the cache holds the crossing moment, not the hours left).
const etaHours = (r: number) => { const e = visorGroups(at(r))[2].details.find(d => d.id === 'sun-eta')!.value; const m = /([\d.]+) (h|d)/.exec(e); return m ? Number(m[1]) * (m[2] === 'd' ? 24 : 1) : NaN }
const base = Math.floor(row) + 0.1, later = base + 0.6
{
  const exact = (r: number) => nextHorizonCrossing(sun.rows, new Date(startMs + r * 3600000), horizon, sampleSky(sun.rows, r).el <= horizonAt(horizon, sampleSky(sun.rows, r).az))?.hours ?? null
  const a = exact(base), b = exact(later)
  check(a !== null && b !== null && Math.abs((a - b) - 0.6) < 0.02, 'Reference: the next crossing is 0.6 h closer after 0.6 h')
  const ea = etaHours(base), eb = etaHours(later)
  check(Number.isFinite(ea) && Number.isFinite(eb) && (ea > 48 ? Math.abs(ea - eb) < 0.2 * 24 : Math.abs((ea - eb) - 0.6) < 0.11), `Visor countdown moves within the hour (${ea} → ${eb})`)
}
const { nextRiseHours } = await import('../src/lib/nextRise.ts')
{
  // Scan for a scene hour where Earth or the Sun is below the skyline, so a future rise exists.
  const d = (r: number) => new Date(startMs + r * 3600000)
  let moving = 0, matched = 0
  for (let h = 100; h < sun.rows.length - 400; h += 37) {
    const r0 = h + 0.05, r1 = r0 + 0.7
    const a = nextRiseHours(slug, r0, sun.rows, earth.rows, horizon, d(r0)), b = nextRiseHours(slug, r1, sun.rows, earth.rows, horizon, d(r1))
    for (const k of ['earth', 'sun'] as const) {
      const fresh = nextHorizonCrossing(k === 'earth' ? earth.rows : sun.rows, d(r1), horizon, true)?.hours ?? null
      if (fresh === null ? b[k] === null : b[k] !== null && Math.abs(fresh - b[k]!) < 1e-6) matched++
      if (a[k] !== null && a[k]! > 1 && b[k] !== null && Math.abs((a[k]! - b[k]!) - 0.7) < 1e-6) moving++
    }
  }
  check(matched > 0 && matched === 2 * Math.ceil((sun.rows.length - 500) / 37), 'Cached sunrise / Earthrise countdowns always equal a fresh calculation')
  check(moving > 10, `Countdowns move within a scene hour (${moving} future rises checked)`)
}

console.log(`Mission Visor data checks passed: ${checks}`)
