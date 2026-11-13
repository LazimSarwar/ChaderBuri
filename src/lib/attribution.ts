// Gap attribution and estimated event timing for the mission window.
// Uses the same 360-entry terrain horizon the solver screens with.
import { horizonAt, type EphRow, type Horizon } from '../data.ts'
import { parseRowT } from './sim.ts'
import { sampleSky, horizonElevation, type SkySample } from './science.ts'

export type GapAttribution = {
  /** hour-row of the worst blocked hour (window-relative indexing preserved) */
  i: number
  bodyAz: number
  bodyEl: number
  /** terrain mask elevation at the body azimuth (deg) */
  maskDeg: number
  /** how far below the mask the body centre sits (deg, >0 when blocked) */
  deficitDeg: number
}

/** Worst blocked hour within [from,to): the body centre deepest below the
 *  terrain mask, with the blocking ridge's bearing and height. Names the
 *  obstacle instead of just reporting "blocked". */
export function worstBlock(
  az: ArrayLike<number>,
  el: ArrayLike<number>,
  horizon: Horizon,
  from: number,
  to: number,
): GapAttribution | null {
  let worst: GapAttribution | null = null
  for (let i = Math.max(0, Math.floor(from)); i < Math.min(az.length, Math.ceil(to)); i++) {
    const a = ((Math.round(az[i]) % 360) + 360) % 360
    const mask = horizon.profile[a]
    const deficit = mask - el[i]
    if (deficit > 0 && (!worst || deficit > worst.deficitDeg)) {
      worst = {
        i,
        bodyAz: Math.round(az[i] * 10) / 10,
        bodyEl: Math.round(el[i] * 10) / 10,
        maskDeg: Math.round(mask * 10) / 10,
        deficitDeg: Math.round(deficit * 100) / 100,
      }
    }
  }
  return worst
}

/** Longest run overlapping [s,e), as [start,end) hour rows; null when empty. */
export function longestRunOverlapping(
  runs: [number, number][],
  s: number,
  e: number,
): [number, number] | null {
  let best: [number, number] | null = null
  for (const [a, b] of runs) {
    const lo = Math.max(a, s)
    const hi = Math.min(b, e)
    if (hi <= lo) continue
    if (!best || hi - lo > best[1] - best[0]) best = [lo, hi]
  }
  return best
}

export const TIMING_LIMITATION = 'Mission energy and darkness durations use hourly left-endpoint samples. Displayed event times refine interpolated directions against a 1° azimuth terrain mask. Short events can be missed; no numerical timing uncertainty bound has been established.'

export type NextCrossing = {
  /** hours from epoch until the crossing (>= 0, sub-hour interpolation) */
  hours: number
  /** timestamp of the crossing, "DD Mon YYYY HH:MM" (UT) */
  atUTC: string
}

/** Locate the first requested state on an interpolated direction, including skyline-bin steps.
 * Subdivision brackets the event; bisection always evaluates the same horizon lookup as the HUD.
 * This refines the display model, not the temporal resolution of the source observations.
 */
export function directionCrossingFraction(a:SkySample,b:SkySample,profile:number[],rising:boolean,start=0):number|null {
  const wanted=(f:number)=>{const sky=sampleSky([a,b],f);const up=sky.el>horizonElevation(profile,sky.az);return up===rising}
  if(wanted(start))return start
  let previous=start
  for(let j=1;j<=6;j++){
    const next=start+(1-start)*j/6
    if(wanted(next)){
      let lo=previous,hi=next
      for(let k=0;k<36;k++){const mid=(lo+hi)/2;if(wanted(mid))hi=mid;else lo=mid}
      return hi
    }previous=next
  }
  return null
}

/** Next horizon state. Cached hourly directions are interpolated against the discrete
 * horizon; endpoint clearances are never interpolated across a skyline step.
 * Sub-hour estimates cannot establish unobserved short-duration events.
 */
export function nextHorizonCrossing(rows:EphRow[],epoch:Date,horizon:Horizon,rising:boolean):NextCrossing|null {
  if(rows.length<2)return null
  const first=parseRowT(rows[0].t).getTime(),last=parseRowT(rows[rows.length-1].t).getTime(),now=epoch.getTime()
  if(now<first||now>last)return null
  const current=(now-first)/3600000
  const stamp=(row:number)=>{
    const date=new Date(Math.round(first+row*3600000)),pad=(n:number)=>String(n).padStart(2,'0'),months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
    return {hours:Math.max(0,row-current),atUTC:`${pad(date.getUTCDate())} ${months[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`}
  }
  const sky=sampleSky(rows,current)
  if((sky.el>horizonAt(horizon,sky.az))===rising)return stamp(current)
  for(let i=Math.floor(current)+1;i<rows.length;i++){
    if((rows[i].el>horizonAt(horizon,rows[i].az))!==rising)continue
    const fraction=directionCrossingFraction(rows[i-1],rows[i],horizon.profile,rising,Math.max(0,current-(i-1)))
    if(fraction!==null)return stamp(i-1+fraction)
  }
  return null
}
