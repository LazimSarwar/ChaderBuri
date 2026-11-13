import type { Mission,Site } from '../data.ts'

export type SurfaceObject = 'lander'|'payload'|'panel'|'antenna'
export type SurfaceSelection={siteSlug:string;object:SurfaceObject;payloadIndex?:number;id:number}
export const OUTPOST_POSITION={eastM:8,northM:-2.5}
export const EQUIPMENT_POSITIONS={panel:{eastM:1.4,northM:1.4},antenna:{eastM:-1.4,northM:1.4}}
/** A mission association needs an explicit catalogue link, never just a nearby target. */
export function surfaceMission(site:Pick<Site,'slug'>,missions:Mission[]){return missions.find(m=>m.siteSlug===site.slug)??null}
export function surfaceProfile(mission:Mission|null){return mission?.vehicle?.includes('Nova')?'nova':mission?'delivery':'concept'}
export function objectBearing(object:SurfaceObject,view:{eastM?:number;northM?:number}){
 const p=object==='panel'||object==='antenna'?EQUIPMENT_POSITIONS[object]:OUTPOST_POSITION
 const east=p.eastM-(view.eastM??0),north=p.northM-(view.northM??0)
 return (Math.atan2(east,north)*180/Math.PI+360)%360
}
export function orientEquipment(e:{panelAz:number;panelTilt:number;antennaAz:number;antennaEl:number},object:'panel'|'antenna',dx:number,dy:number){
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return e
 const bearing=(v:number)=>(v%360+360)%360,clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n))
 return object==='panel'?{...e,panelAz:bearing(e.panelAz+dx*.45),panelTilt:clamp(e.panelTilt-dy*.35,0,90)}:{...e,antennaAz:bearing(e.antennaAz+dx*.45),antennaEl:clamp(e.antennaEl-dy*.35,-90,90)}
}
