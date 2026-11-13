import { cloneConstraints,decodeScenarios,comparisonReport,type Scn } from '../architect/comparison.ts'
import { buildMissionBrief } from '../architect/missionBrief.ts'
import type { SensitiveDateContext } from './sensitiveDate.ts'
import type { DecisionGuide } from './explorationDecision.ts'
import type { PredictionIndex } from './predictionIndex.ts'
import type { Site } from '../data.ts'

export type DecisionStory={original:Scn;repair?:Scn;later?:Scn;reason:string}
export const storyScenarios=(story:DecisionStory)=>[story.original,story.repair,story.later].filter((s):s is Scn=>!!s).map((s,id)=>({...s,id,c:cloneConstraints(s.c)}))
export function encodeJourney(slug:string,guide:DecisionGuide){return JSON.stringify({v:1,slug,guide})}
/** Untrusted links/storage use the planner's input limits; no inferred outcomes. */
export function decodeJourney(raw:string|null,has:(slug:string)=>boolean):{slug:string;guide:DecisionGuide}|null{
 if(!raw||raw.length>8192)return null
 try{
  const value=JSON.parse(raw),g=value.guide
  if(value.v!==1||!has(value.slug)||!g||!Number.isInteger(g.originRow)||g.originRow<0||g.originRow>100000||![0,1,2].includes(g.step)||typeof g.compared!=='boolean')return null
  let story:DecisionStory|undefined
  if(g.ended!==undefined&&typeof g.ended!=='boolean')return null
  if(g.story){
   const t=g.story
   if(typeof t.reason!=='string'||t.reason.length>280||!t.original)return null
   const scns=decodeScenarios(JSON.stringify([t.original,...(t.repair?[t.repair]:[]),...(t.later?[t.later]:[])]),has)
   if(!scns||scns.some(s=>s.slug!==value.slug)||![g.originRow,g.originRow+168].includes(scns[0].row))return null
   const original=scns[0],repair=t.repair?scns[1]:undefined,later=t.later?scns.at(-1):undefined,base=repair??original
   if(repair){
    if(repair.row!==original.row||!original.c.power||!repair.c.power)return null
    const {power:a,...ca}=original.c,{power:b,...cb}=repair.c
    if(JSON.stringify(ca)!==JSON.stringify(cb))return null
    const changed=Object.keys(a).filter(k=>a[k as keyof typeof a]!==b[k as keyof typeof b])
    if(changed.length!==1||!['panelAreaM2','capacityWh','loadW'].includes(changed[0]))return null
   }
   if(later&&(later.row<=base.row||later.row-base.row>2160||(later.row-base.row)%6!==0||JSON.stringify(later.c)!==JSON.stringify(base.c)))return null
   story={original,repair,later,reason:t.reason}
  }
  const source=g.source
  if(source&&(typeof source.datasetId!=='string'||!/^[a-f0-9]{64}$/.test(source.datasetId)||typeof source.model!=='string'||!/^screening-v2-[a-f0-9]{12}$/.test(source.model)))return null
  return {slug:value.slug,guide:{originRow:g.originRow,step:g.step,compared:g.compared,ended:g.ended,story,source:source?{datasetId:source.datasetId,model:source.model}:undefined}}
 }catch{return null}
}
export function journeyURL(base:string,slug:string,guide:DecisionGuide,index:PredictionIndex){
 const url=new URL(base)
 for(const key of ['compare','plan','view','c'])url.searchParams.delete(key)
 url.searchParams.set('site',slug);url.searchParams.set('t',String(guide.originRow))
 url.searchParams.set('journey',encodeJourney(slug,guide));url.searchParams.set('dataset',index.datasetId);url.searchParams.set('model',index.model.version)
 return url.toString()
}
export function buildDecisionReceipt(index:PredictionIndex,guide:DecisionGuide,context:SensitiveDateContext,site:Site,generatedUTC=new Date().toISOString()){
 if(!guide.story)throw new Error('No decision story recorded')
 const validated=decodeJourney(encodeJourney(site.slug,guide),slug=>slug===site.slug)
 if(!validated)throw new Error('Invalid decision story')
 const scenarios=storyScenarios(validated.guide.story!),start=Date.parse(index.coverage.start)
 if(scenarios.some(s=>s.row+s.c.missionDays*24>context.series.hours))throw new Error('Complete decision outside cached coverage')
 const stages=['Original mission',...(guide.story.repair?['Hardware repair']:[]),...(guide.story.later?['Later landing date']:[])]
 const geometry={eph:{[site.slug]:{sun:context.sun,earth:context.earth}},horizons:{[site.slug]:context.horizon},products:{[site.slug]:context.products}}
 const report=comparisonReport(index,scenarios,new Map([[site.slug,context.series]]),generatedUTC,geometry)
 const brief={...buildMissionBrief(index,scenarios,new Map([[site.slug,context.series]]),[site],geometry.eph,geometry.horizons,geometry.products,generatedUTC,'comparison'),decision:{reason:guide.story.reason,stages,originUTC:new Date(start+guide.originRow*3600000).toISOString()}}
 return {schemaVersion:1,kind:'landsight-decision-receipt',generatedUTC,stages,reason:guide.story.reason,recordedSource:guide.source??null,journey:{slug:site.slug,guide:validated.guide},report,brief,scope:'Calculated screening decisions at the fixed target. Footprint samples exclude thermal and RF. Counts are not probabilities or continuous safety assessments. The receipt records the current calculation snapshot; preserved input products are required to reproduce an older model.'}
}
