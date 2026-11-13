import type { Constraints } from '../architect/solver.ts'
import type { Scn } from '../architect/comparison.ts'
import { DEFAULT_POWER } from '../architect/power.ts'
import type { Equipment } from '../lib/expedition.ts'
import type { ExplorationMission, ExplorationProposal } from './missionSession.ts'

/** A separate planner experiment; the small panel's instantaneous scene readout remains an example. */
export type PanelMissionComparison = {
  missionDays: number
  arrivalUTC: string
  canCompare: boolean
  unavailableReason: string | null
  onCompare: () => void
}

/** Use the current console proposal or the detached mission brought onto this site, never another site's or an example. */
export function selectedPanelMission(slug: string, sceneRow: number, snapshot: ExplorationMission | null, proposal: ExplorationProposal | null): ExplorationMission | null {
  const selected = proposal?.slug === slug && proposal.sceneRow === Math.round(sceneRow) ? proposal : snapshot?.slug === slug ? snapshot : null
  return selected && selected.basis !== 'Illustrative exploration mission' ? selected : null
}

export function missionPanelUnavailable(mission: ExplorationMission, coverageHours: number): string | null {
  if (!mission.constraints.power) return 'Enable power modelling in your mission to compare its panel.'
  const end = mission.row + mission.constraints.missionDays * 24
  if (!Number.isInteger(mission.row) || mission.row < 0 || !Number.isFinite(end) || end <= mission.row || end > coverageHours) return 'The complete selected mission is outside the cached predictions. Choose a covered arrival or shorter mission.'
  return null
}

export function missionPanelComparison(mission: ExplorationMission, equipment: Pick<Equipment, 'panelAz' | 'panelTilt'>, coverageHours: number): { scenarios: Scn[]; note: string } | null {
  if (missionPanelUnavailable(mission, coverageHours)) return null
  // Detached copies preserve all mission assumptions, including future nested hardware settings.
  const a: Constraints = JSON.parse(JSON.stringify(mission.constraints)), b: Constraints = JSON.parse(JSON.stringify(mission.constraints))
  a.power = { ...a.power!, orientation: 'tracking' }
  b.power = { ...b.power!, orientation: 'fixed', tiltDeg: equipment.panelTilt, azimuthDeg: equipment.panelAz }
  return {
    scenarios: [{ id: 0, slug: mission.slug, row: mission.row, c: a }, { id: 1, slug: mission.slug, row: mission.row, c: b }],
    note: `Your mission panel comparison. A: ideal tracker; B: chosen fixed orientation (${equipment.panelTilt.toFixed(0)}° tilt, ${equipment.panelAz.toFixed(0)}° bearing). Same selected arrival, ${a.missionDays}-day duration, panel area, efficiency, electrical load, battery, thermal assumptions and numerical requirements. Only panel orientation differs. The scene's instantaneous watt readout is a separate 2 m² / 28% example. Predictions remain at the nominal landing coordinate; this opens a comparison without editing your mission.`,
  }
}

/** Preserve the existing tutorial hardware and duration when the visitor explicitly chooses the example. */
export function examplePanelComparison(slug: string, row: number, equipment: Pick<Equipment, 'panelAz' | 'panelTilt'>, coverageHours: number, reference: Constraints): { scenarios: Scn[]; note: string } | null {
  const mission: ExplorationMission = { slug, row: Math.round(row), constraints: { ...reference, power: { ...DEFAULT_POWER } }, basis: 'Illustrative exploration mission' }
  const result = missionPanelComparison(mission, equipment, coverageHours)
  return result ? { ...result, note: 'Example surface panel experiment at the nominal landing coordinate. A: ideal tracker; B: chosen fixed orientation. Both use 2 m² / 28%, 100 W load, 10 kWh battery and the same 14-day mission, starting at the scene time. This does not use or change your selected mission. Visitor position does not change the horizon.' } : null
}
