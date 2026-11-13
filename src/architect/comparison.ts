import { parseScenario } from './scenario.ts'
import { evaluateWindow, type Constraints, type SiteSeries } from './solver.ts'
import { powerTradeoffs } from './tradeoffs.ts'
import { exportSnapshot } from '../lib/exportSnapshot.ts'
import type { PredictionIndex } from '../lib/predictionIndex.ts'
import type { Ephemeris,Horizon } from '../data.ts'
import { landingContext,comparisonExplanation } from './comparisonContext.ts'
import { assessRobustness,type RobustnessProducts } from './robustness.ts'
export type Scn = { id: number; slug: string; row: number; c: Constraints }
export const cloneConstraints = (c: Constraints): Constraints => ({...c, power: c.power ? {...c.power} : undefined, thermal: c.thermal ? {...c.thermal} : undefined})
export const encodeScenarios = (scns: Scn[]): string => JSON.stringify(scns.map(({slug,row,c}) => ({slug,row,c})))
export function comparisonReport(index:PredictionIndex,scenarios:Scn[],bySlug:Map<string,SiteSeries>,generatedUTC=new Date().toISOString(),geometry?:{eph:Record<string,Record<'sun'|'earth',Ephemeris>>;horizons:Record<string,Horizon>;products?:Record<string,RobustnessProducts>}) {
  const start=Date.parse(index.coverage.start)
  const results=scenarios.map(s=>{const series=bySlug.get(s.slug),end=s.row+s.c.missionDays*24;return series&&s.row>=0&&end<=series.hours?evaluateWindow(series,s.row,end,s.c):null})
  return {schemaVersion:2,generatedUTC,reproducibility:exportSnapshot(index,scenarios.map(s=>s.slug)),scenarios:scenarios.map((s,i)=>{
    const end=s.row+s.c.missionDays*24
    const pair=geometry?.eph[s.slug],horizon=geometry?.horizons[s.slug]
    const products=geometry?.products?.[s.slug]
    return {site:s.slug,startRow:s.row,landingUTC:new Date(start+s.row*3600000).toISOString(),endUTC:new Date(start+end*3600000).toISOString(),constraints:cloneConstraints(s.c),result:results[i],atLanding:pair&&horizon?landingContext(s,pair.sun,pair.earth,horizon,start):null,robustness:results[i]&&pair&&horizon&&products?assessRobustness(products,pair.sun,pair.earth,horizon,s.row,s.c):null}
  }),differences:scenarios.slice(1).map((s,i)=>comparisonExplanation(scenarios[0],s,bySlug.get(scenarios[0].slug),bySlug.get(s.slug),results[0],results[i+1])),scope:{nominal:'Visibility, enabled battery and enabled thermal requirements',rf:'Diagnostic only; excluded from ranking',footprint:'Separate 19-point visibility/battery sensitivity; excludes thermal and RF; counts are not probabilities',height:'Separate 0/1/3/5 m sensitivity with enabled nominal requirements; does not change the ground-level nominal verdict'},method:'Hourly left-endpoint integration. Candidate-date searches use six-hour steps, bounded to 90 days and cached coverage. Landing crossings are estimates from cached directions. Energy attribution averages all replacement orders for Sun distance, incidence and combined terrain/eclipse exposure with identical electrical hardware and mission duration; it does not attribute minimum battery or establish real-world causation.'}
}
export function decodeScenarios(text: string | null, has: (slug: string) => boolean): Scn[] | null {
  if (!text || text.length > 8192) return null
  try {
    const raw = JSON.parse(text) as Scn[]
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) return null
    return raw.map((r, id) => {
      if (!r || !has(r.slug)) throw new Error('Unknown site')
      const parsed = parseScenario(JSON.stringify({v:1,constraints:r.c,loDay:0,hiDay:0,selection:{slug:r.slug,row:r.row}}))
      if (!parsed) throw new Error('Unsupported scenario')
      return {id,slug:r.slug,row:r.row,c:cloneConstraints(parsed.constraints)}
    })
  } catch { return null }
}
export function shiftedRow(s: Scn, days: number, coverageHours: number): number | null {
  const row = s.row + days * 24
  return Number.isInteger(row) && row >= 0 && row + s.c.missionDays * 24 <= coverageHours ? row : null
}
/** Bounded six-hour search, with unchanged mission assumptions. */
export function nextPassingLanding(series: SiteSeries, s: Scn): number | null {
  const end = Math.min(series.hours - s.c.missionDays * 24, s.row + 90 * 24)
  for (let row = s.row + 6; row <= end; row += 6) if (evaluateWindow(series,row,row+s.c.missionDays*24,s.c).pass) return row
  return null
}
/** Keep only repairs rechecked against all enabled nominal requirements. */
export function verifiedRepairs(series: SiteSeries, s: Scn) {
  if (!s.c.power) return []
  return powerTradeoffs(series.solar,s.row,s.row+s.c.missionDays*24,s.c.power,s.c.thermal).flatMap(repair => {
    if (repair.value === null) return []
    const c = cloneConstraints(s.c)
    c.power = {...c.power!,[repair.key]:repair.value}
    const result = evaluateWindow(series,s.row,s.row+s.c.missionDays*24,c)
    return result.pass ? [{...repair,c,result}] : []
  })
}
