import type { Site } from '../data.ts'
import { DEFAULT_POWER } from './power.ts'
import { cloneConstraints,type Scn } from './comparison.ts'
/** Defaults are editable illustrations; explicitly disclose any coverage adjustment. */
export function quickComparison(sites:Site[],slug:string,row:number,hours:number):{scns:Scn[];note:string}|null{
 if(sites.length<2||!Number.isFinite(row)||!Number.isInteger(hours)||hours<336)return null
 const a=sites.find(s=>s.slug===slug)??sites[0],b=sites.find(s=>s.slug==='malapert-massif'&&s.slug!==a.slug)??sites.find(s=>s.slug!==a.slug)!
 const chosen=Math.max(0,Math.min(Math.floor(row),hours-336))
 const c={missionDays:14,minLitPct:60,minLinkPct:60,maxDarkH:72,maxGapH:72,power:{...DEFAULT_POWER}}
 return {scns:[{id:0,slug:a.slug,row:chosen,c:cloneConstraints(c)},{id:1,slug:b.slug,row:chosen,c:cloneConstraints(c)}],note:chosen!==Math.floor(row)?'The scene date cannot fit a complete 14-day mission; the landing was moved to the nearest supported start.':''}
}
