import type { Constraints } from '../architect/solver.ts'
import type { CompareContext } from '../lib/lunarCompanion.ts'

export type ExplorationMission = { slug: string; row: number; constraints: Constraints; basis: string }
export type ExplorationProposal = ExplorationMission & { compare?: CompareContext; sceneRow: number }
/** A detached snapshot: visiting an alternative must never edit or lose the planner's equipment. */
export function missionSnapshot(slug: string, row: number, constraints: Constraints, basis: string): ExplorationMission {
  if (!slug || !Number.isInteger(row) || row < 0) throw new Error('Invalid exploration mission')
  return { slug, row, constraints: JSON.parse(JSON.stringify(constraints)), basis }
}
export function resolveSurfaceMission(slug: string, row: number, snapshot: ExplorationMission | null, fallback: Constraints): ExplorationMission {
  return snapshot?.slug === slug ? snapshot : { slug, row: Math.round(row), constraints: fallback, basis: 'Illustrative exploration mission' }
}
