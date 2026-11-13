import type { EphRow, Horizon } from '../data.ts'
import { horizonElevation, sampleSky, SUN_RADIUS_DEG } from '../lib/science.ts'
import type { TerrainSampler } from './terrainGrid.ts'

export const ROUTE_MODEL_VERSION = 'excursion-preview-1'
export const ROUTE_RADIUS_M = 250
export type RoutePoint = { id: string; label: string; eastM: number; northM: number; taskMin: number }
export type RouteSettings = {
  mode: 'walk' | 'rover'; paceMps: number; maxSlopeDeg: number; timeBudgetMin: number; reservePct: number
  batteryWh: number | null; travelW: number | null; taskW: number | null
  oxygenL: number | null; oxygenLpm: number | null
}
export const routeDefaults = (mode: RouteSettings['mode'] = 'walk'): RouteSettings => ({ mode, paceMps: mode === 'walk' ? .5 : 1.2, maxSlopeDeg: 10, timeBudgetMin: 120, reservePct: 20,
  batteryWh: mode === 'rover' ? 1000 : null, travelW: mode === 'rover' ? 200 : null, taskW: mode === 'rover' ? 50 : null, oxygenL: null, oxygenLpm: null })
export type LocalSky = { status: 'blocked nearby' | 'grazing nearby' | 'clear in sampled area' | 'unknown'; clearanceDeg: number | null; sampledToM: number; samples: number; nominalClearanceDeg: number; skyAz: number; skyEl: number }
export type RouteEnvironment = { sampler: TerrainSampler | null; resolutionM: number; eyeHeightM: number; row: number; sunRows: EphRow[]; earthRows: EphRow[]; horizon: Horizon; maxRow: number }
export type RouteLeg = { from: RoutePoint; to: RoutePoint; distanceM: number; minutes: number; maxSlopeDeg: number | null; missingSamples: number; sampledPoints: number; exceedsSlope: boolean; arrivalRow: number; departureRow: number; sun: LocalSky; earth: LocalSky; endSun: LocalSky; endEarth: LocalSky; blockedSamples: number }
export type ResourceEstimate = { name: string; used: number; remaining: number; reserve: number; unit: string; meets: boolean }
export type RouteAnalysis = { legs: RouteLeg[]; distanceM: number; travelMin: number; taskMin: number; totalMin: number; timeRemainingMin: number; timeReserveMin: number; resources: ResourceEstimate[]; reasons: string[]; coverage: 'complete' | 'incomplete'; assessedLimitsMet: boolean; unassessed: string[] }
export const ROUTE_UNASSESSED = ['Foot-scale rocks, craters and regolith bearing strength', 'Far-field visibility at walked coordinates and operational radio links', 'Actual suit life support, thermal control, radiation and rescue capability', 'Launch, descent, ascent, rendezvous and landing certification']
const finiteHeight = (sampler: TerrainSampler | null, e: number, n: number): number | null => {
  if (!sampler) return null
  try { const h = sampler(e, n); return h !== null && Number.isFinite(h) ? h : null } catch { return null }
}
const distance = (a: RoutePoint, b: RoutePoint) => Math.hypot(a.eastM - b.eastM, a.northM - b.northM)
export function validSettings(s: RouteSettings): boolean {
  return ['walk', 'rover'].includes(s.mode) && Number.isFinite(s.paceMps) && s.paceMps >= .05 && s.paceMps <= 5 && Number.isFinite(s.maxSlopeDeg) && s.maxSlopeDeg > 0 && s.maxSlopeDeg < 60
    && Number.isFinite(s.timeBudgetMin) && s.timeBudgetMin >= 1 && s.timeBudgetMin <= 1440 && Number.isFinite(s.reservePct) && s.reservePct >= 0 && s.reservePct <= 90
    && [s.batteryWh, s.travelW, s.taskW, s.oxygenL, s.oxygenLpm].every(v => v === null || (Number.isFinite(v) && v > 0))
}
/** Nearby terrain only. The sky direction is interpolated at the nominal site; no far horizon is invented. */
export function localSky(e: RouteEnvironment, at: Pick<RoutePoint, 'eastM' | 'northM'>, row: number, body: 'sun' | 'earth'): LocalSky {
  const sky = sampleSky(body === 'sun' ? e.sunRows : e.earthRows, Math.max(0, Math.min(e.maxRow, row)))
  const reference = sky.el - horizonElevation(e.horizon.profile, sky.az)
  const unknown: LocalSky = { status: 'unknown', clearanceDeg: null, sampledToM: 0, samples: 0, nominalClearanceDeg: reference, skyAz: sky.az, skyEl: sky.el }
  if (row < 0 || row > e.maxRow) return unknown
  const origin = finiteHeight(e.sampler, at.eastM, at.northM)
  if (origin === null) return unknown
  const az = sky.az * Math.PI / 180, step = Math.max(5, Number.isFinite(e.resolutionM) ? e.resolutionM : 20)
  let highest = -90, samples = 0, missing = false, reached = 0
  for (let d = step; d <= 250; d += step) {
    const east = at.eastM + Math.sin(az) * d, north = at.northM + Math.cos(az) * d
    if (Math.hypot(east, north) > ROUTE_RADIUS_M) break
    const h = finiteHeight(e.sampler, east, north)
    if (h === null) { missing = true; continue }
    // Reference-sphere curvature; observer height is the selected camera/antenna height, not the planner height.
    const angle = Math.atan2(h - origin - e.eyeHeightM - d * d / (2 * 1737400), d) * 180 / Math.PI
    highest = Math.max(highest, angle); samples++; reached = d
  }
  if (!samples) return unknown
  const clearanceDeg = sky.el - highest
  const radius = body === 'sun' ? sky.radiusDeg ?? SUN_RADIUS_DEG : 0
  return { status: clearanceDeg <= -radius ? 'blocked nearby' : missing ? 'unknown' : body === 'sun' && clearanceDeg <= radius ? 'grazing nearby' : 'clear in sampled area', clearanceDeg, sampledToM: reached, samples, nominalClearanceDeg: reference, skyAz: sky.az, skyEl: sky.el }
}
/** A closed, time-tagged, sampled polyline. It is a route estimate, not an obstacle-avoiding certified path. */
export function analyseRoute(origin: RoutePoint, stations: RoutePoint[], settings: RouteSettings, e: RouteEnvironment, returnPoint: RoutePoint = origin): RouteAnalysis {
  if (!validSettings(settings)) throw new Error('Enter valid route assumptions')
  if (stations.length > 6 || stations.some(p => ![p.eastM, p.northM, p.taskMin].every(Number.isFinite) || p.taskMin < 0 || p.taskMin > 120 || Math.hypot(p.eastM, p.northM) > ROUTE_RADIUS_M)) throw new Error('Route stations must be inside the loaded exploration area')
  const finish = { ...returnPoint, id: 'return', label: 'Return to lander approach', taskMin: 0 }, points = [origin, ...stations, finish]
  const legs: RouteLeg[] = []; let elapsed = 0
  const step = Math.max(5, Number.isFinite(e.resolutionM) ? e.resolutionM : 20)
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1], to = points[i], horizontal = distance(from, to)
    const count = Math.max(1, Math.ceil(horizontal / step)), hStep = horizontal / count
    let previous = finiteHeight(e.sampler, from.eastM, from.northM), resolvedDistance = 0, maxSlope = 0, known = 0, missing = previous === null ? 1 : 0
    const arrivalBeforeLeg = e.row + elapsed / 60
    let blockedSamples = 0
    for (let j = 1; j <= count; j++) {
      const t = j / count, eastM = from.eastM + (to.eastM - from.eastM) * t, northM = from.northM + (to.northM - from.northM) * t
      const h = finiteHeight(e.sampler, eastM, northM)
      if (h === null) missing++
      if (h !== null && previous !== null && hStep > 0) { const rise = h - previous; resolvedDistance += Math.hypot(hStep, rise); maxSlope = Math.max(maxSlope, Math.atan2(Math.abs(rise), hStep) * 180 / Math.PI); known++ }
      else resolvedDistance += hStep
      previous = h
      const atRow = arrivalBeforeLeg + resolvedDistance / settings.paceMps / 3600
      if (localSky(e, { eastM, northM }, atRow, 'sun').status === 'blocked nearby') blockedSamples++
    }
    const minutes = resolvedDistance / settings.paceMps / 60
    elapsed += minutes
    const arrivalRow = e.row + elapsed / 60, departureRow = arrivalRow + to.taskMin / 60
    legs.push({ from, to, distanceM: resolvedDistance, minutes, maxSlopeDeg: known ? maxSlope : null, missingSamples: missing, sampledPoints: count + 1,
      exceedsSlope: known > 0 && maxSlope > settings.maxSlopeDeg, arrivalRow, departureRow,
      sun: localSky(e, to, arrivalRow, 'sun'), earth: localSky(e, to, arrivalRow, 'earth'), endSun: localSky(e, to, departureRow, 'sun'), endEarth: localSky(e, to, departureRow, 'earth'), blockedSamples })
    elapsed += to.taskMin
  }
  const travelMin = legs.reduce((a, l) => a + l.minutes, 0), taskMin = stations.reduce((a, p) => a + p.taskMin, 0), totalMin = travelMin + taskMin
  const timeRemainingMin = settings.timeBudgetMin - totalMin, timeReserveMin = settings.timeBudgetMin * settings.reservePct / 100
  const resources: ResourceEstimate[] = []
  if (settings.batteryWh !== null && settings.travelW !== null && settings.taskW !== null) {
    const used = travelMin / 60 * settings.travelW + taskMin / 60 * settings.taskW, reserve = settings.batteryWh * settings.reservePct / 100
    resources.push({ name: 'Modelled excursion battery', used, remaining: settings.batteryWh - used, reserve, unit: 'Wh', meets: settings.batteryWh - used >= reserve })
  }
  if (settings.mode === 'walk' && settings.oxygenL !== null && settings.oxygenLpm !== null) {
    const used = totalMin * settings.oxygenLpm, reserve = settings.oxygenL * settings.reservePct / 100
    resources.push({ name: 'User-specified oxygen budget', used, remaining: settings.oxygenL - used, reserve, unit: 'L', meets: settings.oxygenL - used >= reserve })
  }
  const reasons: string[] = []
  if (timeRemainingMin < timeReserveMin) reasons.push('The excursion leaves less than your chosen time reserve')
  if (legs.some(l => l.exceedsSlope)) reasons.push('At least one resolved route segment exceeds your chosen slope limit')
  if (legs.some(l => l.missingSamples)) reasons.push('Some route terrain samples are missing')
  if (legs.some(l => l.departureRow > e.maxRow || l.arrivalRow < 0)) reasons.push('The excursion extends outside cached sky coverage')
  for (const r of resources) if (!r.meets) reasons.push(`${r.name} falls below your chosen reserve`)
  const coverage = legs.some(l => l.missingSamples) ? 'incomplete' : 'complete'
  return { legs, distanceM: legs.reduce((a, l) => a + l.distanceM, 0), travelMin, taskMin, totalMin, timeRemainingMin, timeReserveMin, resources, reasons, coverage, assessedLimitsMet: !reasons.length,
    unassessed: [...ROUTE_UNASSESSED, ...(!resources.some(r => r.unit === 'Wh') ? ['Excursion battery capacity and demand were not supplied'] : []), ...(settings.mode === 'walk' && !resources.some(r => r.unit === 'L') ? ['Suit oxygen capacity and consumption were not supplied'] : [])] }
}
