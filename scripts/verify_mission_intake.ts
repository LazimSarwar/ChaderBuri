import assert from 'node:assert/strict'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { buildSeries, solve } from '../src/architect/solver.ts'
import type { EphRow, Horizon } from '../src/data.ts'
import { assessIntake, initialIntake, INTAKE_PURPOSES, intakeCoverageHours, intakeDateInput, intakeMarginExplanation, intakeMissionForGuide, intakeRankingTie, intakeUTC, readIntakeDraft, validateIntake, type IntakeDraft } from '../src/lib/missionIntake.ts'

let count = 0
const check = (yes: unknown) => { assert.ok(yes); count++ }
const start = Date.parse('2026-09-01T00:00:00Z'), HOUR = 3_600_000
const draft = { ...initialIntake(start, 1000, 24), missionDays: 3 }
check(intakeCoverageHours(97, [97, 97]) === 96)
check(intakeCoverageHours(96, [97, 97]) === 96)
check(intakeCoverageHours(100, [97, 96]) === 95)
check(intakeCoverageHours(100, []) === 0)
check(draft.landingUTC === '2026-09-02T00:00')
check(intakeUTC('2028-02-29T12:00') === Date.parse('2028-02-29T12:00:00Z'))
for (const bad of ['2026-02-29T12:00', '2026-02-30T12:00', '2026-04-31T12:00', '2026-09-01T25:00', '2026-09-01T12:30', '2026-09-01T12:00Z', '', '<script>']) check(intakeUTC(bad) === null)
check(intakeDateInput(start) === '2026-09-01T00:00')
check(initialIntake(start, 1000, undefined, start - 100 * HOUR).landingUTC === '2026-09-01T00:00')
check(initialIntake(start, 1000, undefined, start + 2000 * HOUR).landingUTC === intakeDateInput(start + (1000 - 14 * 24) * HOUR))
const atBoundary = validateIntake(draft, start, 96)
check(atBoundary.ok)
check(!validateIntake({ ...draft, landingUTC: '2026-09-02T01:00' }, start, 96).ok)
check(!validateIntake({ ...draft, landingUTC: '2026-08-31T23:00' }, start, 96).ok)
check(!validateIntake({ ...draft, landingUTC: '2027-01-01T00:00' }, start, 96).ok)
check(!validateIntake(draft, start + HOUR / 2, 96).ok)
for (const v of [2, 31, 3.5, NaN, Infinity]) check(!validateIntake({ ...draft, missionDays: v }, start, 1000).ok)
for (const key of ['minLitPct', 'minLinkPct'] as const) for (const v of [-1, 101, NaN]) check(!validateIntake({ ...draft, [key]: v }, start, 1000).ok)
for (const key of ['maxDarkH', 'maxGapH'] as const) {
  check(validateIntake({ ...draft, [key]: 400 }, start, 1000).ok)
  for (const v of [-1, 401, 720, NaN]) check(!validateIntake({ ...draft, [key]: v }, start, 1000).ok)
}
check(!validateIntake({ ...draft, purpose: 'constructor' } as IntakeDraft, start, 1000).ok)
check(!validateIntake({ ...draft, equipment: 'unknown' } as unknown as IntakeDraft, start, 1000).ok)
for (const [key, bad] of Object.entries({ panelAreaM2: 0, capacityKWh: 0, loadW: -1, reservePct: 91 })) check(!validateIntake({ ...draft, equipment: 'custom', [key]: bad }, start, 1000).ok)
const custom = validateIntake({ ...draft, equipment: 'custom', panelAreaM2: 3.125, capacityKWh: 12.345, loadW: 101.25, reservePct: 23.75 }, start, 1000)
assert.ok(custom.ok)
check(custom.mission.c.power!.panelAreaM2 === 3.125)
check(Math.abs(custom.mission.c.power!.capacityWh - 12345) < 1e-8)
check(custom.mission.c.power!.loadW === 101.25)
check(custom.mission.c.power!.reservePct === 23.75)
const example = validateIntake({ ...draft, equipment: 'example', loadW: 9999, panelAreaM2: 99 }, start, 1000)
assert.ok(example.ok)
check(example.mission.c.power!.loadW === DEFAULT_POWER.loadW)
check(example.mission.c.power!.panelAreaM2 === DEFAULT_POWER.panelAreaM2)
example.mission.c.power!.loadW = 1
check(DEFAULT_POWER.loadW === 100)
for (const purpose of ['balanced', 'sunlight', 'earth'] as const) {
  const v = validateIntake({ ...draft, purpose, ...INTAKE_PURPOSES[purpose].limits }, start, 1000)
  assert.ok(v.ok)
  check(v.mission.c.minLitPct === INTAKE_PURPOSES[purpose].limits.minLitPct)
  check(v.mission.c.maxGapH === INTAKE_PURPOSES[purpose].limits.maxGapH)
}
const saved = JSON.stringify({ v: 1, draft })
assert.deepEqual(readIntakeDraft(saved), draft); count++
for (const value of [null, '', 'not-json', '{"v":2}', JSON.stringify({ v: 1, draft: { ...draft, missionDays: 100000 } }), JSON.stringify({ v: 1, draft: { ...draft, capacityKWh: null } }), JSON.stringify({ v: 1, draft: { ...draft, purpose: '__proto__' } }), ' '.repeat(4097)]) check(readIntakeDraft(value) === null)
const hz = { profile: Array(360).fill(0) } as Horizon
function fixture(slug: string, lit: (n: number) => boolean, visible: (n: number) => boolean, hours = 96) {
  const sun: EphRow[] = [], earth: EphRow[] = []
  for (let i = 0; i <= hours; i++) { sun.push({ t: String(i), az: 90, el: lit(i) ? 25 : -10 }); earth.push({ t: String(i), az: 270, el: visible(i) ? 15 : -10 }) }
  return buildSeries(slug, sun, earth, hz)
}
const all = [fixture('sunny', () => true, i => i % 24 < 20), fixture('earthy', i => i % 24 < 20, () => true), fixture('dark', i => i % 24 < 2, i => i % 24 < 2)]
const valid = validateIntake(draft, start, 96)
assert.ok(valid.ok)
const guideDraft = intakeMissionForGuide(valid, 'sunny')
assert.ok(guideDraft)
check(guideDraft.row === 24 && guideDraft.slug === 'sunny')
assert.deepEqual(guideDraft.c, valid.mission.c); count++
guideDraft.c.power!.loadW = 33
check(valid.mission.c.power!.loadW === DEFAULT_POWER.loadW)
check(intakeMissionForGuide({ ok: false, errors: ['date'] }, 'sunny') === null)
check(intakeMissionForGuide(valid) === null)
check(intakeMissionForGuide(valid, '<invalid>') === null)
const assessed = assessIntake(all, valid.mission)
const existing = solve(all, valid.mission.c, { firstStart: 24, lastStart: 24, stepH: 1 })
assert.deepEqual(assessed.ranked.map(s => s.slug), existing.closest.map(s => s.slug)); count++
for (const s of assessed.ranked) { assert.deepEqual(s.result, existing.closest.find(v => v.slug === s.slug)!.best); count++ }
check(assessed.passing === existing.passCount)
check(assessed.ranked[0].result.pass)
check(!assessed.ranked.at(-1)!.result.pass)
const top = assessed.ranked[0]
check(intakeRankingTie([]) === 0)
check(intakeRankingTie([top]) === 1)
check(intakeRankingTie([top, { slug: 'twin', result: { ...top.result, margin: top.result.margin + 1e-10 } }]) === 2)
check(intakeRankingTie([top, { slug: 'different', result: { ...top.result, margin: top.result.margin + 1e-6 } }]) === 1)
check(intakeRankingTie([top, { slug: 'different-verdict', result: { ...top.result, pass: !top.result.pass } }]) === 1)
check(intakeMarginExplanation({ ...top.result, limiting: 'lit', litPct: 100 }, valid.mission.c)?.includes('100% against your minimum of 60%'))
check(intakeMarginExplanation({ ...top.result, limiting: 'gap', longestGapH: 12 }, valid.mission.c)?.includes('12 h against your maximum of 72 h'))
check(intakeMarginExplanation({ ...top.result, limiting: 'battery', power: undefined }, valid.mission.c) === null)
check(intakeMarginExplanation({ ...top.result, limiting: 'lit', litPct: NaN }, valid.mission.c) === null)
const missing = assessIntake([...all, fixture('short', () => true, () => true, 24)], valid.mission)
assert.deepEqual(missing.unavailable, ['short']); count++
check(missing.ranked.length === 3)
const failure = validateIntake({ ...draft, equipment: 'custom', panelAreaM2: 0.1, loadW: 10000, capacityKWh: 0.1, reservePct: 90 }, start, 96)
assert.ok(failure.ok)
const noMatch = assessIntake(all, failure.mission)
check(noMatch.passing === 0)
check(noMatch.ranked.every(v => !v.result.pass))
check(assessIntake([], valid.mission).ranked.length === 0)
console.log(`Guided mission intake: ${count} checks passed`)
