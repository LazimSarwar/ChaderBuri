import assert from 'node:assert/strict'
import { missionPhase, missionPlanningRow, sameRanking, comparisonDifferences, timeReturnTargets } from '../src/explore/explorationJourney.ts'
import { objectiveLine, newObjective } from '../src/explore/fieldObjective.ts'
import type { ObjectiveInput } from '../src/explore/fieldObjective.ts'
import type { RankedSite } from '../src/explore/siteRanking.ts'

let checks = 0
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++ }
const start = 100, days = 14, end = start + days * 24
check(missionPlanningRow(100.01756) === 100, 'A fractional first visit shares the hourly mission evaluation anchor')
check(missionPlanningRow(100.75) === 101, 'Arrivals after half an hour use the next hourly prediction consistently')
check(missionPlanningRow(null) === null && missionPlanningRow(NaN) === null, 'Missing mission clocks do not become an arrival')
check(missionPhase(100.75, missionPlanningRow(100.75), days)?.state === 'before', 'Scene time remains exact before its rounded planning arrival')
check(missionPhase(124.01, missionPlanningRow(100.01756), days)?.label === 'Mission day 2 of 14', 'Mission day boundaries follow the hourly planning anchor')
check(missionPhase(436.01, missionPlanningRow(100.01756), days)?.outside === true, 'The mission end agrees with the hourly evaluation boundary')
check(missionPhase(start - 1, start, days)?.state === 'before', 'Pre-arrival is outside the planned window')
check(missionPhase(start, start, days)?.label === 'Mission day 1 of 14', 'Arrival starts day one')
check(missionPhase(start + 24, start, days)?.label === 'Mission day 2 of 14', 'A full day advances the label')
check(missionPhase(end - .01, start, days)?.label === 'Mission day 14 of 14', 'Last fractional hour stays on day fourteen')
check(missionPhase(end, start, days)?.label === 'Mission complete · day 14 of 14', 'End boundary never produces day fifteen of fourteen')
check(missionPhase(end + .01, start, days)?.outside === true, 'A time after completion is outside the plan')
check(missionPhase(0, null, days) === null && missionPhase(0, 0, null) === null && missionPhase(NaN, 0, days) === null, 'Missing or invalid mission context is not labelled')
const input: ObjectiveInput = { heading: 0, earth: { az: 20, el: -1 }, skylineEl: 0, visitor: { eastM: 0, northM: 0 }, antenna: { deployed: false, pointingErrorDeg: 20, earthVisible: false } }
const hidden = objectiveLine(newObjective(), input, 'Here', 5)
check(hidden?.offer === 'open-time' && hidden.key === 'objective:find-hidden', 'Hidden Earth offers time navigation instead of an impossible turn')
check(hidden?.text.includes('Turning cannot reveal it') && !!hidden.brief, 'Guide explains the blocked step and provides a short caption')
const visible = objectiveLine(newObjective(), { ...input, earth: { az: 20, el: 1 } }, 'Here', 5)
check(visible?.offer === 'face-earth' && visible.key !== hidden?.key, 'Earthrise changes the advice key and restores the facing action')
const point = objectiveLine({ ...newObjective(), found: true, reached: true }, input, 'Here', 5)
check(point?.offer === 'open-time', 'Hidden Earth cannot be aimed at even before the antenna is deployed')
const a = { slug: 'a', rank: 1, result: { pass: true, margin: .5, linkPct: 100, longestDarkH: 0, longestGapH: 0, litPct: 100 } } as RankedSite
const b = { slug: 'b', rank: 2, result: { ...a.result } } as RankedSite
check(sameRanking(a, b), 'Different catalogue ranks can have equal ranking margins')
check(!sameRanking(a, { ...b, result: { ...b.result, margin: .500001 } }), 'Near-equal margins are not falsely called an exact tie')
check(!sameRanking(a, { ...b, result: { ...b.result, pass: false } }), 'Passing and failing sites are never called equal')
check(comparisonDifferences(a, b, 'A', 'B')[0].includes('same displayed'), 'Identical readings produce an honest similarity statement')
check(comparisonDifferences(a, { ...b, result: { ...b.result, linkPct: 80 } }, 'A', 'B')[0].includes('20.0 percentage points more Earth visibility'), 'A comparison reports the actual numerical difference')
check(comparisonDifferences(a, { ...b, result: { ...b.result, longestGapH: 8 } }, 'A', 'B')[0].includes('8.0 hours more time'), 'Earth gaps are compared even when visibility percentages match')
check(comparisonDifferences({ ...a, result: { ...a.result, longestGapH: .94 } }, { ...b, result: { ...b.result, longestGapH: .96 } }, 'A', 'B')[0].includes('0.02 hours'), 'Different rounded readings are explained without a false zero delta')
check(timeReturnTargets(200, 100, 100, 100).length === 1, 'Coincident arrival, previous and mission times have one recovery action')
check(timeReturnTargets(100, 100, 100, 100).length === 0, 'Current time needs no return action')
check(timeReturnTargets(200, 100, 120, 140).map(t => t.kind).join() === 'mission,visit,previous', 'Distinct return times remain reachable')
check(timeReturnTargets(200, null, NaN, Infinity).length === 0, 'Unavailable return times never produce controls')
check(timeReturnTargets(200, 100, 100.005, null).length === 1, 'Equivalent fractional return times are deduplicated')
check(timeReturnTargets(200, 100, 100, 100)[0].kind === 'mission', 'A shared return time is labelled as the active mission arrival')
check(timeReturnTargets(250, 100, 150, 200).find(t => t.kind === 'mission')?.row === 200, 'Active mission return never targets the original visit')
check(timeReturnTargets(250, 100, 150, 200).find(t => t.kind === 'visit')?.row === 100, 'The original visit remains a distinct recovery target')
console.log(`Exploration journey: ${checks} checks passed`)
