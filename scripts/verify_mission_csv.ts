import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { csvCell, csvTable, missionCsv, type MissionCsvInput } from '../src/lib/missionCsv.ts'
import { buildSeries, evaluateWindow, type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { DEFAULT_THERMAL } from '../src/architect/thermal.ts'
import { missionTimeline, momentAt } from '../src/lib/missionMoment.ts'
import { TIMING_LIMITATION } from '../src/lib/attribution.ts'

let checks = 0
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks++ }
const read = (name: string) => JSON.parse(readFileSync('public/data/' + name, 'utf8'))
/** Independent reader exercises commas, quoted text and multiline cells. */
function parse(text: string) {
  const lines: string[][] = [], line: string[] = []
  let value = '', quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') { if (quoted && text[i + 1] === '"') { value += '"'; i++ } else quoted = !quoted }
    else if (c === ',' && !quoted) { line.push(value); value = '' }
    else if ((c === '\r' || c === '\n') && !quoted) {
      if (c === '\r' && text[i + 1] === '\n') i++
      line.push(value); lines.push([...line]); line.length = 0; value = ''
    } else value += c
  }
  assert.equal(quoted, false)
  const header = lines.shift()!
  check(lines.every(row => row.length === header.length), 'Every CSV row has the exact header width')
  return lines.map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])))
}
check(csvCell(-12.75) === '-12.75', 'Negative measured numbers remain numeric')
for (const text of ['=1+1', '+cmd', '-1+1', '@SUM(A1)', '  =1', '\t=1', '\r=1']) check(csvCell(text).includes("'"), 'Spreadsheet formula text is neutralized')
assert.throws(() => csvCell(NaN)); checks++
assert.throws(() => csvCell(Infinity)); checks++
assert.throws(() => csvTable(['a'], [[1, 2]])); checks++
const escaped = parse(csvTable(['text', 'value'], [['comma, "quote"\nnext line', -2.5]]))
check(escaped[0].text === 'comma, "quote"\nnext line' && escaped[0].value === '-2.5', 'RFC4180 text round-trips without changing measurements')

const index = read('prediction-index.json'), sites = read('sites.json'), slug = 'malapert-massif'
const sun = read(`ephemeris/${slug}.sun.json`), earth = read(`ephemeris/${slug}.earth.json`), horizon = read(`horizons/${slug}.json`)
const series = buildSeries(slug, sun.rows, earth.rows, horizon)
const c: Constraints = { missionDays: 14, minLitPct: 60, minLinkPct: 60, maxDarkH: 72, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }
const input: MissionCsvInput = { index, scenarios: [{ id: 0, slug, row: 1104, c, label: 'Chosen "mission", reference' }], series: new Map([[slug, series]]), sites, eph: { [slug]: { sun, earth } }, horizons: { [slug]: horizon }, generatedUTC: '2026-11-13T00:00:00Z' }
const before = JSON.stringify(input.scenarios)
const csv = missionCsv(input, 'hourly'), rows = parse(csv.text)
check(rows.length === 337 && csv.rows === 337, 'Fourteen days exports 336 intervals and one final boundary')
check(rows[0].utc === '2026-10-17T00:00:00.000Z' && rows.at(-1)!.utc === '2026-10-31T00:00:00.000Z', 'Export dates are absolute UTC, not scene-relative dates')
check(rows[0].interval_duration_h === '1' && rows.at(-1)!.interval_duration_h === '' && rows.at(-1)!.solar_generation_w === '', 'End boundary contributes no extra interval or energy')
check(rows.at(-1)!.sample_kind === 'mission_end_boundary' && rows.at(-1)!.mission_day === '14', 'End boundary is labelled and remains in the last mission day')
check(rows[0].scenario_label === input.scenarios[0].label, 'Scenario label with commas and quotes round-trips')
check(rows[0].dataset_id === index.datasetId && rows[0].model_sha256 === index.model.sha256, 'CSV preserves the exact dataset and model identity')
check(rows[0].horizon_product_sha256 === index.files[`/data/horizons/${slug}.json`].sha256 && rows[0].sun_product_sha256 === index.files[`/data/ephemeris/${slug}.sun.json`].sha256, 'CSV preserves verified source product hashes')
check(rows[0].sampling_and_event_limits === TIMING_LIMITATION && rows[0].scope.includes('not radio service'), 'CSV discloses time resolution and assessment scope')
const evaluated = evaluateWindow(series, 1104, 1440, c)
const generatedWh = rows.slice(0, -1).reduce((sum, row) => sum + Number(row.solar_generation_w), 0)
check(Math.abs(generatedWh - evaluated.power!.generatedWh) < 1e-7, 'Exported hourly energy equals the dashboard calculation')
check(Math.min(...rows.map(row => Number(row.battery_charge_pct))) === evaluated.power!.minPct, 'Lowest CSV battery equals the displayed mission verdict minimum')
check(rows.slice(0, -1).filter(row => row.sun_centre_visible === 'true').length / 336 * 100 === evaluated.litPct, 'CSV visibility reproduces the dashboard sunlight percentage')
const timeline = missionTimeline(series, 1104, c)
for (const hour of [0, 100, 335, 336]) {
  const moment = momentAt(timeline, sun.rows, earth.rows, horizon, hour)
  check(Number(rows[hour].sun_clearance_deg) === moment.sun.clearance && Number(rows[hour].battery_charge_pct) === moment.batteryPct, `Export agrees with the existing timeline at hour ${hour}`)
}

const events = parse(missionCsv(input, 'events').text)
check(events[0].event_id === 'landing' && events.some(event => event.event_id === 'end' && event.mission_hour === '336'), 'Events retain both mission boundaries, including coincident events at mission end')
check(events.every(event => Number(event.mission_hour) >= 0 && Number(event.mission_hour) <= 336), 'Event timestamps stay inside the selected mission')
check(events.every((event, i) => i === 0 || Date.parse(event.event_utc) >= Date.parse(events[i - 1].event_utc)), 'Events remain in chronological order')
const low = events.find(event => event.event_id === 'lowest')!
check(Number(rows[Number(low.mission_hour)].battery_charge_pct) === evaluated.power!.minPct, 'Lowest-battery event agrees with the full hourly export')
const sunset = series.darkRuns.find(([start]) => start > 24 && start + 48 < series.hours)![0]
const changing = parse(missionCsv({ ...input, scenarios: [{ ...input.scenarios[0], row: sunset - 24, c: { ...c, missionDays: 3, power: undefined } }] }, 'events').text)
check(changing.some(event => event.event === 'Sunset' && event.mission_hour === '24'), 'A real cached Sun transition appears at the correct mission hour')
check(changing.some(event => event.event_kind === 'sky') && changing.filter(event => event.event_kind === 'sky').every(event => event.timing_basis === 'Hourly centre visibility transition'), 'Actual sky events are not presented as exact limb crossings')

const variants: MissionCsvInput = { ...input, scenarios: [input.scenarios[0], { id: 5, slug, row: 1272, c: { ...c, missionDays: 3, power: undefined }, label: '=malicious label' }, { id: 8, slug, row: 1104, c: { ...c, missionDays: 3, power: { ...c.power!, loadW: 80 }, thermal: { ...DEFAULT_THERMAL } } }] }
const compared = parse(missionCsv(variants, 'hourly').text)
check(compared.length === 337 + 73 + 73, 'All comparison options and each complete duration are exported')
const b = compared.filter(row => row.scenario_id === 'B'), d = compared.filter(row => row.scenario_id === 'C')
check(b[0].landing_utc === '2026-10-24T00:00:00.000Z' && b[0].scenario_label === "'=malicious label", 'Independent scenario dates and protected text are retained')
check(b.every(row => row.battery_assessment === 'disabled' && row.battery_charge_pct === '' && row.below_battery_reserve === '' && row.solar_generation_w === ''), 'Disabled battery values remain blank rather than fabricated zeros or passes')
check(d[0].thermal_assessment === 'assessed' && d[0].lander_temperature_c !== '' && d[0].heater_load_w !== '' && d.at(-1)!.heater_load_w === '', 'Enabled thermal data is exported with boundary semantics')
check(JSON.parse(d[0].requirements_and_hardware_json).power.loadW === 80 && JSON.parse(compared[0].requirements_and_hardware_json).power.loadW === 1200, 'Different equipment stays tied to its own scenario')
check(Number(d[0].total_demand_w) === 80 + Number(d[0].heater_load_w), 'Exported total demand includes the existing thermal heater load')
check(JSON.stringify(input.scenarios) === before && c.power!.loadW === 1200, 'CSV generation does not mutate the active mission')
const edge = { ...input, scenarios: [{ ...input.scenarios[0], row: series.hours - 336 }] }
check(missionCsv(edge, 'hourly').rows === 337, 'A mission ending at the final coverage sample is complete')
assert.throws(() => missionCsv({ ...input, scenarios: [{ ...input.scenarios[0], row: series.hours - 335 }] }, 'hourly'), /complete/); checks++
assert.throws(() => missionCsv({ ...input, scenarios: [input.scenarios[0], { ...input.scenarios[0], slug: 'missing' }] }, 'events')); checks++
assert.throws(() => missionCsv({ ...input, index: { ...index, files: {} } }, 'hourly'), /indexed/); checks++
for (const kind of ['hourly', 'events'] as const) {
  assert.throws(() => missionCsv({ ...input, scenarios: [{ ...input.scenarios[0], c: { ...c, power: undefined, thermal: { ...DEFAULT_THERMAL } } }] }, kind), /battery model enabled/); checks++
}
check(!/(?:,|\r\n)(?:NaN|Infinity)(?:,|\r\n)/.test(csv.text), 'No nonfinite numerical cells are exported')
console.log(`Mission CSV escaping, model equivalence, coverage, metadata, comparison and event checks passed: ${checks}`)
