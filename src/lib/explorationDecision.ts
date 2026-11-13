import { evaluateWindow,type Constraints,type Evaluated,type SiteSeries } from '../architect/solver.ts'
import type { DecisionStory } from './decisionStory.ts'

export type DecisionChoice='a'|'b'|'either'|'neither'
export type DecisionReflection={choice:DecisionChoice;reason:string;reviewedUTC?:string}
export type DecisionGuide={originRow:number;step:0|1|2;compared:boolean;ended?:boolean;story?:DecisionStory;source?:{datasetId:string;model:string}}
export type DecisionPair={siteSlug:string;rowA:number;rowB:number;utcA:string;utcB:string;constraints:Constraints;a:Evaluated|null;b:Evaluated|null;recommendation:DecisionChoice|null}
/** Two complete, identical missions. No clamping, extrapolation or invented pass. */
export function explorationDecision(series:SiteSeries,row:number,startMs:number,c:Constraints):DecisionPair{
 if(!Number.isFinite(row)||row<0||!Number.isFinite(startMs))throw new Error('Invalid exploration decision epoch')
 const rowA=Math.round(row),rowB=rowA+7*24,hours=c.missionDays*24
 const assess=(r:number)=>Number.isInteger(hours)&&hours>0&&r+hours<=series.hours?evaluateWindow(series,r,r+hours,c):null
 const a=assess(rowA),b=assess(rowB)
 const recommendation=!a||!b?null:!a.pass&&!b.pass?'neither':a.pass&&!b.pass?'a':b.pass&&!a.pass?'b':Math.abs(a.margin-b.margin)<=1e-6?'either':a.margin>b.margin?'a':'b'
 return {siteSlug:series.slug,rowA,rowB,utcA:new Date(startMs+rowA*3600000).toISOString(),utcB:new Date(startMs+rowB*3600000).toISOString(),constraints:{...c,power:c.power?{...c.power}:undefined,thermal:c.thermal?{...c.thermal}:undefined},a,b,recommendation}
}
export function decisionFailures(r:Evaluated):string[]{
 return [!r.ok.lit&&'sunlight duration',!r.ok.dark&&'longest darkness',!r.ok.link&&'Earth visibility duration',!r.ok.gap&&'longest Earth outage',r.power&&!r.power.pass&&'battery reserve / unsupplied energy',r.thermal&&!r.thermal.pass&&'thermal survival'].filter((s):s is string=>!!s)
}
export function decisionTakeaway(pair:DecisionPair){
 switch(pair.recommendation){
  case 'a':return pair.b?.pass?"Both pass nominal requirements; A has more margin against its tightest requirement under the planner's scoring.":'A passes nominal requirements; B misses at least one. Prefer A for these assumptions.'
  case 'b':return pair.a?.pass?"Both pass nominal requirements; B has more margin against its tightest requirement under the planner's scoring.":'B passes nominal requirements; A misses at least one. Prefer B for these assumptions.'
  case 'either':return 'Both pass with equal nominal margin at the comparison tolerance. These checks do not distinguish a preferred date.'
  case 'neither':return 'Neither date meets all nominal requirements. Change the date, site or hardware and recheck in the planner.'
  default:return 'A complete comparison is unavailable within cached coverage. No preferred date is inferred.'
 }
}
