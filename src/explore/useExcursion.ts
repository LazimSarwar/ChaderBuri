import { useEffect, useMemo, useRef, useState } from 'react'
import { analyseRoute, localSky, ROUTE_MODEL_VERSION, validSettings, type RoutePoint, type RouteSettings, type RouteEnvironment } from './routeAnalysis'
import { SCIENCE_OBJECTIVES, type ScienceObjectiveId } from './scienceObjectives'
import type { FieldBridge } from './useFieldBridge'
import type { ScreenDigestItem } from '../lib/contracts'

export const LANDER_APPROACH: RoutePoint = { id: 'return', label: 'Lander approach', eastM: 4.5, northM: -2.5, taskMin: 0 }
import { freshExcursion as fresh, decodeExcursion, type ExcursionPlan, type Observation } from './excursionState'
type Props = { slug: string; datasetId: string; model: string; environment: RouteEnvironment; visitor: { eastM: number; northM: number }; travelledM?: number; bridge: FieldBridge; onTime: (row: number) => void; constraintsKey: string; source: string }
export function useExcursion(p: Props) {
  const storageKey = `chader-buri-excursion-v1:${p.slug}`
  const [saved, setSaved] = useState<ExcursionPlan>(() => { try { return decodeExcursion(sessionStorage.getItem(storageKey), p.slug, p.datasetId, p.environment.row) } catch { return fresh(p.slug, p.datasetId, p.environment.row) } })
  const plan = saved.slug === p.slug && saved.datasetId === p.datasetId ? saved : fresh(p.slug, p.datasetId, p.environment.row)
  const signature = JSON.stringify([p.constraintsKey, p.source, p.environment.resolutionM, p.environment.eyeHeightM])
  const [refresh, setRefresh] = useState(0), context = useRef(signature), lastWalk = useRef<number | null>(null)
  useEffect(() => { try { setSaved(decodeExcursion(sessionStorage.getItem(storageKey), p.slug, p.datasetId, p.environment.row)) } catch { setSaved(fresh(p.slug, p.datasetId, p.environment.row)) } }, [storageKey, p.datasetId])
  useEffect(() => { if (saved.slug === p.slug && saved.datasetId === p.datasetId) try { sessionStorage.setItem(storageKey, JSON.stringify(saved)) } catch {} }, [saved, storageKey])
  const active = plan.phase === 'outbound' || plan.phase === 'at-station' || plan.phase === 'returning'
  // Leaving the field view (for example to Mission Control) ends the preview: a saved route reopens as a draft,
  // so the guided walk it started must not keep moving the visitor meanwhile.
  const stopOnLeave = useRef({ active, stop: p.bridge.requestGoTo }); stopOnLeave.current = { active, stop: p.bridge.requestGoTo }
  useEffect(() => () => { if (stopOnLeave.current.active) stopOnLeave.current.stop(null) }, [])
  const row = active || plan.phase === 'complete' ? plan.startRow : p.environment.row
  const env = useMemo(() => ({ ...p.environment, row }), [p.environment.sampler, p.environment.resolutionM, p.environment.eyeHeightM, p.environment.sunRows, p.environment.earthRows, p.environment.horizon, row, p.environment.maxRow])
  const analysis = useMemo(() => analyseRoute(plan.origin, plan.points, plan.settings, env, LANDER_APPROACH), [plan.origin, plan.points, plan.settings, env, refresh])
  const returnAnalysis = useMemo(() => analyseRoute({ id: 'here', label: 'Current avatar position', ...p.visitor, taskMin: 0 }, [], plan.settings, p.environment, LANDER_APPROACH), [Math.floor(p.visitor.eastM / 2), Math.floor(p.visitor.northM / 2), plan.settings, p.environment.sampler, p.environment.resolutionM, p.environment.eyeHeightM, Math.floor(p.environment.row * 60), refresh])
  const estimatedUsedMin = active || plan.phase === 'complete' ? Math.max(0, (p.travelledM ?? 0) - plan.startDistanceM) / plan.settings.paceMps / 60 + plan.completedTaskMin : 0
  const returnMarginMin = plan.settings.timeBudgetMin - estimatedUsedMin - returnAnalysis.totalMin - analysis.timeReserveMin
  useEffect(() => {
    if (!active) { context.current = signature; return }
    if (Math.abs(p.environment.row - plan.expectedRow) > .0001 || context.current !== signature) {
      p.bridge.requestGoTo(null)
      setSaved(s => ({ ...s, phase: 'draft', notice: 'The scene time or mission assumptions changed. Review and start a fresh route preview.' }))
      context.current = signature
    }
  }, [p.environment.row, signature, plan.expectedRow, active])
  const target = plan.phase === 'returning' ? LANDER_APPROACH : plan.points[plan.index]
  const arrived = !!target && Math.hypot(target.eastM - p.visitor.eastM, target.northM - p.visitor.northM) <= 1.8
  useEffect(() => {
    if (!active || plan.phase === 'at-station' || !arrived) return
    p.bridge.requestGoTo(null)
    const leg = analysis.legs[plan.phase === 'returning' ? analysis.legs.length - 1 : plan.index]
    if (!leg) return
    const nextRow = leg.arrivalRow
    setSaved(s => ({ ...s, phase: s.phase === 'returning' ? 'complete' : 'at-station', expectedRow: nextRow, notice: s.phase === 'returning' ? 'Returned to the lander approach. Export the observations and remaining evidence gaps.' : 'At the worksite. Record an observation, then finish the simulated activity.' }))
    p.onTime(nextRow)
  }, [arrived, plan.phase, plan.index, active])
  useEffect(() => {
    const w = p.bridge.walk
    if (!active || !w || w.id === lastWalk.current || w.state !== 'blocked') return
    lastWalk.current = w.id
    setSaved(s => ({ ...s, notice: 'The movement preview stopped at an obstacle or data boundary. Inspect the map and revise the route; the drawn polyline is not obstacle-avoiding.' }))
  }, [p.bridge.walk, active])
  const prepare = () => { if (plan.phase === 'draft') setSaved(s => ({ ...s, origin: { id: 'start', label: 'Excursion start', ...p.visitor, taskMin: 0 }, startRow: p.environment.row, expectedRow: p.environment.row })) }
  const addPoint = (eastM: number, northM: number) => setSaved(s => active || s.points.length >= 6 || Math.hypot(eastM, northM) > 249 ? s : ({ ...s, points: [...s.points, { id: `station-${Date.now()}-${s.points.length}`, label: `Worksite ${s.points.length + 1}`, eastM: Math.round(eastM), northM: Math.round(northM), taskMin: SCIENCE_OBJECTIVES.find(o => o.id === s.objective)!.minutes }], notice: '' }))
  const setSettings = (settings: RouteSettings) => { if (!active && validSettings(settings)) setSaved(s => ({ ...s, phase: 'draft', settings })) }
  const setObjective = (objective: ScienceObjectiveId) => { if (!active) setSaved(s => ({ ...s, objective, points: s.points.map(pt => ({ ...pt, taskMin: SCIENCE_OBJECTIVES.find(o => o.id === objective)!.minutes })) })) }
  const start = () => {
    if (!plan.points.length || !analysis.assessedLimitsMet || plan.phase !== 'draft') return
    context.current = signature
    setSaved(s => ({ ...s, phase: 'outbound', startRow: p.environment.row, expectedRow: p.environment.row, startDistanceM: p.travelledM ?? 0, completedTaskMin: 0, index: 0, observations: [], notice: 'Movement preview started. The route clock uses your chosen pace; it is not astronaut telemetry.' }))
    p.bridge.requestGoTo({ ...plan.points[0], label: plan.points[0].label })
  }
  const observe = (note: string) => {
    if (plan.phase !== 'at-station' || !target || note.trim().length < 3) return
    const observation: Observation = { station: target.id, sceneRow: p.environment.row, note: note.trim().slice(0, 500), source: p.source, at: { ...p.visitor, observerHeightM: p.environment.eyeHeightM }, elevationM: p.environment.sampler?.(p.visitor.eastM, p.visitor.northM) ?? null, sun: localSky(p.environment, p.visitor, p.environment.row, 'sun'), earth: localSky(p.environment, p.visitor, p.environment.row, 'earth') }
    setSaved(s => ({ ...s, observations: [...s.observations.filter(o => o.station !== target.id), observation], notice: 'Observation recorded on this device. No sample composition or actual telemetry has been measured.' }))
  }
  const finishTask = () => {
    if (plan.phase !== 'at-station' || !target || !plan.observations.some(o => o.station === target.id)) return
    const nextRow = analysis.legs[plan.index].departureRow, nextIndex = plan.index + 1
    setSaved(s => ({ ...s, index: nextIndex, expectedRow: nextRow, completedTaskMin: s.completedTaskMin + target.taskMin, phase: nextIndex < s.points.length ? 'outbound' : 'returning', notice: `Advanced the simulation by ${target.taskMin} minutes for the activity.` }))
    p.onTime(nextRow)
    const next = plan.points[nextIndex] ?? LANDER_APPROACH
    p.bridge.requestGoTo({ ...next, label: next.label })
  }
  const cancel = () => { p.bridge.requestGoTo(null); setSaved(s => ({ ...s, phase: 'draft', notice: 'Route preview stopped. Your worksites and observations are retained.' })) }
  const returnNow = () => {
    if (active) cancel()
    p.bridge.requestGoTo({ ...LANDER_APPROACH, label: 'Lander approach' })
  }
  const resumeTravel = () => { if ((plan.phase === 'outbound' || plan.phase === 'returning') && target) p.bridge.requestGoTo({ ...target, label: target.label }) }
  const exportBrief = () => {
    const data = { kind: 'chader-buri-excursion-brief', schemaVersion: 1, routeModel: ROUTE_MODEL_VERSION, datasetId: p.datasetId, nominalModel: p.model, missionAssumptions: JSON.parse(p.constraintsKey), source: p.source,
      plan, analysis, returnEstimate: { distanceM: returnAnalysis.distanceM, minutes: returnAnalysis.totalMin, estimatedUsedMin, marginAfterChosenReserveMin: returnMarginMin, reviewRequired: !returnAnalysis.assessedLimitsMet }, scope: 'Planning estimates from loaded terrain and cached sky directions. Not a certified landing, EVA plan, sample analysis or live telemetry. Local clear means only clear within sampled terrain; nominal distant horizon is not relocated.' }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), a = document.createElement('a')
    a.href = url; a.download = `chader-buri-${p.slug}-excursion.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const digest: ScreenDigestItem[] = [
    { id: 'route-phase', label: 'Excursion preview', value: plan.phase, source: ROUTE_MODEL_VERSION },
    { id: 'route-science', label: 'Science objective', value: SCIENCE_OBJECTIVES.find(o => o.id === plan.objective)!.title },
    { id: 'route-time', label: 'Estimated complete excursion incl. return', value: analysis.totalMin.toFixed(1), unit: 'min' },
    { id: 'route-limit', label: 'Route assessment', value: analysis.reasons[0] ?? 'Assessed limits met; operational hazards remain unassessed' },
    { id: 'route-target', label: 'Current route station', value: target?.label ?? 'none' },
    { id: 'route-return', label: 'Return estimate after chosen reserve (not telemetry)', value: `${returnAnalysis.totalMin.toFixed(1)} min return; ${returnMarginMin.toFixed(1)} min margin` },
  ]
  return { plan, analysis, returnAnalysis, returnMarginMin, estimatedUsedMin, active, target, prepare, addPoint, setSettings, setObjective, start, observe, finishTask, cancel, returnNow, resumeTravel, exportBrief, refresh: () => setRefresh(n => n + 1),
    removePoint: (id: string) => { if (!active) setSaved(s => ({ ...s, points: s.points.filter(pt => pt.id !== id) })) }, digest }
}
export type Excursion = ReturnType<typeof useExcursion>
