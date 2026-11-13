import type { EphRow, Horizon, Site } from '../data.ts'
import { horizonElevation, sampleSky } from './science.ts'
import { nextHorizonCrossing } from './attribution.ts'

const RAD = Math.PI / 180
export const MOON_RADIUS_M = 1_737_400
export const LOLA_SOURCE = 'https://pds-geosciences.wustl.edu/missions/lro/lola.htm'
export const HORIZONS_SOURCE = 'https://ssd.jpl.nasa.gov/horizons/'
export type VisitPose = { heading: number; pitch: number; fov: number;eastM?:number;northM?:number;lat?:number;lonEast?:number;groundM?:number;movementBlocked?:boolean;airborne?:boolean;heightAboveGroundM?:number;verticalMps?:number;walking?:boolean;crouched?:boolean;eyeHeightM?:number;trailSteps?:number;trailDistanceM?:number }
export type Hotspot = { id: string; label: string; az: number; el: number; description: string; source: string; distanceM?: number }

/** A future setting event, even when the Sun is already masked at the current epoch. */
export function nextVisitSunset(rows:EphRow[],epoch:Date,horizon:Horizon) {
  const setting=nextHorizonCrossing(rows,epoch,horizon,false)
  if(!setting||setting.hours>0)return setting
  const rise=nextHorizonCrossing(rows,epoch,horizon,true)
  if(!rise)return null
  const delay=rise.hours+0.001
  const afterRise=nextHorizonCrossing(rows,new Date(epoch.getTime()+delay*3_600_000),horizon,false)
  return afterRise?{...afterRise,hours:delay+afterRise.hours}:null
}

/** Spherical surface distance and initial bearing; not a traversability estimate. */
export function siteSeparation(a: Pick<Site,'lat'|'lonEast'>, b: Pick<Site,'lat'|'lonEast'>) {
  const p = a.lat*RAD, q = b.lat*RAD, d = (b.lonEast-a.lonEast)*RAD
  const h = Math.sin((q-p)/2)**2 + Math.cos(p)*Math.cos(q)*Math.sin(d/2)**2
  return { distanceM: 2*MOON_RADIUS_M*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h)))),
    bearing: (Math.atan2(Math.sin(d)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(d))/RAD+360)%360 }
}

export function explorationHotspots(horizon: Horizon, sun: {az:number;el:number}, earth: {az:number;el:number}): Hotspot[] {
  const ridge = horizon.profile.indexOf(Math.max(...horizon.profile))
  return [
    { id:'skyline', label:'Highest skyline', az:ridge, el:horizon.profile[ridge], source:LOLA_SOURCE,
      description:`The largest measured horizon angle is ${horizon.profile[ridge].toFixed(2)}° at bearing ${ridge}°. This marks a direction in the cached skyline; the ridge distance is not supplied.` },
    { id:'solar', label:'Solar horizon', az:sun.az, el:horizonElevation(horizon.profile,sun.az), source:LOLA_SOURCE,
      description:`At the Sun’s bearing, the terrain mask is ${horizonElevation(horizon.profile,sun.az).toFixed(2)}°. Sun-centre clearance is ${(sun.el-horizonElevation(horizon.profile,sun.az)).toFixed(2)}°. This geometry alone does not establish power sufficiency.` },
    { id:'earth', label:'Earth horizon', az:earth.az, el:horizonElevation(horizon.profile,earth.az), source:LOLA_SOURCE,
      description:`Earth-centre clearance above this skyline is ${(earth.el-horizonElevation(horizon.profile,earth.az)).toFixed(2)}°. A clear direction does not establish radio service or relay availability.` },
  ]
}

/** Perspective projection in local ENU, matching the standing observer camera. */
export function projectVisit(az: number, el: number, pose: VisitPose, aspect: number) {
  const d = (az-pose.heading)*RAD, e = el*RAD, p = pose.pitch*RAD
  const forward = Math.cos(e)*Math.cos(d)*Math.cos(p)+Math.sin(e)*Math.sin(p)
  if(forward <= 0.001 || aspect<=0) return null
  const right = Math.cos(e)*Math.sin(d), up = Math.sin(e)*Math.cos(p)-Math.cos(e)*Math.cos(d)*Math.sin(p)
  const scale = Math.tan(pose.fov*RAD/2)
  return {x:0.5+right/(forward*scale*aspect)*0.5,y:0.5-up/(forward*scale)*0.5}
}

/** At most 73 points, only within the actual cache. No extrapolation. */
export function visitSunPath(rows: EphRow[], row: number, horizon: Horizon) {
  const start = Math.max(0,Math.min(rows.length-1,Math.floor(row)))
  const end = Math.min(rows.length-1,start+72)
  const points = []
  for(let i=start;i<=end;i++) {
    const sky=sampleSky(rows,i)
    points.push({...sky,row:i,visible:sky.el>horizonElevation(horizon.profile,sky.az)})
  }
  return points
}

/** Split at clipping/occlusion boundaries, so hidden segments never join across the view. */
export function projectedSunSegments(points: ReturnType<typeof visitSunPath>, pose: VisitPose, aspect: number) {
  const segments: {visible:boolean;points:{x:number;y:number}[]}[]=[]
  let segment: (typeof segments)[number] | null=null
  for(const point of points) {
    const projected=projectVisit(point.az,point.el,pose,aspect)
    if(!projected || projected.x < -0.1 || projected.x > 1.1 || projected.y < -0.1 || projected.y > 1.1){segment=null;continue}
    if(!segment || segment.visible!==point.visible){segment={visible:point.visible,points:[]};segments.push(segment)}
    segment.points.push(projected)
  }
  return segments.filter(s=>s.points.length>1)
}

/** Descent interpolates altitude logarithmically, keeping time for local tiles to load. */
export function arrivalRadius(fromRadius: number, toRadius: number, t: number) {
  const s=Math.max(0,Math.min(1,t)), ground=toRadius-3/MOON_RADIUS_M
  if(s===0)return fromRadius
  if(s===1)return toRadius
  return ground+Math.exp(Math.log(Math.max(3/MOON_RADIUS_M,fromRadius-ground))*(1-s)+Math.log(3/MOON_RADIUS_M)*s)
}
