export type SiteLook = {yaw:number;pitch:number}
export const SITE_LOOK_PITCH_LIMIT = Math.PI/2 - 0.01
/** Heading stays unbounded so crossing north never stops a 360-degree turn. */
export function turnSiteLook(look: SiteLook, dx: number, dy: number): void {
  look.yaw -= dx*0.0026
  look.pitch = Math.max(-SITE_LOOK_PITCH_LIMIT,Math.min(SITE_LOOK_PITCH_LIMIT,look.pitch+dy*0.0026))
}
