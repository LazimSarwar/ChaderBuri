import { routeDefaults, validSettings, type RoutePoint, type RouteSettings, type LocalSky } from './routeAnalysis.ts'
import { SCIENCE_OBJECTIVES, type ScienceObjectiveId } from './scienceObjectives.ts'
type Phase = 'draft' | 'outbound' | 'at-station' | 'returning' | 'complete'
export type Observation = { station: string; sceneRow: number; note: string; source: string; at?: { eastM: number; northM: number; observerHeightM: number }; elevationM?: number | null; sun: LocalSky; earth: LocalSky }
export type ExcursionPlan = { version: 1; slug: string; datasetId: string; phase: Phase; objective: ScienceObjectiveId; points: RoutePoint[]; origin: RoutePoint; settings: RouteSettings; startRow: number; expectedRow: number; startDistanceM: number; completedTaskMin: number; index: number; observations: Observation[]; notice: string }
export const freshExcursion = (slug: string, datasetId: string, row: number): ExcursionPlan => ({ version: 1, slug, datasetId, phase: 'draft', objective: 'terrain', points: [], origin: { id: 'start', label: 'Excursion start', eastM: 0, northM: 0, taskMin: 0 }, settings: routeDefaults(), startRow: row, expectedRow: row, startDistanceM: 0, completedTaskMin: 0, index: 0, observations: [], notice: '' })
export function decodeExcursion(raw: string | null, slug: string, datasetId: string, row: number): ExcursionPlan {
  const fallback = freshExcursion(slug, datasetId, row)
  if (!raw || raw.length > 30000) return fallback
  try {
    const v = JSON.parse(raw) as ExcursionPlan
    if (v.version !== 1 || v.slug !== slug || v.datasetId !== datasetId || !validSettings(v.settings) || !SCIENCE_OBJECTIVES.some(o => o.id === v.objective) || !Array.isArray(v.points) || v.points.length > 6) return fallback
    if (v.points.some(p => typeof p.id !== 'string' || typeof p.label !== 'string' || p.label.length > 96 || ![p.eastM, p.northM, p.taskMin].every(Number.isFinite) || Math.hypot(p.eastM, p.northM) > 250 || p.taskMin < 0 || p.taskMin > 120)) return fallback
    // Saved plans reopen for review, never restart locomotion or replay an old scene clock.
    const observations = Array.isArray(v.observations) ? v.observations.filter(o => typeof o.station === 'string' && typeof o.note === 'string' && o.note.length <= 500 && Number.isFinite(o.sceneRow)).slice(0, 6) : []
    return { ...fallback, objective: v.objective, points: v.points, settings: v.settings, observations, notice: v.points.length ? 'Saved route restored for review. Start a fresh preview from your current position.' : '' }
  } catch { return fallback }
}
