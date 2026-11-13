import assert from 'node:assert/strict'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { DEFAULT_THERMAL } from '../src/architect/thermal.ts'
import type { Constraints } from '../src/architect/solver.ts'
import { examplePanelComparison, missionPanelComparison, missionPanelUnavailable, selectedPanelMission } from '../src/explore/panelComparison.ts'
import type { ExplorationMission, ExplorationProposal } from '../src/explore/missionSession.ts'

let checks = 0
const check = (value: unknown, label: string) => { assert.ok(value, label); checks++ }
const constraints: Constraints = {
  missionDays: 6.5, minLitPct: 43, maxDarkH: 19, minLinkPct: 68, maxGapH: 5,
  power: { ...DEFAULT_POWER, panelAreaM2: 7.6, efficiencyPct: 31, loadW: 733, capacityWh: 24200, initialPct: 83, reservePct: 26, chargeEfficiencyPct: 88, dischargeEfficiencyPct: 92, orientation: 'horizontal', tiltDeg: 12, azimuthDeg: 71 },
  thermal: { ...DEFAULT_THERMAL, heaterMaxW: 77, survivalK: 219 },
}
const snapshot: ExplorationMission = { slug: 'malapert-massif', row: 1907, constraints, basis: 'Snapshot of your dashboard mission' }
const original = JSON.stringify(snapshot), equipment = { panelAz: 243, panelTilt: 67 }
const comparison = missionPanelComparison(snapshot, equipment, 5000)!
check(comparison.scenarios.length === 2, 'Compare exactly two orientations')
for (const scenario of comparison.scenarios) {
  check(scenario.row === snapshot.row && scenario.slug === snapshot.slug, 'Preserve mission site and arrival instead of current scene time')
  assert.deepEqual({ ...scenario.c, power: undefined }, { ...constraints, power: undefined }); checks++
  const { orientation: _orientation, tiltDeg: _tilt, azimuthDeg: _az, ...hardware } = scenario.c.power!
  const { orientation: _oldOrientation, tiltDeg: _oldTilt, azimuthDeg: _oldAz, ...originalHardware } = constraints.power!
  assert.deepEqual(hardware, originalHardware); checks++
}
check(comparison.scenarios[0].c.power?.orientation === 'tracking', 'A is ideal tracking')
check(comparison.scenarios[0].c.power?.tiltDeg === 12 && comparison.scenarios[0].c.power?.azimuthDeg === 71, 'Tracker keeps unused saved angle values')
check(comparison.scenarios[1].c.power?.orientation === 'fixed' && comparison.scenarios[1].c.power?.tiltDeg === 67 && comparison.scenarios[1].c.power?.azimuthDeg === 243, 'B uses chosen fixed orientation')
check(JSON.stringify(snapshot) === original, 'Mission snapshot is not modified')
comparison.scenarios[0].c.thermal!.heaterMaxW = 1
comparison.scenarios[0].c.power!.capacityWh = 1
check(comparison.scenarios[1].c.thermal!.heaterMaxW === 77 && snapshot.constraints.power!.capacityWh === 24200, 'Comparisons have detached nested hardware')
check(missionPanelUnavailable(snapshot, 1907 + 6.5 * 24) === null, 'Exact coverage end boundary accepted')
check(missionPanelComparison(snapshot, equipment, 1907 + 6.5 * 24 - 1) === null, 'Incomplete mission coverage cannot create comparison')
check(missionPanelComparison({ ...snapshot, constraints: { ...constraints, power: undefined } }, equipment, 5000) === null, 'Power-disabled mission is not silently replaced by example hardware')
check(missionPanelComparison({ ...snapshot, row: -1 }, equipment, 5000) === null, 'Invalid arrival rejected')
check(missionPanelComparison({ ...snapshot, row: 1.5 }, equipment, 5000) === null, 'Fractional arrival rejected')
check(selectedPanelMission(snapshot.slug, 2200, snapshot, null) === snapshot, 'Moving scene clock retains mission arrival')
check(selectedPanelMission('other', 2200, snapshot, null) === null, 'Another site snapshot is never used')
check(selectedPanelMission(snapshot.slug, 2200, { ...snapshot, basis: 'Illustrative exploration mission' }, null) === null, 'Example mission never labelled as my mission')
const proposal: ExplorationProposal = { ...snapshot, row: 2300, sceneRow: 2200, constraints: { ...constraints, missionDays: 3 }, basis: 'Current mission proposal' }
check(selectedPanelMission(snapshot.slug, 2200, snapshot, proposal) === proposal, 'Current proposal takes precedence')
check(selectedPanelMission(snapshot.slug, 2201, snapshot, proposal) === snapshot, 'Stale proposal is not reused after scene moves')
check(selectedPanelMission(snapshot.slug, 2200, snapshot, { ...proposal, slug: 'other' }) === snapshot, 'Other-site proposal does not replace snapshot')
const example = examplePanelComparison(snapshot.slug, 123.4, equipment, 5000, { ...constraints, missionDays: 14 })!
check(example.scenarios.every(s => s.row === 123 && s.c.missionDays === 14 && s.c.power?.panelAreaM2 === 2 && s.c.power?.loadW === 100 && s.c.power?.capacityWh === 10000), 'Explicit example retains existing tutorial hardware and scene date')
check(example.note.startsWith('Example') && example.note.includes('does not use or change your selected mission'), 'Example scope labelled clearly')
check(examplePanelComparison(snapshot.slug, 4900, equipment, 5000, { ...constraints, missionDays: 14 }) === null, 'Example also respects complete coverage')
check(JSON.stringify(snapshot) === original, 'All operations preserve original mission')
console.log(`Panel mission comparison: ${checks} checks passed`)
