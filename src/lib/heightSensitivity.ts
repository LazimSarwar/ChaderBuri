import type { EphRow, Horizon } from '../data.ts'
/** Translate the apparent ray along local up; no differential light-time recomputation. */
export function raisedObserver(row:EphRow,heightM:number):EphRow {
  if(heightM===0)return row
  if(!row.rangeKm)throw new Error('Observer-height sensitivity requires a target range')
  const r=Math.PI/180, horizontal=row.rangeKm*Math.cos(row.el*r),up=row.rangeKm*Math.sin(row.el*r)-heightM/1000
  const range=Math.hypot(horizontal,up)
  return {...row,el:Math.atan2(up,horizontal)/r,rangeKm:range,radiusDeg:row.radiusDeg===undefined?undefined:Math.asin(Math.min(1,Math.sin(row.radiusDeg*r)*row.rangeKm/range))/r}
}
export type HeightReport={schemaVersion:1;slug:string;generatedUTC:string;nominalHorizonSha256:string;demSha256:string;nominalRecomputeMaxDeg:number;profiles:{observerHeightM:number;profile:number[]}[];method:string}
export function validateHeightReport(value:unknown,slug:string,nominalHash:string):asserts value is HeightReport {
  const d=value as HeightReport
  if(!d||d.schemaVersion!==1||d.slug!==slug||d.nominalHorizonSha256!==nominalHash||!Array.isArray(d.profiles)||d.profiles.length!==4||d.profiles.some((p,i)=>p.observerHeightM!==[0,1,3,5][i]||!Array.isArray(p.profile)||p.profile.length!==360||p.profile.some(v=>!Number.isFinite(v)||Math.abs(v)>90)))throw new Error('Height sensitivity does not match this terrain snapshot')
}
export function heightHorizon(base:Horizon,p:HeightReport['profiles'][number]):Horizon{return {...base,observerHeightAboveGroundM:p.observerHeightM,profile:p.profile,maxHorizonDeg:Math.max(...p.profile)}}
