import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries, evaluateWindow, type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { missionReading, arrivalRows, inputRow, utcInput } from '../src/explore/missionReadout.ts'
import { qualityPlan, SurfaceResolutionController } from '../src/space/renderQuality.ts'
let checks = 0
function check(test: unknown, message: string) { assert.ok(test, message); checks++ }
const json = (p: string) => JSON.parse(readFileSync(new URL('../public/data/' + p, import.meta.url), 'utf8'))
const c: Constraints = { missionDays: 14, minLitPct: 60, minLinkPct: 60, maxDarkH: 72, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }
for (const slug of ['malapert-massif', 'shackleton-floor']) {
  const sun = json(`ephemeris/${slug}.sun.json`), earth = json(`ephemeris/${slug}.earth.json`), horizon = json(`horizons/${slug}.json`)
  const series = buildSeries(slug, sun.rows, earth.rows, horizon), start = Date.parse(sun.start)
  for (const iso of ['2026-10-17T00:00:00Z', '2026-10-24T00:00:00Z']) {
    const row = (Date.parse(iso) - start) / 3600000, snapshot = JSON.stringify(c)
    const result = missionReading(series, start, row, c, horizon.observerHeightAboveGroundM)
    assert.deepEqual(result.result, evaluateWindow(series, row, row + 336, c)); checks++
    check(Date.parse(result.arrivalUTC) === Date.parse(iso), 'Readout retains the exact arrival epoch')
    check(Date.parse(result.endUTC) - Date.parse(iso) === 336 * 3600000, 'Complete mission duration')
    check(JSON.stringify(c) === snapshot, 'Inspection does not mutate mission settings')
    for (const event of [result.firstDarkUTC, result.firstEarthGapUTC]) if (event) check(Date.parse(event) >= Date.parse(result.arrivalUTC) && Date.parse(event) < Date.parse(result.endUTC), 'Events fall inside the selected mission')
    check(inputRow(utcInput(row, start), start) === row, 'UTC date editing round trips without local timezone shifts')
  }
  for (const row of [-1, .5, series.hours - 335]) { assert.throws(() => missionReading(series, start, row, c, 0)); checks++ }
  assert.throws(() => missionReading(series, start, 0, { ...c, missionDays: .01 }, 0)); checks++
  for (const row of [0, 168, series.hours - 336]) check(arrivalRows(row, series.hours, 336).every(r => r >= 0 && r + 336 <= series.hours), 'Date suggestions never clip a mission window')
}
check(inputRow('', 0) === null, 'Empty date cannot silently reuse an old result')
check(inputRow('2026-10-17T00:30', Date.parse('2026-09-01T00:00Z')) === null, 'Non-hourly arrivals are rejected explicitly')
for (const compact of [false, true]) {
  const base = qualityPlan('low', 1, compact).dpr, floor = compact ? .6 : .75, controller = new SurfaceResolutionController(base, floor)
  for (let i = 1; i <= 500; i++) controller.sample(40, i * 40)
  check(controller.dpr === floor, 'Sustained slow frames preserve the requested viewport pixel floor')
  check(controller.dpr ** 2 <= base ** 2, 'Automatic low never exceeds its ceiling')
  const reduced = controller.dpr
  for (let i = 501; i <= 1000; i++) controller.sample(16.7, i * 40)
  check(controller.dpr > reduced || controller.dpr === base, 'Sustained inexpensive frames allow bounded resolution recovery')
  check(new SurfaceResolutionController(base).dpr === base, 'Changing to manual quality restores its full pixel density')
}
const normal = new SurfaceResolutionController(.75)
for (let i = 1; i <= 200; i++) normal.sample(20, i * 20)
check(normal.dpr === .75, 'Adequate frame rate retains visual detail')
for (const gap of [NaN, -1, 0, 300, 3000]) check(!normal.sample(gap, 50000), 'Stalls and invalid samples cannot reduce resolution')
console.log(`Mission readout and resolution checks: ${checks} passed`)
