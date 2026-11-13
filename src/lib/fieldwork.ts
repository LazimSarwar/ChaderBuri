import { MOON_RADIUS_M,type VisitPose } from './visit.ts'
export const MAX_FIELD_FLAGS=8
export const PROBE_RANGE_M=2000
export type FieldReading={id:string;siteSlug:string;lat:number;lonEast:number;elevationM:number;slopeDeg:number;rangeM:number;resolutionM:number;demKey:string;demSource:string;sourceSha256:string;sceneRow:number;recordedUTC:string}
export type FieldResult={sequence:number;action:'inspect'|'flag';reading:FieldReading|null;message:string}
export type FieldRequest={id:number;action:'inspect'|'flag'}
/** Geometry of a rendered DEM facet. No procedural surface detail enters these values. */
export function facetReading(point:readonly number[],normal:readonly number[],rangeM:number){
 if(point.length!==3||normal.length!==3||![...point,...normal,rangeM].every(Number.isFinite)||rangeM<0||rangeM>PROBE_RANGE_M)return null
 const radius=Math.hypot(...point),length=Math.hypot(...normal)
 if(radius===0||length===0)return null
 const up=point.map(n=>n/radius),cosine=Math.abs(up.reduce((n,u,i)=>n+u*normal[i]/length,0))
 return {lat:Math.asin(Math.max(-1,Math.min(1,up[1])))*180/Math.PI,lonEast:Math.atan2(-up[2],up[0])*180/Math.PI,
  elevationM:(radius-1)*MOON_RADIUS_M,slopeDeg:Math.acos(Math.min(1,cosine))*180/Math.PI,rangeM}
}
export function appendFlag(flags:FieldReading[],reading:FieldReading){return [...flags.filter(f=>f.id!==reading.id),reading].slice(-MAX_FIELD_FLAGS)}
export function fieldNotebook(siteSlug:string,flags:FieldReading[],last:FieldReading|null,meta:{datasetId:string;model:string;sceneUTC:string;exportedUTC:string}){
 return {schemaVersion:1,kind:'landsight-field-notes',...meta,siteSlug,
  flags:flags.filter(f=>f.siteSlug===siteSlug).slice(-MAX_FIELD_FLAGS),lastInspection:last?.siteSlug===siteSlug?last:null,
  scope:'Coordinates and datum elevations from loaded lunar DEMs; slope describes the rendered DEM facet, not a surveyed hazard. Flags are visitor annotations. Soil texture, lamp and movement are illustrative. No rock composition, suit telemetry or EVA safety is measured.'}
}
export function visitorDistance(a:VisitPose,b:FieldReading){
 const lat=a.lat,lon=a.lonEast
 if(lat===undefined||lon===undefined)return null
 const r=Math.PI/180,p=lat*r,q=b.lat*r,d=(b.lonEast-lon)*r,h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(d/2)**2
 return 2*MOON_RADIUS_M*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))))
}
