import { availableSunFraction,solarFluxScale,angularSep,type SkySample } from './science.ts'
import { generationFor,DEFAULT_POWER } from '../architect/power.ts'
import type { VisitPose } from './visit.ts'
import type { DecisionReflection,DecisionPair } from './explorationDecision.ts'
import type { FieldReading } from './fieldwork.ts'
import type { Site } from '../data.ts'
export const MAX_TRAIL_POINTS=240,MAX_JOURNAL_PHOTOS=6,FOOTSTEP_SPACING_M=.7
export type TrailPoint={eastM:number;northM:number;point:[number,number,number];normal:[number,number,number];heading:number;step:number}
export function appendTrail(points:TrailPoint[],next:TrailPoint){
 const last=points.at(-1),distance=last?Math.hypot(next.eastM-last.eastM,next.northM-last.northM):0
 if(last&&distance<FOOTSTEP_SPACING_M)return {points,distance:0}
 return {points:[...points,next].slice(-MAX_TRAIL_POINTS),distance}
}
export type JournalPhoto={id:string;siteSlug:string;siteName:string;sceneRow:number;sceneUTC:string;capturedUTC:string;pose:VisitPose;light:boolean;equipment:Equipment;trailVisible:boolean;imageUrl:string;note:string;width:number;height:number;datasetId:string;model:string}
export function photoMetadata(p:JournalPhoto){const {imageUrl,...metadata}=p;return {...metadata,scope:'Landsight rendered simulation. LOLA relief; illustrative soil, lighting, visitor trail and equipment. Not lunar photography or a local visibility forecast.'}}
export type Equipment={panel:boolean;antenna:boolean;panelAz:number;panelTilt:number;antennaAz:number;antennaEl:number}
export const DEFAULT_EQUIPMENT:Equipment={panel:false,antenna:false,panelAz:0,panelTilt:0,antennaAz:0,antennaEl:0}
export function equipmentAssessment(e:Equipment,sun:SkySample,earth:SkySample,sunHorizon:number,earthHorizon:number){
 const fraction=availableSunFraction(sun.az,sun.el,earth.az,earth.el,sunHorizon,sun.radiusDeg,earth.radiusDeg)
 const config={...DEFAULT_POWER,orientation:'fixed' as const,tiltDeg:e.panelTilt,azimuthDeg:e.panelAz}
 const watts=generationFor({azimuth:new Float64Array([sun.az]),elevation:new Float64Array([sun.el]),fraction:new Float64Array([fraction]),fluxScale:new Float64Array([solarFluxScale(sun)])},config)[0]
 return {watts,fraction,pointingErrorDeg:angularSep(e.antennaAz,e.antennaEl,earth.az,earth.el),earthVisible:earth.el>earthHorizon}
}
export type AssignmentStep={label:string;done:boolean}
export type AssignmentInput={inspectionId:string|null;flagIds:string[];photoIds:string[];equipmentPhoto:boolean;distanceM:number;targetDistanceM:number;airborne:boolean;equipment:Equipment;comparisonCount:number}
export type AssignmentCompletion={atUTC:string;steps:AssignmentStep[];input:AssignmentInput;inspection:FieldReading|null;flags:FieldReading[];photos:ReturnType<typeof photoMetadata>[]}
export type Assignment={kind:'scout'|'power';siteSlug:string;startedUTC:string;startDistanceM:number;inspectionId:string|null;flagIds:string[];photoIds:string[];panelAz:number;panelTilt:number;comparisonCount:number;decisionRow?:number;reflection?:DecisionReflection;completion?:AssignmentCompletion}
export function captureAssignmentCompletion(run:Assignment,input:AssignmentInput,observations:{inspection:FieldReading|null;flags:FieldReading[];photos:JournalPhoto[]},atUTC=new Date().toISOString()):AssignmentCompletion{
 const steps=assignmentSteps(run,input)
 if(!steps.every(s=>s.done))throw new Error('Field assignment is incomplete')
 return {atUTC,steps,input:{...input,equipment:{...input.equipment},flagIds:[...input.flagIds],photoIds:[...input.photoIds]},inspection:observations.inspection,flags:[...observations.flags],photos:observations.photos.map(photoMetadata)}
}
export function buildExpeditionDebrief(p:{site:Pick<Site,'slug'|'lat'|'lonEast'>;observerHeightM:number;sceneUTC:string;datasetId:string;model:string;assignment:Assignment;steps:ReturnType<typeof assignmentSteps>;comparison:DecisionPair;inspection:FieldReading|null;flags:FieldReading[];photos:JournalPhoto[];equipment:Equipment}){
 if(p.steps.length!==4||!p.steps.every(s=>s.done))throw new Error('Complete the field tasks before exporting a decision debrief')
 if(p.assignment.siteSlug!==p.site.slug||p.comparison.siteSlug!==p.site.slug)throw new Error('Debrief evidence belongs to another site')
 if(p.assignment.decisionRow!==undefined&&p.assignment.decisionRow!==p.comparison.rowA)throw new Error('Debrief comparison must retain the assignment starting date')
 const reflection=p.assignment.reflection
 if(p.comparison.recommendation!==null&&(!reflection?.reason.trim()||reflection.reason.length>280||!reflection.reviewedUTC||!Number.isFinite(Date.parse(reflection.reviewedUTC))))throw new Error('Review your decision and reason before exporting')
 return {schemaVersion:2,kind:'landsight-expedition-debrief',datasetId:p.datasetId,model:p.model,sceneUTC:p.sceneUTC,assessment:{siteSlug:p.site.slug,lat:p.site.lat,lonEast:p.site.lonEast,observerHeightAboveGroundM:p.observerHeightM},assignment:p.assignment,steps:p.steps,comparison:p.comparison,inspection:p.inspection,flags:p.flags,photos:p.photos.map(photoMetadata),equipment:p.equipment,scope:'Field-task completion and nominal target/date comparison. No EVA or landing-safety certification; visitor movement does not recalculate horizons. Thermal, RF and footprint are excluded from this comparison.'}
}
export function assignmentSteps(run:Assignment,input:AssignmentInput):AssignmentStep[]{
 const photo=input.photoIds.some(id=>!run.photoIds.includes(id))
 return run.kind==='scout'?[
  {label:'Inspect a patch of ground',done:!!input.inspectionId&&input.inspectionId!==run.inspectionId},
  {label:'Plant a survey flag',done:input.flagIds.some(id=>!run.flagIds.includes(id))},
  {label:'Photograph your observation',done:photo},
  {label:'Travel at least 5 m, then return within 2 m of the target',done:input.distanceM-run.startDistanceM>=5&&input.targetDistanceM<=2&&!input.airborne},
 ]:[
  {label:'Deploy a panel at the landing target',done:input.equipment.panel},
  {label:'Change the panel orientation',done:input.equipment.panel&&(Math.abs(input.equipment.panelAz-run.panelAz)>.1||Math.abs(input.equipment.panelTilt-run.panelTilt)>.1)},
  {label:'Take a photo with the panel deployed',done:photo&&input.equipmentPhoto},
  {label:'Compare the panel in mission planning',done:input.comparisonCount>run.comparisonCount},
 ]
}
