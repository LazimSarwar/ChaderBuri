import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { appendRecord,validateArchive,validEquipment,MAX_RECORDS,MAX_PHOTO_BYTES,type Archive,type ExpeditionRecord } from '../src/lib/expeditionArchive.ts'
import { orientEquipment,surfaceMission,surfaceProfile,objectBearing } from '../src/lib/surfaceMission.ts'
import { DEFAULT_EQUIPMENT,equipmentAssessment } from '../src/lib/expedition.ts'
import type { Mission } from '../src/data.ts'
import type { FieldReading } from '../src/lib/fieldwork.ts'
let checks=0
const check=(x:unknown,message:string)=>{assert.ok(x,message);checks++}
const e={...DEFAULT_EQUIPMENT,panel:true,panelAz:358,panelTilt:45}
const turned=orientEquipment(e,'panel',20,20)
check(turned.panelAz===7&&turned.panelTilt===38,'Scene drag wraps azimuth and changes panel tilt')
check(e.panelAz===358&&e.panelTilt===45,'Dragging does not mutate the previous orientation')
check(orientEquipment(e,'panel',0,-1000).panelTilt===90,'Panel drag clamps at upright')
check(orientEquipment(e,'panel',0,1000).panelTilt===0,'Panel drag clamps at horizontal')
check(orientEquipment(e,'antenna',-20,-1000).antennaAz===351,'Antenna bearing wraps through north')
check(orientEquipment(e,'antenna',0,-1000).antennaEl===90,'Antenna elevation stays physical')
check(orientEquipment(e,'antenna',0,1000).antennaEl===-90,'Antenna lower elevation stays physical')
check(orientEquipment(e,'panel',NaN,0)===e,'Invalid pointer data does not corrupt hardware')
check(objectBearing('panel',{})===45&&objectBearing('antenna',{})===315,'Equipment bearings match the rendered ENU placement')
const sun={az:90,el:45},earth={az:0,el:0},wrong={...e,panelAz:270,panelTilt:90},right={...e,panelAz:90,panelTilt:45}
check(equipmentAssessment(wrong,sun,earth,0,1).watts===0,'A panel facing away produces no power')
check(Math.abs(equipmentAssessment(right,sun,earth,0,1).watts-762.16)<.001,'Pointing at sunlight uses the existing numerical model')
check(!equipmentAssessment(right,sun,earth,0,1).earthVisible,'Pointing cannot override terrain obstruction')
const missions=JSON.parse(readFileSync('public/data/missions.json','utf8')) as Mission[]
check(surfaceMission({slug:'malapert-massif'},missions)===null,'Candidate regions do not acquire a nearby historical lander')
const im=surfaceMission({slug:'im-1-odysseus-site'},missions)
check(im?.name==='IM-1 Odysseus'&&surfaceProfile(im)==='nova','An explicitly linked mission gets its own exhibit profile')
check(surfaceProfile(null)==='concept','An unassigned target receives a labelled concept station')
const record:ExpeditionRecord={id:'visit:a',siteSlug:'a',kind:'visit',label:'Visited A',sceneUTC:'2026-10-17T00:00:00Z',recordedUTC:'2026-11-01T00:00:00Z',datasetId:'original-dataset',model:'original-model'}
let records:ExpeditionRecord[]=[]
for(let i=0;i<120;i++)records=appendRecord(records,{...record,id:String(i)})
check(records.length===MAX_RECORDS&&records[0].id==='40','Long expedition history has a bounded archive')
check(appendRecord(records,records.at(-1)!).length===MAX_RECORDS,'Rediscovery does not duplicate a record')
const photo={id:'p',siteSlug:'a',siteName:'A',sceneRow:1,sceneUTC:record.sceneUTC,capturedUTC:record.recordedUTC,pose:{heading:0,pitch:0,fov:60},light:true,equipment:e,trailVisible:false,note:'Observed shadows',width:800,height:900,datasetId:record.datasetId,model:record.model,blob:new Blob(['image'],{type:'image/jpeg'})}
const archive:Archive={version:1,photos:[photo],flags:[],inspections:{},records:[record],equipment:{a:e}}
const has=(slug:string)=>slug==='a'
const restored=validateArchive(structuredClone(archive),has)!
check(restored.photos.length===1&&restored.records[0].datasetId==='original-dataset','Structured clone retains the photograph and original provenance')
check(await restored.photos[0].blob.text()==='image','Image bytes survive archive validation')
check(restored.equipment.a.panelTilt===45,'Equipment settings survive validation')
check(validateArchive({...archive,photos:[{...photo,pose:{...photo.pose,fov:12}}]},has)!.photos.length===1,'The narrowest supported exploration lens survives reload')
for(const mutation of [null,{}, {version:2},'junk'])check(validateArchive(mutation,has)===null,'Unsupported archive is not restored')
for(const mutation of [{siteSlug:'other'},{blob:new Blob(['x'],{type:'text/html'})},{blob:new Blob([new Uint8Array(MAX_PHOTO_BYTES+1)],{type:'image/jpeg'})},{pose:{heading:NaN,pitch:0,fov:60}},{note:'x'.repeat(281)},{sceneRow:Infinity},{width:-1},{equipment:{...e,panelTilt:100}}]){
 const result=validateArchive({...archive,photos:[{...photo,...mutation},photo]},has)!
 check(result.photos.length===1,'Bad photograph is isolated without discarding valid observations')
}
check(validateArchive({...archive,records:[{...record,kind:'script'},record]},has)!.records.length===1,'Unrecognized record kind is discarded')
const flag:FieldReading={id:'flag',siteSlug:'a',lat:-80,lonEast:1,elevationM:500,slopeDeg:4,rangeM:10,resolutionM:20,demKey:'polar20',demSource:'LOLA',sourceSha256:'original-sha',sceneRow:1104,recordedUTC:record.recordedUTC}
const field=validateArchive({...archive,flags:[flag],inspections:{a:flag}},has)!
check(field.flags.length===1&&field.inspections.a.sourceSha256==='original-sha','Flags and inspections preserve their original DEM fingerprint')
for(const mutation of [{lat:NaN},{siteSlug:'other'},{slopeDeg:91},{resolutionM:0},{recordedUTC:'invalid'},{rangeM:2001}])check(validateArchive({...archive,flags:[{...flag,...mutation},flag]},has)!.flags.length===1,'Malformed field evidence is isolated during restore')
for(const value of [null,{}, {...e,panelAz:360},{...e,panelTilt:-1},{...e,antennaEl:Infinity}])check(!validEquipment(value),'Invalid stored orientations are rejected')
console.log(`Surface interaction and archive checks passed: ${checks}`)
