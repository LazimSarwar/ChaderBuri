import assert from 'node:assert/strict'
import { analyseRoute, localSky, routeDefaults, validSettings, type RouteEnvironment, type RoutePoint } from '../src/explore/routeAnalysis.ts'
import { missionSnapshot, resolveSurfaceMission } from '../src/explore/missionSession.ts'
import { freshExcursion, decodeExcursion } from '../src/explore/excursionState.ts'
import { missionDecisionDigest } from '../src/explore/missionDecisionDigest.ts'
import { readFileSync } from 'node:fs'
import { xrTerrain } from '../src/explore/xrTerrain.ts'
let checks=0
const check=(v:unknown,m:string)=>{assert.ok(v,m);checks++}
const close=(a:number,b:number)=>check(Math.abs(a-b)<1e-7,`${a} = ${b}`)
const json=(p:string)=>JSON.parse(readFileSync(new URL('../public/data/'+p,import.meta.url),'utf8'))
const sun=json('ephemeris/malapert-massif.sun.json'),earth=json('ephemeris/malapert-massif.earth.json'),horizon=json('horizons/malapert-massif.json')
const row=(Date.parse('2026-10-17T00:00Z')-Date.parse(sun.start))/3600000
const environment:RouteEnvironment={sampler:()=>0,resolutionM:5,eyeHeightM:1.7,row,sunRows:sun.rows,earthRows:earth.rows,horizon,maxRow:sun.rows.length-1}
const origin:RoutePoint={id:'start',label:'Start',eastM:0,northM:0,taskMin:0},station:RoutePoint={id:'one',label:'Station',eastM:30,northM:40,taskMin:5}
const s={...routeDefaults(),paceMps:1,timeBudgetMin:60,batteryWh:100,travelW:120,taskW:60,oxygenL:100,oxygenLpm:1}
const flat=analyseRoute(origin,[station],s,environment)
close(flat.distanceM,100);close(flat.travelMin,100/60);close(flat.totalMin,5+100/60)
close(flat.legs[0].arrivalRow,row+50/3600);close(flat.legs[0].departureRow,row+50/3600+5/60)
close(flat.legs[1].arrivalRow,row+100/3600+5/60)
check(flat.assessedLimitsMet&&flat.coverage==='complete','Flat closed route meets only the explicitly assessed limits')
check(flat.unassessed.some(x=>x.includes('rescue')),'A model pass never removes unassessed operational capability')
close(flat.resources[0].used,100/60/60*120+5/60*60)
close(flat.resources[1].used,flat.totalMin)
const missing=analyseRoute(origin,[station],s,{...environment,sampler:()=>null})
check(missing.coverage==='incomplete'&&!missing.assessedLimitsMet,'Missing heights cannot become a passing terrain assessment')
check(missing.legs[0].sun.status==='unknown','Missing local terrain is never clear')
const slope=analyseRoute(origin,[{...station,eastM:50,northM:0}],s,{...environment,sampler:e=>e})
close(slope.legs[0].maxSlopeDeg!,45)
check(!slope.assessedLimitsMet&&slope.legs[0].exceedsSlope,'Resolved 45-degree ascent exceeds the selected 10-degree limit')
close(slope.legs[0].distanceM,Math.hypot(50,50))
const budget=analyseRoute(origin,[station],{...s,timeBudgetMin:5,batteryWh:1,oxygenL:1},environment)
check(budget.reasons.length===3,'Time, battery and oxygen deficits are all surfaced')
const far=analyseRoute(origin,[{...station,taskMin:120}],s,{...environment,row:environment.maxRow-.01})
check(far.reasons.some(x=>x.includes('coverage')),'A route may not extrapolate outside the sky cache')
check(localSky({...environment,row:-1},origin,-1,'sun').status==='unknown','Before-coverage local estimates are unknown')
const syntheticSun=environment.sunRows.map(r=>({...r,az:90,el:1}))
const blocked=localSky({...environment,sunRows:syntheticSun,sampler:e=>e>10?50:0},origin,row,'sun')
check(blocked.status==='blocked nearby'&&blocked.clearanceDeg!<0,'Known nearby ridge blocks a low Sun in the analytic test')
const flatSun=localSky({...environment,sunRows:syntheticSun},origin,row,'sun')
const grazingSun=syntheticSun.map(r=>({...r,el:1-flatSun.clearanceDeg!}))
check(localSky({...environment,sunRows:grazingSun},origin,row,'sun').status==='grazing nearby','A partially visible solar disc is not called fully clear or fully blocked')
const emptyDirection=localSky(environment,{eastM:249,northM:0},row,'sun')
check(emptyDirection.samples===0||emptyDirection.sampledToM<=250,'Local rays remain inside the declared surface area')
for(const value of [0,-1,NaN,Infinity])check(!validSettings({...s,paceMps:value}),'Invalid pace cannot become a travel time')
for(const point of [{...station,eastM:251,northM:0},{...station,taskMin:-1},{...station,eastM:NaN}]){assert.throws(()=>analyseRoute(origin,[point],s,environment));checks++}
const same=analyseRoute(origin,[{...origin,id:'same',taskMin:5}],s,environment)
check(same.legs.length===2,'Zero-distance station retains the task and return indices')
close(same.legs[1].arrivalRow,row+5/60)
const c={missionDays:14,minLitPct:60,maxDarkH:72,minLinkPct:60,maxGapH:72,power:{panelAreaM2:7,efficiencyPct:28,orientation:'tracking' as const,tiltDeg:0,azimuthDeg:0,loadW:300,capacityWh:5000,initialPct:90,reservePct:25,chargeEfficiencyPct:95,dischargeEfficiencyPct:95}}
const snapshot=missionSnapshot('malapert-massif',row,c,'Custom mission')
c.power.loadW=999
check(snapshot.constraints.power?.loadW===300,'Mission snapshots detach nested equipment from dashboard edits')
const alternate=missionSnapshot('shackleton-floor',row,snapshot.constraints,'Alternative')
check(resolveSurfaceMission('shackleton-floor',row,alternate,c).constraints.power?.panelAreaM2===7,'Site travel retains custom equipment')
check(resolveSurfaceMission('other',row,alternate,c).constraints===c,'Other independent scene visits use their explicit fallback')
const plan=freshExcursion('malapert-massif','dataset',row);plan.points=[station];plan.phase='outbound'
const restored=decodeExcursion(JSON.stringify(plan),'malapert-massif','dataset',row)
check(restored.phase==='draft'&&restored.points.length===1,'Restoring a route never restarts movement')
check(decodeExcursion(JSON.stringify(plan),'malapert-massif','changed',row).points.length===0,'Changed dataset cannot reuse a saved assessment')
check(decodeExcursion('{broken','malapert-massif','dataset',row).points.length===0,'Corrupt saved plans recover')
const digest=missionDecisionDigest({site:'Malapert',sceneUTC:'2026-10-17 00:00',arrivalUTC:'2026-10-24 00:00',basis:'Custom mission',constraints:snapshot.constraints})
check(digest.find(d=>d.id==='proposal-time')?.value==='2026-10-24 00:00','Assistant reads the proposed date, separate from the scene')
check(digest.find(d=>d.id==='proposal-equipment')?.value.includes('300 W'),'Assistant receives the same equipment snapshot')
const xr=xrTerrain((e,n)=>100+e*.1+n*.2,{eastM:0,northM:0},20,40)!
check(xr.positions[0]===-40&&xr.positions[2]===-40,'Headset geometry uses metres in the local east/north frame')
close(xr.positions[1],4)
check(xr.stepM===20&&xr.known===25,'Headset patch retains source sample spacing')
check(xr.indices.length===96,'Known four-by-four cells produce two triangles each')
check(xrTerrain(()=>null,{eastM:0,northM:0},20)===null,'Missing terrain cannot become a flat VR surface')
const holes=xrTerrain((e,n)=>e>0&&n>0?null:0,{eastM:0,northM:0},20,40)!
check(holes.indices.length<xr.indices.length,'Unknown terrain creates holes instead of invented terrain')
console.log(`Excursion math, resources, continuity and proposal context: ${checks} checks passed`)
