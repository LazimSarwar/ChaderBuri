import { readGuideAction, type GuideAction, type GuideView } from './guideAction.ts'
import type { Constraints } from '../architect/solver.ts'
import { parseScenario } from '../architect/scenario.ts'
import { cleanDigestItems,type GuideSuggestion,type ScreenDigest } from './contracts.ts'

/** The two options on the Compare page (sites: same landing row; dates: same site). */
export type CompareContext={mode:'sites'|'dates';a:{slug:string;row:number};b:{slug:string;row:number}}
/** basis: 'mission' = the visitor's selected mission in the mission plan; 'scene' = the 3D scene's site and clock with the guide's illustrative lander. compare: the options on screen, explained in place. */
export type CompanionContext={view?:GuideView;basis?:'mission'|'scene';compare?:CompareContext;slug:string;row:number;constraints:Constraints;datasetId:string;model:string}
export type CompanionMessage={role:'user'|'assistant';content:string}
export type CompanionSite={slug:string;name:string;pass:boolean;margin:number;failures:string[];minBatteryPct:number|null;sunPct:number;earthPct:number;outageWithinMissionH:number;darkWithinMissionH:number;sunClearanceDeg:number;earthClearanceDeg:number;footprint:{passing:number;total:number}|null}
/** The same mission at the same site, landing a few days earlier or later (whole days). */
export type CompanionNearbyDate={offsetDays:number;landingUTC:string;pass:boolean;minBatteryPct:number|null;darkWithinMissionH:number;outageWithinMissionH:number;failures:string[]}
/** The visitor's own limits from the mission plan: never NASA requirements or safety limits. */
export type CompanionRequirements={selectedBy:'visitor';reservePct:number|null;minSunPct:number;minEarthPct:number;maxDarkH:number;maxEarthGapH:number;missionDays:number;note:string}
export type CompanionOption={id:'A'|'B';label:string;site:string;landingUTC:string;pass:boolean|null;failures:string[];minBatteryPct:number|null;solarEnergyKWh:number|null;sunPct:number|null;earthPct:number|null;darkWithinMissionH:number|null;outageWithinMissionH:number|null}
/** A fair comparison computed by the same code as the Compare page: the only source for its facts and causes. */
export type CompanionComparison={mode:'sites'|'dates';kept:string[];change:string;options:CompanionOption[];verdict:string;summary:string;metrics:{label:string;a:string;b:string;change:string;diff:string}[];causes:string[];energyByCause:{cause:string;kWh:number}[]|null;panel:string|null}
export type CompanionEvidence={context:CompanionContext;landingUTC:string;endUTC:string;observerHeightM:number;sites:CompanionSite[];eligibleSlugs:string[];unavailableSlugs:string[];scope:string[];nearbyDates?:CompanionNearbyDate[];requirements?:CompanionRequirements;comparison?:CompanionComparison}
export type CompanionMission={missionDays:number;loadW:number;panelAreaM2:number}
export type CompanionReply={action?:GuideAction|null;suggestion?:GuideSuggestion|null;message:string;visitSlug:string|null;focus:'sun'|'earth'|'skyline'|'none';questions:string[];proposedMission:CompanionMission|null}
/** Not part of the scene context: readouts change every hour and must not retire turns. */
export type CompanionExtras={screen?:ScreenDigest|null;dismissed?:string[]}
export type CompanionTurn={question:string;reply:CompanionReply;evidence:CompanionEvidence;at?:number}
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value
export const contextKey=(c:CompanionContext)=>JSON.stringify(canonical(c))

export function parseCompanionRequest(raw:unknown){
 const r=raw as {context:CompanionContext;messages:CompanionMessage[]}&CompanionExtras
 if(!r?.context||!Array.isArray(r.messages)||r.messages.length<1||r.messages.length>10)throw new Error('A mission context and up to ten messages are required')
 const c=r.context
 if(!/^[a-z0-9-]{1,80}$/.test(c.slug)||!Number.isInteger(c.row)||c.row<0||c.row>100000||!/^[a-f0-9]{64}$/.test(c.datasetId)||typeof c.model!=='string'||c.model.length>100)throw new Error('Invalid mission context')
 if(c.view && (!['orbit','surface','selection','sites','conditions','plan','compare','evidence','atlas','validation','glossary','setup','guide','weather'].includes(c.view.screen)||typeof c.view.search!=='string'||c.view.search.length>100))throw new Error('Invalid workspace view')
 if(c.basis!==undefined&&c.basis!=='mission'&&c.basis!=='scene')throw new Error('Invalid mission basis')
 const option=(o:unknown)=>{const x=o as {slug:string;row:number};return !!x&&typeof x.slug==='string'&&/^[a-z0-9-]{1,80}$/.test(x.slug)&&Number.isInteger(x.row)&&x.row>=0&&x.row<=100000}
 const k=c.compare
 if(k!==undefined&&(!k||!['sites','dates'].includes(k.mode)||!option(k.a)||!option(k.b)||(k.mode==='sites'?k.a.row!==k.b.row||k.a.slug===k.b.slug:k.a.slug!==k.b.slug)))throw new Error('Invalid comparison')
 const view=c.view?{view:{screen:c.view.screen,search:c.view.search}}:{},basis=c.basis?{basis:c.basis}:{},compare=k?{compare:{mode:k.mode,a:{slug:k.a.slug,row:k.a.row},b:{slug:k.b.slug,row:k.b.row}}}:{}
 const parsed=parseScenario(JSON.stringify({v:1,constraints:c.constraints,loDay:0,hiDay:0}))
 if(!parsed)throw new Error('Unsupported mission assumptions')
 for(const m of r.messages)if(!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>1800)throw new Error('Keep each message within 1,800 characters')
 if(r.messages.at(-1)?.role!=='user')throw new Error('Finish with a visitor question')
 const pc=parsed.constraints
 const constraints:Constraints={missionDays:pc.missionDays,minLitPct:pc.minLitPct,minLinkPct:pc.minLinkPct,maxDarkH:pc.maxDarkH,maxGapH:pc.maxGapH}
 if(pc.power)constraints.power=Object.fromEntries(['panelAreaM2','efficiencyPct','orientation','tiltDeg','azimuthDeg','loadW','capacityWh','initialPct','reservePct','chargeEfficiencyPct','dischargeEfficiencyPct'].map(k=>[k,pc.power![k as keyof typeof pc.power]])) as Constraints['power']
 if(pc.thermal)constraints.thermal=Object.fromEntries(['thermalMassJK','radiativeCoeffM2','absorptivityAreaM2','internalHeatFraction','heaterMaxW','setpointK','survivalK','sinkK'].map(k=>[k,pc.thermal![k as keyof typeof pc.thermal]])) as Constraints['thermal']
 // Screen readouts and dismissed suggestions are visitor data: bounded here, never instructions.
 const screen=r.screen&&typeof r.screen==='object'&&typeof r.screen.screen==='string'?{screen:r.screen.screen.slice(0,40),items:cleanDigestItems(r.screen.items)}:null
 const dismissed=Array.isArray(r.dismissed)?r.dismissed.filter((d):d is string=>typeof d==='string'&&/^[A-Za-z]{1,24}:.{0,60}$/.test(d)).slice(0,20):[]
 return {context:{...view,...basis,...compare,slug:c.slug,row:c.row,constraints,datasetId:c.datasetId,model:c.model},messages:r.messages.map(m=>({role:m.role,content:m.content.trim()})),screen:screen&&screen.items.length?screen:null,dismissed}
}
/** First code point (the zero) of each decimal-digit script a reply may use: Bengali, Devanagari, Arabic-Indic, Persian, Gurmukhi, Gujarati, Odia, Tamil, Telugu, Kannada, Malayalam, Thai, Myanmar, full-width. */
const DIGIT_ZEROS=[0x09E6,0x0966,0x0660,0x06F0,0x0A66,0x0AE6,0x0B66,0x0BE6,0x0C66,0x0CE6,0x0D66,0x0E50,0x1040,0xFF10]
/** Replies may be in any language, but numbers keep the digits 0-9 used on screen (২০% → 20%); only the digits change. */
export function asciiDigits(text:string){
 return text.replace(/\p{Nd}/gu,d=>{const cp=d.codePointAt(0)!,zero=DIGIT_ZEROS.find(z=>cp>=z&&cp<=z+9);return zero===undefined?d:String(cp-zero)})
}
/**
 * Numeric-origin check. Every number in her prose must come from the calculated evidence, the screen
 * the visitor is reading, or the conversation, allowing display rounding and common unit changes
 * (fraction↔percent, hours↔days, Wh↔kWh). It proves a number's origin, not that it is used for the
 * right quantity: a value copied from another site's row would still pass.
 */
const NUMBER=/(?<![\p{L}\d.])[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?/gu
export function numbersIn(text:string){
 return [...asciiDigits(text).matchAll(NUMBER)].map(m=>{const raw=m[0].replace('−','-').replace(/,/g,''),dot=raw.indexOf('.');return{raw:m[0],value:Number(raw),decimals:dot<0?0:raw.length-dot-1}}).filter(n=>Number.isFinite(n.value))
}
function sourceNumbers(value:unknown,out:number[]){
 if(typeof value==='number'){if(Number.isFinite(value))out.push(value)}
 else if(typeof value==='string'){for(const n of numbersIn(value))out.push(n.value)}
 else if(Array.isArray(value)){out.push(value.length);for(const v of value)sourceNumbers(v,out)}
 else if(value&&typeof value==='object')for(const v of Object.values(value))sourceNumbers(v,out)
 return out
}
export function unverifiedNumbers(text:string,sources:unknown[]):string[]{
 const allowed=sourceNumbers(sources,[])
 const scales=[1,100,0.01,24,1/24,1000,0.001]
 return numbersIn(text).filter(n=>{
  if(Number.isInteger(n.value)&&Math.abs(n.value)<=2)return false
  const tol=0.5*10**-n.decimals+1e-9
  return !allowed.some(v=>scales.some(k=>Math.abs(Math.abs(v*k)-Math.abs(n.value))<=tol))
 }).map(n=>n.raw)
}
/** Model navigation is a suggestion, checked against independently calculated candidates. */
export function checkedCompanionReply(raw:unknown,evidence:CompanionEvidence,sources:unknown[]=[]):CompanionReply{
 const r=raw as CompanionReply
 if(!r||typeof r.message!=='string'||!r.message.trim()||r.message.length>1800||!['sun','earth','skyline','none'].includes(r.focus)||!Array.isArray(r.questions)||r.questions.length>3||r.questions.some(q=>typeof q!=='string'||q.length>120))throw new Error('The AI returned an unsupported reply')
 if(r.visitSlug!==null&&(typeof r.visitSlug!=='string'||!evidence.eligibleSlugs.includes(r.visitSlug)))throw new Error('The proposed destination did not pass the comparison checks')
 const m=r.proposedMission
 const message=asciiDigits(r.message.trim()).replace(/\bcalculated success\b/g,'calculated result')
 if(m!==null&&r.visitSlug!==null)throw new Error('Apply and recalculate a changed mission before proposing travel')
 if(m!==null&&(!m||!Number.isInteger(m.missionDays)||m.missionDays<3||m.missionDays>30||!Number.isFinite(m.loadW)||m.loadW<0||m.loadW>10000||!Number.isFinite(m.panelAreaM2)||m.panelAreaM2<0||m.panelAreaM2>100))throw new Error('Unsupported proposed mission')
 const action=readGuideAction(r.action)
 const knownSite=(a:GuideAction|null)=>!a||!['visit','setSite','compareSites'].includes(a.kind)||(a.kind==='compareSites'&&a.value==='')||evidence.sites.some(s=>s.slug===a.value)||evidence.unavailableSlugs.includes(a.value)
 if(!knownSite(action))throw new Error('Unknown lunar site')
 // Her own ideas pass the same strict allowlist and limits as requested operations. An invalid
 // idea is dropped (never shown) while her explanation is kept.
 let suggestion:GuideSuggestion|null=null
 if(r.suggestion!=null){
  const s=r.suggestion as GuideSuggestion
  let proposed:GuideAction|null=null
  try{proposed=readGuideAction(s.action)}catch{proposed=null}
  if(proposed&&typeof s.reason==='string'&&s.reason.trim()&&s.reason.length<=240&&knownSite(proposed)&&!(action&&action.kind===proposed.kind&&action.value===proposed.value))suggestion={action:proposed,reason:asciiDigits(s.reason.trim())}
 }
 // Numbers must have a calculated origin. An unsupported number in her explanation rejects the reply;
 // in an optional suggestion it only drops that suggestion.
 const origins=[evidence,sources,m,action?.value]
 const unverified=unverifiedNumbers(message,origins)
 if(unverified.length)throw new Error('Unverified number in reply: '+unverified.slice(0,3).join(', '))
 if(suggestion&&unverifiedNumbers(suggestion.reason,[...origins,suggestion.action.value]).length)suggestion=null
 return {action,suggestion,message,visitSlug:r.visitSlug,focus:r.focus,questions:r.questions.map(asciiDigits),proposedMission:m===null?null:{missionDays:m.missionDays,loadW:m.loadW,panelAreaM2:m.panelAreaM2}}
}
/**
 * Does the visitor's message ask the app to do something, rather than to explain? A clear command
 * ("take me to", "use option B in my plan", "compare it with a week later") counts; a question about
 * why or what does not, even if it mentions showing.
 */
export function asksForAction(text:string){
 return text.toLowerCase().split(/[.?!;\n]+/).some(sentence=>{
  const s=sentence.trim()
  // Asking for a way of speaking does not authorise an unrelated UI operation.
  // For example, "What does this mean? Please use plain words." is still an explanation.
  if(/^(?:please[,\s]+)?(?:use|speak|write|reply|respond|answer)(?:\s+(?:in|with))?\s+(?:an?\s+)?(?:plain|simple|simpler|clear|easy|short|brief|english|bangla|bengali|hindi|spanish|arabic|french)\b/.test(s))return false
  if(/^(?:please[,\s]+)?show\s+(?:me\s+)?(?:how|why|what)\b/.test(s))return false
  if(/^(?:please[,\s]+)?(?:tell|teach|help)\s+(?:me\s+)?(?:how|why|what|when|which|where)\b/.test(s))return false
  // A question about why, what or how is a request for an explanation, whatever verbs it contains.
  if(!s||/^(why|what|how|which|when|where|who|does|do|did|is|are|was|were|would|will|should)\b/.test(s)||/\b(why|explain|how come)\b/.test(s))return false
  return /\b(take me|go to|go back|bring me|navigate|open|switch|change|set|use|move|apply|undo|revert|land on|land at|let'?s|compare|show|try|search|find|close|visit|play|pause|jump|photo|picture|flag|tour|walk|highlight|point)\b/.test(s)
 })
}
/** Actions that change nothing on screen except a marker or a display preference. */
export function inPlaceAction(action:GuideAction,screen:string){
 return (action.kind==='highlight'&&(screen==='plan'||screen==='compare'))||action.kind==='explain'||action.kind==='pause'
}
/**
 * Navigation and mission changes happen only when the visitor asked for them. Anything else the
 * model wanted to do becomes a clearly labelled offer they can accept or decline.
 */
export function guardReply(question:string,reply:CompanionReply,screen:string):CompanionReply{
 const a=reply.action
 if(!a||inPlaceAction(a,screen)||asksForAction(question))return reply
 return {...reply,action:null,suggestion:{action:a,reason:'I can do this for you. Nothing changes unless you choose it.'}}
}
export function currentCompanionTurn(turn:CompanionTurn,context:CompanionContext){return contextKey(turn.evidence.context)===contextKey(context)}
/** Same site, time and mission: the reply's numbers still apply even if a different dashboard is open. */
export function sameCompanionScene(turn:CompanionTurn,context:CompanionContext){const {view:_a,...was}=turn.evidence.context,{view:_b,...now}=context;return contextKey(was)===contextKey(now)}
