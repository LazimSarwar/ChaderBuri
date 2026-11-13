import type { Ephemeris,Horizon,Site } from '../data.ts'
import type { PredictionIndex } from '../lib/predictionIndex.ts'
import { TIMING_LIMITATION } from '../lib/attribution.ts'
import { exportSnapshot } from '../lib/exportSnapshot.ts'
import { cloneConstraints,type Scn } from './comparison.ts'
import { evaluateWindow,type SiteSeries } from './solver.ts'
import { generationFor,simulatePower } from './power.ts'
import { simulateThermal } from './thermal.ts'
import { assessRobustness,type RobustnessProducts } from './robustness.ts'
import { landingContext,comparisonExplanation } from './comparisonContext.ts'

export function buildMissionBrief(index:PredictionIndex,scenarios:Scn[],series:Map<string,SiteSeries>,sites:Site[],eph:Record<string,Record<'sun'|'earth',Ephemeris>>,horizons:Record<string,Horizon>,products:Record<string,RobustnessProducts>,generatedUTC=new Date().toISOString(),kind:'mission'|'comparison'='mission'){
 const start=Date.parse(index.coverage.start)
 const assessed=scenarios.map((s,i)=>{
  const data=series.get(s.slug),c=cloneConstraints(s.c),end=s.row+c.missionDays*24,site=sites.find(site=>site.slug===s.slug)
  const pair=eph[s.slug],horizon=horizons[s.slug]
  const common={label:kind==='comparison'?`${String.fromCharCode(65+i)} · ${i===0?'Baseline':'Alternative'}`:i===0?'Selected mission':'+7-day landing slip',site:site?.name??s.slug,slug:s.slug,landingUTC:new Date(start+s.row*3600000).toISOString(),endUTC:new Date(start+end*3600000).toISOString(),constraints:c,atLanding:pair&&horizon?landingContext(s,pair.sun,pair.earth,horizon,start):null}
  if(!data||s.row<0||end>data.hours)return {...common,result:null,battery:null,robustness:null}
  const thermal=c.thermal&&c.power?simulateThermal(data.solar,s.row,end,c.thermal,c.power.loadW,true):null
  const battery=c.power?simulatePower(generationFor(data.solar,c.power),s.row,end,c.power,true,thermal?.heaterW):null
  const robustness=products[s.slug]&&pair&&horizon?assessRobustness(products[s.slug],pair.sun,pair.earth,horizon,s.row,c):null
  return {...common,result:evaluateWindow(data,s.row,end,c),battery,robustness}
 })
 return {kind,generatedUTC,reproducibility:exportSnapshot(index,scenarios.map(s=>s.slug)),timingLimitations:TIMING_LIMITATION,scenarios:assessed,differences:scenarios.slice(1).map((s,i)=>({label:assessed[i+1].label,...comparisonExplanation(scenarios[0],s,series.get(scenarios[0].slug),series.get(s.slug),assessed[0].result,assessed[i+1].result)}))}
}
export type MissionBrief=ReturnType<typeof buildMissionBrief>
