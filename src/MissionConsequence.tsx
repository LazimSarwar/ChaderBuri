import { useMemo } from 'react'
import { buildSeries } from './architect/solver'
import type { Scn } from './architect/comparison'
import type { Ephemeris,Horizon } from './data'
import { missionConsequence,missionTrace } from './lib/missionConsequence'

export function MissionConsequence({scenario,row,sun,earth,horizon}:{scenario:Scn;row:number;sun:Ephemeris;earth:Ephemeris;horizon:Horizon}){
 const trace=useMemo(()=>missionTrace(buildSeries(scenario.slug,sun.rows,earth.rows,horizon),scenario),[scenario,sun,earth,horizon])
 const r=trace?missionConsequence(trace,row):null
 return <aside className="mission-consequence" aria-label="Mission consequence at the landing target"><strong>Mission consequence · target</strong>{r?<><p>Hour {r.hour.toFixed(1)} · Sun {r.sunVisible?'visible':'masked'} · Earth {r.earthVisible?'visible':'masked'}</p>{r.batteryPct!==null&&<p><b>{r.batteryPct.toFixed(1)}% battery</b>{r.belowReserve?' · below reserve':''}<br/>{r.generationW!.toFixed(0)} W solar / {r.demandW!.toFixed(0)} W demand<br/>{r.flow}</p>}<small>Hourly model; charge interpolated for display. The scene lamp adds no solar power. Earth visibility is geometry, not RF service.</small></>:<p>Scene outside this mission window. Battery is not extrapolated.</p>}</aside>
}
