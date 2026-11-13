// Places the visitor can walk to on the surface, in metres east/north of the landing point.
import { OUTPOST_POSITION } from '../lib/surfaceMission.ts'

/** Where Chader Buri's figure stands. Mirrors BURI_POSITION in src/space/BuriFigure.tsx (checked by verify:field). */
export const BURI_MAP_POSITION = { eastM: 4.6, northM: -0.2 }

export type FieldPlace = {
  id: string
  label: string
  kind: 'landing' | 'lander' | 'buri' | 'marker' | 'flag' | 'photo' | 'note'
  eastM: number
  northM: number
  /** Stop this far short of the place on a guided walk (objects are solid). */
  standoffM: number
  distanceM: number
}
export type MarkerInput = { id: string; label: string; eastM: number; northM: number; kind?: FieldPlace['kind'] }

const round = (m: number) => Math.round(m * 10) / 10

/** Landing point, lander, Chader Buri, then saved markers, each with its distance from the visitor. */
export function fieldPlaces(visitor: { eastM: number; northM: number }, markers: MarkerInput[]): FieldPlace[] {
  const at = (e: number, n: number) => round(Math.hypot(e - visitor.eastM, n - visitor.northM))
  return [
    { id: 'landing', label: 'Landing point', kind: 'landing', eastM: 0, northM: 0, standoffM: 0, distanceM: at(0, 0) },
    { id: 'lander', label: 'Lander', kind: 'lander', eastM: OUTPOST_POSITION.eastM, northM: OUTPOST_POSITION.northM, standoffM: 3.5, distanceM: at(OUTPOST_POSITION.eastM, OUTPOST_POSITION.northM) },
    { id: 'buri', label: 'Chader Buri', kind: 'buri', eastM: BURI_MAP_POSITION.eastM, northM: BURI_MAP_POSITION.northM, standoffM: 1.6, distanceM: at(BURI_MAP_POSITION.eastM, BURI_MAP_POSITION.northM) },
    ...markers.map(m => ({ id: m.id, label: m.label, kind: m.kind ?? 'marker' as const, eastM: m.eastM, northM: m.northM, standoffM: 0, distanceM: at(m.eastM, m.northM) })),
  ]
}
