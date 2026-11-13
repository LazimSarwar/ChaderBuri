import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { viewpointCoordinates,stepViewpoint,checkedViewpointStep,lookTarget,eventJourney,EXPLORATION_RADIUS_M } from '../src/lib/surfaceExplorer.ts'
import { siteSeparation } from '../src/lib/visit.ts'
import { advanceAstronaut,launchAstronaut,standingAstronaut,walkingVelocity,motionDelta,LUNAR_GRAVITY_MPS2,JUMP_SPEED_MPS,WALK_SPEED_MPS,MAX_MOTION_DELTA_S } from '../src/lib/astronautMotion.ts'
import { facetReading,appendFlag,fieldNotebook,visitorDistance,MAX_FIELD_FLAGS,PROBE_RANGE_M,type FieldReading } from '../src/lib/fieldwork.ts'
import { appendTrail,MAX_TRAIL_POINTS,photoMetadata,equipmentAssessment,DEFAULT_EQUIPMENT,assignmentSteps,type JournalPhoto,type TrailPoint,type Assignment } from '../src/lib/expedition.ts'
let checks=0
const check=(condition:unknown,message:string)=>{assert.ok(condition,message);checks++}
const close=(a:number,b:number,tolerance=1e-6)=>check(Math.abs(a-b)<tolerance,`${a} ≈ ${b}`)
const zero={eastM:0,northM:0}
close(stepViewpoint(zero,0,1,0,5).northM,5)
close(stepViewpoint(zero,90,1,0,5).eastM,5)
close(stepViewpoint(zero,0,0,1,5).eastM,5)
close(stepViewpoint(zero,90,0,1,5).northM,-5)
const diagonal=stepViewpoint(zero,0,1,1,5)
close(Math.hypot(diagonal.eastM,diagonal.northM),5)
const sites=JSON.parse(readFileSync('public/data/sites.json','utf8')) as {lat:number;lonEast:number}[]
for(const site of [...sites,{lat:90,lonEast:179.99},{lat:-90,lonEast:-179.99},{lat:0,lonEast:179.999}]){
 for(const offset of [zero,{eastM:250,northM:0},{eastM:0,northM:-250},{eastM:-100,northM:100}]){
  const point=viewpointCoordinates(site,offset)
  check(Number.isFinite(point.lat)&&Math.abs(point.lat)<=90&&Math.abs(point.lonEast)<=180,'Viewpoint coordinates remain valid at poles and longitude wrapping')
  close(siteSeparation(site,point).distanceM,Math.hypot(offset.eastM,offset.northM),.001)
 }
}
let offset=zero
for(let i=0;i<200;i++){
 const step=stepViewpoint(offset,31,1,1,5)
 check(Math.hypot(step.eastM,step.northM)<=EXPLORATION_RADIUS_M+1e-8,'Repeated navigation never leaves the 250 m exploration region')
 offset=step
}
check(stepViewpoint(offset,31,1,1,5).limited,'Boundary feedback is explicit')
const before={eastM:10,northM:20}
const missing=checkedViewpointStep(sites[0],before,0,1,0,5,()=>null)
check(missing.blocked&&missing.reason==='terrain'&&missing.eastM===before.eastM&&missing.northM===before.northM,'Missing terrain does not move the camera onto invented ground')
check(checkedViewpointStep(sites[0],before,0,1,0,5,()=>NaN).blocked,'Nonfinite height is unavailable terrain')
close(checkedViewpointStep(sites[0],before,0,1,0,5,()=>1000).northM,25)
for(const invalid of [NaN,Infinity,-1]){assert.throws(()=>stepViewpoint(zero,0,1,0,invalid));checks++}
close(lookTarget({heading:359,pitch:0},{az:1,el:0}).horizontal,2)
close(lookTarget({heading:1,pitch:0},{az:359,el:0}).horizontal,-2)
check(lookTarget({heading:35,pitch:25},{az:35,el:25}).centred,'An actually centred direction meets the activity threshold')
check(!lookTarget({heading:35,pitch:0},{az:35,el:25}).centred,'Matching bearing alone does not complete a direction activity')
check(!lookTarget({heading:35,pitch:0},{az:215,el:0}).centred,'A target behind the observer cannot complete an activity')
const journey=eventJourney(100,5,200)!
check(journey.startRow===104&&journey.eventRow===105&&journey.endRow===106,'Time journey brackets the actual estimated event')
check(eventJourney(100,null,200)===null&&eventJourney(100,0,200)===null&&eventJourney(100,101,200)===null,'Absent, current-state or uncached events cannot invent a future journey')
check(eventJourney(199,1,200)?.endRow===200&&eventJourney(0,.5,200)?.startRow===0,'Cache-edge journeys clip to real data without moving the event')
// Constant-g motion is checked against analytic height, time and energy, across frame rates.
for(const fps of [20,30,60,120]){
 const ground=5000,dt=1/fps
 let body=launchAstronaut(standingAstronaut(),ground,walkingVelocity(90,1,0)),peak=0,elapsed=0
 close(body.eastMps,WALK_SPEED_MPS);close(body.northMps,0)
 check(advanceAstronaut(body,ground,0)===body,'A zero-duration launch frame does not cancel a jump')
 while(body.airborne&&elapsed<5){
  body=advanceAstronaut(body,ground,dt);elapsed+=dt
  const height=body.feetM!-ground;peak=Math.max(peak,height)
  check(height>=0,'Feet never pass below the sampled surface')
  if(body.airborne){
   close(height,JUMP_SPEED_MPS*elapsed-.5*LUNAR_GRAVITY_MPS2*elapsed*elapsed,1e-8)
   close(body.verticalMps**2/2+LUNAR_GRAVITY_MPS2*height,JUMP_SPEED_MPS**2/2,1e-8)
   close(body.eastMps,WALK_SPEED_MPS)
  }
 }
 check(!body.airborne&&body.verticalMps===0&&body.eastMps===0&&body.feetM===ground,'Landing restores ground contact and clears jump momentum')
 check(Math.abs(elapsed-2*JUMP_SPEED_MPS/LUNAR_GRAVITY_MPS2)<=dt+1e-8,'Flight time matches constant lunar gravity to one frame')
 close(peak,JUMP_SPEED_MPS**2/(2*LUNAR_GRAVITY_MPS2),.003)
}
for(const heading of [0,45,90,180,270])for(const input of [[1,0],[0,1],[1,1],[-1,1]]){
 const velocity=walkingVelocity(heading,...input as [number,number])
 close(Math.hypot(velocity.eastMps,velocity.northMps),WALK_SPEED_MPS)
}
close(walkingVelocity(0,0,0).eastMps,0)
close(walkingVelocity(0,1,0).northMps,WALK_SPEED_MPS)
const launched=launchAstronaut(standingAstronaut(),100,walkingVelocity(0,1,0))
check(launchAstronaut(launched,100,walkingVelocity(90,1,0))===launched,'Airborne input cannot double jump or redirect take-off momentum')
for(const missingGround of [null,NaN,Infinity]){
 const grounded=standingAstronaut()
 check(launchAstronaut(grounded,missingGround,walkingVelocity(0,1,0))===grounded,'No jump launches without finite measured ground')
 check(advanceAstronaut(launched,missingGround,.02)===launched,'A missing DEM pauses motion without inventing a landing')
}
const ascent=advanceAstronaut(launched,100,.05)
check(advanceAstronaut(ascent,101,.05).feetM===101&&!advanceAstronaut(ascent,101,.05).airborne,'Rising terrain resolves contact without passing through the ground')
close(advanceAstronaut(standingAstronaut(),123,.02).feetM!,123)
close(motionDelta(50),MAX_MOTION_DELTA_S)
close(advanceAstronaut(launched,100,50).feetM!,100+JUMP_SPEED_MPS*MAX_MOTION_DELTA_S-.5*LUNAR_GRAVITY_MPS2*MAX_MOTION_DELTA_S**2)
for(const invalid of [-1,NaN,Infinity]){assert.throws(()=>motionDelta(invalid));checks++}
for(const slope of [0,15,45,80,90]){
 const angle=slope*Math.PI/180,reading=facetReading([0,-1,0],[Math.sin(angle),-Math.cos(angle),0],1.7)!
 close(reading.slopeDeg,slope);close(reading.lat,-90);close(reading.elevationM,0)
}
check(facetReading([0,0,0],[0,1,0],1)===null,'A zero-radius probe cannot invent a lunar coordinate')
check(facetReading([0,1,0],[0,0,0],1)===null,'A missing normal cannot invent a facet slope')
for(const range of [-1,NaN,Infinity,PROBE_RANGE_M+1])check(facetReading([0,1,0],[0,1,0],range)===null,'Invalid or out-of-range probes fail closed')
check(facetReading([NaN,1,0],[0,1,0],1)===null,'Nonfinite probe position fails closed')
const flag:FieldReading={id:'first',siteSlug:'a',lat:-90,lonEast:0,elevationM:100,slopeDeg:5,rangeM:1.7,resolutionM:20,demKey:'polar20',demSource:'LOLA',sourceSha256:'source-hash',sceneRow:1104,recordedUTC:'2026-10-31T00:00:00Z'}
let flags:FieldReading[]=[]
for(let i=0;i<30;i++)flags=appendFlag(flags,{...flag,id:String(i),siteSlug:i%2?'a':'b'})
check(flags.length===MAX_FIELD_FLAGS&&flags[0].id==='22'&&flags.at(-1)?.id==='29','Field annotations have an explicit bounded memory budget')
check(appendFlag(flags,flags[0]).length===MAX_FIELD_FLAGS,'Reusing an annotation id does not duplicate it')
close(visitorDistance({heading:0,pitch:0,fov:60,lat:-90,lonEast:0},flag)!,0)
check(visitorDistance({heading:0,pitch:0,fov:60},flag)===null,'Unknown camera position does not invent a flag distance')
const notebook=fieldNotebook('a',flags,flag,{datasetId:'snapshot',model:'model-v1',sceneUTC:'2026-10-17T00:00:00Z',exportedUTC:'2026-10-31T00:00:00Z'})
check(notebook.flags.every(f=>f.siteSlug==='a')&&notebook.lastInspection?.id==='first','Notebook keeps the selected site separate')
check(notebook.scope.includes('illustrative')&&notebook.scope.includes('rendered DEM facet')&&notebook.datasetId==='snapshot','Export retains provenance and measured/illustrative scope')
check(fieldNotebook('b',flags,flag,{datasetId:'d',model:'m',sceneUTC:'s',exportedUTC:'e'}).lastInspection===null,'A previous-site inspection cannot leak into another site notebook')
let trail:TrailPoint[]=[],tracked=0
for(let i=0;i<300;i++){
 const result=appendTrail(trail,{eastM:i,northM:0,point:[0,1,0],normal:[0,1,0],heading:90,step:i});trail=result.points;tracked+=result.distance
 check(trail.length<=MAX_TRAIL_POINTS,'Trail memory stays bounded during long excursions')
}
close(tracked,299)
check(trail[0].step===60&&trail.at(-1)?.step===299,'Oldest footprint samples are evicted without changing footfall identity')
check(appendTrail(trail,{...trail.at(-1)!,eastM:299.1}).points===trail,'Sub-footstep movement does not create duplicate prints')
const sun={az:180,el:45},earth={az:90,el:0}
const flatPanel=equipmentAssessment({...DEFAULT_EQUIPMENT,panel:true},sun,earth,0,-1)
const aimedPanel=equipmentAssessment({...DEFAULT_EQUIPMENT,panel:true,panelTilt:45,panelAz:180},sun,earth,0,-1)
close(flatPanel.watts,1361*2*.28*Math.sin(Math.PI/4),1e-6)
close(aimedPanel.watts,1361*2*.28,1e-6)
close(equipmentAssessment({...DEFAULT_EQUIPMENT,panelTilt:90,panelAz:0},sun,earth,0,-1).watts,0)
close(equipmentAssessment(DEFAULT_EQUIPMENT,sun,earth,50,-1).watts,0)
close(equipmentAssessment(DEFAULT_EQUIPMENT,{...sun,rangeKm:149597870.7*2},earth,0,-1).watts,flatPanel.watts/4)
const hiddenEarth=equipmentAssessment({...DEFAULT_EQUIPMENT,antennaAz:90,antennaEl:0},sun,earth,0,2)
close(hiddenEarth.pointingErrorDeg,0,1e-5);check(!hiddenEarth.earthVisible,'An aimed antenna does not turn a masked Earth into a visible radio path')
const photo:JournalPhoto={id:'new-photo',siteSlug:'a',siteName:'A',sceneRow:1104,sceneUTC:'2026-10-17T00:00:00Z',capturedUTC:'2026-11-01T00:00:00Z',pose:{heading:12,pitch:-20,fov:60},light:true,equipment:{...DEFAULT_EQUIPMENT,panel:true},trailVisible:true,imageUrl:'blob:temporary',note:'A darker patch',width:800,height:900,datasetId:'dataset',model:'model'}
const metadata=photoMetadata(photo)
check(!('imageUrl' in metadata)&&metadata.note===photo.note&&metadata.light&&metadata.equipment.panel&&metadata.scope.includes('simulation'),'Photo export keeps provenance and observations without transient blob URLs')
const scout:Assignment={kind:'scout',siteSlug:'a',startedUTC:'now',startDistanceM:10,inspectionId:'old',flagIds:['old-flag'],photoIds:['old-photo'],panelAz:0,panelTilt:0,comparisonCount:0}
const evidence={inspectionId:'new',flagIds:['old-flag','new-flag'],photoIds:['new-photo'],equipmentPhoto:true,distanceM:16,targetDistanceM:1,airborne:false,equipment:{...DEFAULT_EQUIPMENT,panel:true,panelTilt:45},comparisonCount:1}
check(assignmentSteps(scout,evidence).every(s=>s.done),'A scout debrief requires the complete fresh observation/mark/photo/return workflow')
check(!assignmentSteps(scout,{...evidence,distanceM:12})[3].done,'Distance before starting the assignment cannot satisfy its travel step')
check(!assignmentSteps(scout,{...evidence,airborne:true})[3].done,'A jump over the landing target does not complete a grounded return')
check(assignmentSteps(scout,{...evidence,inspectionId:'old',flagIds:scout.flagIds,photoIds:scout.photoIds}).filter(s=>s.done).length===1,'Old observations and photos do not auto-complete a new scout assignment')
check(assignmentSteps({...scout,kind:'power'},evidence).every(s=>s.done),'Power assignment requires deployment, changed orientation, a deployed-panel photo and planner handoff')
check(!assignmentSteps({...scout,kind:'power'},{...evidence,equipmentPhoto:false})[2].done,'A photograph taken without the panel does not count as an equipment photo')
check(!assignmentSteps({...scout,kind:'power'},{...evidence,comparisonCount:0})[3].done,'Opening tools without a comparison does not complete planner handoff')
console.log(`Surface exploration, physics, fieldwork and expedition checks passed: ${checks}`)
