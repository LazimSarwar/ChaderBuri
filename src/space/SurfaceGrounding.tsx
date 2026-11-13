import type { Runtime, SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import { useSurfaceFrame } from './useSurfaceFrame'
import { ContactShade, useGroundContacts } from './SurfaceContact'
import { BURI_POSITION } from './BuriFigure'

const CENTRE = [[0, 0]] as const

/** Illustrative contact shade where Chader Buri's emitter puck rests on the rendered DEM facet. */
export function SurfaceGrounding({ runtime, clock, moon, buri }: { runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData; buri: boolean }) {
  const root = useSurfaceFrame(runtime, clock, moon, BURI_POSITION.eastM, BURI_POSITION.northM), contacts = useGroundContacts(runtime, root, CENTRE)
  return <group ref={root} scale={1 / LUNAR_RADIUS_M} visible={false} userData={{ focusIgnore: true, decorative: true }}>
    {buri && contacts[0] && <ContactShade contact={contacts[0]} radius={.3} />}
  </group>
}
