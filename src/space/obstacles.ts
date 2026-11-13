import { EQUIPMENT_POSITIONS, OUTPOST_POSITION } from '../lib/surfaceMission'
import { BURI_POSITION } from './BuriFigure'

/**
 * Walking collision with the illustrative surface objects, as circles in east/north metres from the visit target.
 * Presentation only: it keeps the camera out of the lander, equipment and Chader Buri's emitter. It is not a hazard
 * model and never enters the measured DEM step check, which still runs first.
 */
export type Obstacle = { id: 'lander' | 'panel' | 'antenna' | 'buri'; eastM: number; northM: number; radiusM: number }
export type FlatPoint = { eastM: number; northM: number }

/** Half the visitor's shoulder width, added to every object's footprint. */
export const VISITOR_RADIUS_M = .3

export function surfaceObstacles(on: { panel: boolean; antenna: boolean; buri: boolean }): Obstacle[] {
  const list: Obstacle[] = [{ id: 'lander', ...OUTPOST_POSITION, radiusM: 2.05 + VISITOR_RADIUS_M }]
  // A deployed panel sweeps a 2 m plate around its mast; its circle stays inside the 1 m antenna stand-off spot.
  if (on.panel) list.push({ id: 'panel', ...EQUIPMENT_POSITIONS.panel, radiusM: .72 + VISITOR_RADIUS_M })
  if (on.antenna) list.push({ id: 'antenna', ...EQUIPMENT_POSITIONS.antenna, radiusM: .45 + VISITOR_RADIUS_M })
  if (on.buri) list.push({ id: 'buri', ...BURI_POSITION, radiusM: .34 + VISITOR_RADIUS_M })
  return list
}

/** Move a point out of every circle it is inside (radially), so walking into an object slides along it. */
export function pushOut(p: FlatPoint, obstacles: Obstacle[]): FlatPoint & { hit: boolean } {
  let { eastM, northM } = p, hit = false
  for (let pass = 0; pass < 2; pass++) for (const o of obstacles) {
    const dE = eastM - o.eastM, dN = northM - o.northM, d = Math.hypot(dE, dN)
    if (d >= o.radiusM) continue
    hit = true
    if (d > 1e-6) { eastM = o.eastM + dE * o.radiusM / d; northM = o.northM + dN * o.radiusM / d }
    else { eastM = o.eastM + o.radiusM; northM = o.northM }
  }
  return { eastM, northM, hit }
}

/** A target inside an object is replaced by the nearest point on its edge as seen from the visitor. */
export function reachableTarget(target: FlatPoint, from: FlatPoint, obstacles: Obstacle[]): FlatPoint {
  for (const o of obstacles) {
    if (Math.hypot(target.eastM - o.eastM, target.northM - o.northM) >= o.radiusM) continue
    const dE = from.eastM - o.eastM, dN = from.northM - o.northM, d = Math.hypot(dE, dN) || 1
    return { eastM: o.eastM + dE / d * (o.radiusM + .05), northM: o.northM + dN / d * (o.radiusM + .05) }
  }
  return target
}

/**
 * Bearing (radians, 0 = north) for a guided walk: straight at the target, or along the tangent around the
 * nearest object that blocks the straight line, on the side the target lies.
 */
export function steerBearing(from: FlatPoint, target: FlatPoint, obstacles: Obstacle[]): number {
  const dE = target.eastM - from.eastM, dN = target.northM - from.northM, length = Math.hypot(dE, dN)
  const direct = Math.atan2(dE, dN)
  if (length < 1e-6) return direct
  const uE = dE / length, uN = dN / length
  let blocking: Obstacle | null = null, nearest = Infinity
  for (const o of obstacles) {
    const cE = o.eastM - from.eastM, cN = o.northM - from.northM, along = cE * uE + cN * uN, across = cE * uN - cN * uE
    const margin = o.radiusM + .15
    if (along <= 0 || along > length + margin || Math.abs(across) >= margin) continue
    if (along < nearest) { nearest = along; blocking = o }
  }
  if (!blocking) return direct
  const cE = blocking.eastM - from.eastM, cN = blocking.northM - from.northM, d = Math.hypot(cE, cN)
  const toCentre = Math.atan2(cE, cN), margin = blocking.radiusM + .15
  // Pass on the side away from the centre: centre to the right of the path (across > 0) means go left.
  const side = cE * uN - cN * uE > 0 ? -1 : 1
  const offset = d <= margin ? Math.PI / 2 : Math.asin(Math.min(1, margin / d))
  return toCentre + side * offset
}
