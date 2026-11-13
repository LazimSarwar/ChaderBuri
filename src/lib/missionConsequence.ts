import { evaluateWindow,type SiteSeries } from '../architect/solver.ts'
import type { Scn } from '../architect/comparison.ts'
import { generationFor,simulatePower } from '../architect/power.ts'
import { simulateThermal } from '../architect/thermal.ts'

export function missionTrace(series:SiteSeries,scenario:Scn){
 const start=scenario.row,end=start+scenario.c.missionDays*24,c=scenario.c
 if(series.slug!==scenario.slug||!Number.isInteger(start)||start<0||end>series.hours)return null
 const result=evaluateWindow(series,start,end,c)
 const thermal=c.power&&c.thermal?simulateThermal(series.solar,start,end,c.thermal,c.power.loadW):null
 const battery=c.power?simulatePower(generationFor(series.solar,c.power),start,end,c.power,true,thermal?.heaterW):null
 return {series,scenario,result,battery,heater:thermal?.heaterW??null}
}
export function missionConsequence(trace:NonNullable<ReturnType<typeof missionTrace>>,row:number){
 const {scenario,series,battery}=trace,start=scenario.row,hours=scenario.c.missionDays*24
 if(!Number.isFinite(row)||row<start||row>start+hours)return null
 const hour=row-start,i=Math.min(hours-1,Math.floor(hour)),fraction=hour-i,a=battery?.points[i],b=battery?.points[i+1]
 const batteryPct=a&&b?a.socPct+(b.socPct-a.socPct)*fraction:null,generationW=b?.generationW??null,demandW=scenario.c.power?scenario.c.power.loadW+(trace.heater?.[i]??0):null
 const flow=generationW===null||demandW===null?'not assessed':generationW>demandW?'solar surplus':generationW<demandW?(batteryPct!==null&&batteryPct<=1e-8?'unmet demand':'battery supplying deficit'):'balanced'
 return {hour,batteryPct,generationW,demandW,flow,belowReserve:batteryPct!==null&&batteryPct<scenario.c.power!.reservePct,sunVisible:series.litPrefix[start+i+1]>series.litPrefix[start+i],earthVisible:series.linkPrefix[start+i+1]>series.linkPrefix[start+i]}
}
