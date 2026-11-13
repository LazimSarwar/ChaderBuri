import type { JournalPhoto,Equipment } from './expedition.ts'
import type { FieldReading } from './fieldwork.ts'
export const ARCHIVE_VERSION=1,MAX_RECORDS=80,MAX_PHOTO_BYTES=3_000_000
export type ExpeditionRecord={id:string;siteSlug:string;kind:'visit'|'object'|'assignment';label:string;sceneUTC:string;recordedUTC:string;datasetId:string;model:string}
export type ArchivedPhoto=Omit<JournalPhoto,'imageUrl'>&{blob:Blob}
export type Archive={version:1;photos:ArchivedPhoto[];flags:FieldReading[];inspections:Record<string,FieldReading>;records:ExpeditionRecord[];equipment:Record<string,Equipment>}
export function appendRecord(records:ExpeditionRecord[],record:ExpeditionRecord){return [...records.filter(r=>r.id!==record.id),record].slice(-MAX_RECORDS)}
const text=(v:unknown,max=200)=>typeof v==='string'&&v.length<=max
const date=(v:unknown)=>text(v,40)&&Number.isFinite(Date.parse(v as string))
export function validEquipment(e:unknown):e is Equipment{
 if(!e||typeof e!=='object')return false
 const x=e as Equipment
 return typeof x.panel==='boolean'&&typeof x.antenna==='boolean'&&[x.panelAz,x.panelTilt,x.antennaAz,x.antennaEl].every(Number.isFinite)&&x.panelAz>=0&&x.panelAz<360&&x.antennaAz>=0&&x.antennaAz<360&&x.panelTilt>=0&&x.panelTilt<=90&&Math.abs(x.antennaEl)<=90
}
function validReading(x:FieldReading,has:(slug:string)=>boolean){return x&&text(x.siteSlug)&&has(x.siteSlug)&&text(x.id)&&[x.lat,x.lonEast,x.elevationM,x.slopeDeg,x.rangeM,x.resolutionM,x.sceneRow].every(Number.isFinite)&&Math.abs(x.lat)<=90&&Math.abs(x.lonEast)<=180&&x.slopeDeg>=0&&x.slopeDeg<=90&&x.resolutionM>0&&x.rangeM>=0&&x.rangeM<=2000&&date(x.recordedUTC)&&text(x.demKey)&&text(x.demSource,1000)&&text(x.sourceSha256)}
/** Local records are untrusted input. Invalid entries are discarded individually. */
export function validateArchive(value:unknown,has:(slug:string)=>boolean):Archive|null{
 if(!value||typeof value!=='object'||(value as Archive).version!==ARCHIVE_VERSION)return null
 const x=value as Archive,photos:ArchivedPhoto[]=[]
 for(const p of Array.isArray(x.photos)?x.photos.slice(-6):[]){
  if(!p||!text(p.id)||!text(p.siteSlug)||!has(p.siteSlug)||!text(p.siteName)||!date(p.sceneUTC)||!date(p.capturedUTC)||!text(p.note,280)||!text(p.datasetId)||!text(p.model)||!validEquipment(p.equipment)||!(p.blob instanceof Blob)||p.blob.type!=='image/jpeg'||p.blob.size>MAX_PHOTO_BYTES||p.blob.size===0||![p.width,p.height,p.sceneRow,p.pose?.heading,p.pose?.pitch,p.pose?.fov].every(Number.isFinite)||p.width<=0||p.width>2560||p.height<=0||p.height>2560||p.pose.fov<12||p.pose.fov>80)continue
  photos.push(p)
 }
 const flags=(Array.isArray(x.flags)?x.flags:[]).slice(-8).filter(r=>validReading(r,has)),inspections:Record<string,FieldReading>={}
 for(const r of Object.values(x.inspections??{}).slice(0,24))if(validReading(r,has))inspections[r.siteSlug]=r
 const records=(Array.isArray(x.records)?x.records:[]).slice(-MAX_RECORDS).filter(r=>r&&text(r.id)&&text(r.siteSlug)&&has(r.siteSlug)&&['visit','object','assignment'].includes(r.kind)&&text(r.label,400)&&date(r.sceneUTC)&&date(r.recordedUTC)&&text(r.datasetId)&&text(r.model))
 const equipment:Record<string,Equipment>={};for(const [slug,e] of Object.entries(x.equipment??{}).slice(0,24))if(has(slug)&&validEquipment(e))equipment[slug]=e
 return {version:1,photos,flags,inspections,records,equipment}
}
export async function openExpeditionDB(){
 return new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('landsight-expeditions',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('archive'))r.result.createObjectStore('archive')};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.onblocked=()=>reject(new Error('Journal storage is busy in another tab'))})
}
export async function loadArchive(){const db=await openExpeditionDB();try{return await new Promise<unknown>((resolve,reject)=>{const t=db.transaction('archive','readonly'),r=t.objectStore('archive').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}finally{db.close()}}
export async function writeArchive(value:Archive){const db=await openExpeditionDB();try{await new Promise<void>((resolve,reject)=>{const t=db.transaction('archive','readwrite');t.objectStore('archive').put(value,'current');t.oncomplete=()=>resolve();t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error)})}finally{db.close()}}
