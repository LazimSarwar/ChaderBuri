import assert from 'node:assert/strict'
import { antennaMissionText, type AntennaMission } from '../src/explore/antennaMission.ts'
import { consoleGlanceStore, glanceForVisit } from '../src/explore/consoleGlanceStore.ts'

const mission: AntennaMission = { days: 10, basis: 'Selected mission', earthPct: 80, longestEarthGapH: 8, minEarthPct: 75, maxEarthGapH: 10, opportunityPct: 60, longestOpportunityGapH: 12, nextEarthsetUTC: '2026-11-20 03:00 UTC', phase: 'during' }
const normal = antennaMissionText(mission)
assert.match(normal.earth, /80.0%.*8.0 h/)
assert.match(normal.stations, /60.0%.*12.0 h/)
assert.match(normal.consequence, /meets your Earth-visibility limits/)
assert.match(normal.next, /2026-11-20 03:00 UTC/)
assert.match(antennaMissionText({ ...mission, longestEarthGapH: 11 }).consequence, /misses.*Compare another site or arrival/)
assert.match(antennaMissionText({ ...mission, earthPct: 74 }).consequence, /misses/)
assert.match(antennaMissionText({ ...mission, opportunityPct: null, longestOpportunityGapH: null }).stations, /not assessed/)
assert.match(antennaMissionText({ ...mission, opportunityPct: 0, longestOpportunityGapH: 240 }).stations, /0.0%.*240.0 h/)
assert.match(antennaMissionText({ ...mission, nextEarthsetUTC: null }).next, /between hourly samples/)
for (const phase of ['after', 'ended'] as const) assert.match(antennaMissionText({ ...mission, phase }).next, /mission end.*Return to arrival/)
assert.match(antennaMissionText({ ...mission, basis: 'Illustrative exploration mission' }).title, /^Example/)
assert.match(antennaMissionText({ ...mission, basis: 'Illustrative exploration mission' }).consequence, /example limits/)
const glance = { ...consoleGlanceStore.getSnapshot(), visitKey: 'previous-visit', antennaMission: mission }
assert.equal(glanceForVisit(glance, 'new-visit', 'New site').antennaMission, null, 'a different visit cannot reuse old mission consequences')
assert.equal(glanceForVisit({ ...glance, antennaMission: null }, 'previous-visit', '').antennaMission, null, 'loading or failed results stay unavailable')
console.log('Antenna mission consequences: 15 assertions passed')
