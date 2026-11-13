import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PerspectiveCamera, Vector3 } from 'three'
import { arrivalRadius, explorationHotspots, MOON_RADIUS_M, nextVisitSunset, projectVisit, projectedSunSegments, siteSeparation, visitSunPath } from '../src/lib/visit.ts'
import { nextHorizonCrossing } from '../src/lib/attribution.ts'
import { horizonElevation } from '../src/lib/science.ts'
import type { Site, Horizon, EphRow } from '../src/data.ts'
let checks=0
function check(ok:unknown,message:string){assert.ok(ok,message);checks++}
function close(a:number,b:number,tolerance=1e-9){check(Math.abs(a-b)<tolerance,`${a} approximately ${b}`)}
const r=Math.PI/180
for(const heading of [0,55,179,359])for(const pitch of [-80,0,45,80])for(const fov of [12,60,80])for(const aspect of [390/844,16/9]){
  const camera=new PerspectiveCamera(fov,aspect,.01,100)
  camera.up.set(0,1,0)
  camera.lookAt(new Vector3(Math.sin(heading*r)*Math.cos(pitch*r),Math.sin(pitch*r),-Math.cos(heading*r)*Math.cos(pitch*r)))
  camera.updateMatrixWorld()
  for(const [az,el] of [[heading,pitch],[heading+3,pitch+2],[heading-4,pitch-2]]){
    const out=projectVisit(az,el,{heading,pitch,fov},aspect)!
    const v=new Vector3(Math.sin(az*r)*Math.cos(el*r),Math.sin(el*r),-Math.cos(az*r)*Math.cos(el*r)).project(camera)
    close(out.x,(v.x+1)/2);close(out.y,(1-v.y)/2)
  }
}
check(projectVisit(180,0,{heading:0,pitch:0,fov:60},1)===null,'Behind-camera points are hidden')
const equator={lat:0,lonEast:0}
close(siteSeparation(equator,equator).distanceM,0)
close(siteSeparation(equator,{lat:0,lonEast:90}).distanceM,Math.PI*MOON_RADIUS_M/2,1e-6)
close(siteSeparation(equator,{lat:0,lonEast:90}).bearing,90)
close(siteSeparation({lat:89,lonEast:179},{lat:89,lonEast:-179}).distanceM,siteSeparation({lat:89,lonEast:-179},{lat:89,lonEast:179}).distanceM,1e-6)
for(const from of [1.001,4.6,9.2]){
  const to=1+1500/MOON_RADIUS_M
  close(arrivalRadius(from,to,0),from);close(arrivalRadius(from,to,1),to)
  let previous=from
  for(let i=1;i<=100;i++){const radius=arrivalRadius(from,to,i/100);check(radius<=previous+1e-12&&radius>=to,'Arrival descends monotonically above the final ground clearance');previous=radius}
}
const sites:Site[]=JSON.parse(readFileSync('public/data/sites.json','utf8'))
for(const site of sites){
  const h:Horizon=JSON.parse(readFileSync(`public/data/horizons/${site.slug}.json`,'utf8'))
  const spots=explorationHotspots(h,{az:359.7,el:3},{az:0.2,el:-1})
  close(spots[0].el,Math.max(...h.profile));close(spots[1].el,horizonElevation(h.profile,359.7))
  check(spots.every(s=>s.source.startsWith('https://pds-geosciences.wustl.edu/')&&Number.isFinite(s.az)&&Number.isFinite(s.el)),'Every hotspot uses measured data and a source')
}
const rows:EphRow[]=Array.from({length:100},(_,i)=>({t:`2026-Jan-${String(1+Math.floor(i/24)).padStart(2,'0')} ${String(i%24).padStart(2,'0')}:00`,az:i,el:10-i*.2}))
const h={profile:Array(360).fill(0)} as Horizon
const path=visitSunPath(rows,30.5,h)
check(path.length===70&&path[0].row===30&&path.at(-1)!.row===99,'Sun path is bounded by the real cache')
check(visitSunPath(rows,0,h).length===73,'Sun path budget is at most 73 points')
check(visitSunPath(rows,99,h).length===1,'End of cache has no invented future positions')
const segments=projectedSunSegments(path,{heading:60,pitch:0,fov:80},16/9)
check(segments.some(s=>s.visible)&&segments.some(s=>!s.visible),'Projected path retains distinct visible and masked segments')
check(segments.every(s=>s.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))),'Projected path remains finite')
const crossing=nextHorizonCrossing(rows,new Date(Date.UTC(2026,0,1)),h,false)!
close(crossing.hours,50)
check(nextVisitSunset(rows,new Date(Date.UTC(2026,0,4)),h)===null,'Already masked Sun never offers an event in the past when no later sunrise exists')
const periodic:EphRow[]=rows.map((row,i)=>({...row,el:Math.sin((i-5)*Math.PI/10)}))
const future=nextVisitSunset(periodic,new Date(Date.UTC(2026,0,1)),h)!
check(future.hours>10&&future.hours<20,'From darkness, next sunset follows the next sunrise')
const later=nextVisitSunset(periodic,new Date(Date.UTC(2026,0,1,16)),h)!
check(later.hours>10,'After a sunset, the next action advances to a later cycle')
console.log(`Lunar visit geometry and arrival checks passed: ${checks}`)
