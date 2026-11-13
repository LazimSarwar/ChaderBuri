import assert from 'node:assert/strict'
import { buildSeries, evaluateWindow, type Constraints } from '../src/architect/solver.ts'
import { rankSites, calendarDays, nowRow } from '../src/explore/siteRanking.ts'
import { missionEvents, missionComms, countdown } from '../src/explore/missionEvents.ts'
import { landingZones } from '../src/explore/landingZone.ts'
import { accuracyText, type AccuracyScope } from '../src/explore/accuracyText.ts'
import { SurfaceResolutionController } from '../src/space/renderQuality.ts'
import { newObjective, objectiveLine } from '../src/explore/fieldObjective.ts'
import { consoleGlanceStore, glanceForVisit, newGlanceVisitKey } from '../src/explore/consoleGlanceStore.ts'
import type { EphRow, Horizon } from '../src/data.ts'
import { nextPassingArrival, arrivalSearchText } from '../src/lib/arrivalSearch.ts'
import { jointVisibility } from '../src/lib/jointVisibility.ts'
let checks=0
function check(value:unknown,message:string){assert.ok(value,message);checks++}
const c:Constraints={missionDays:1,minLitPct:20,maxDarkH:24,minLinkPct:20,maxGapH:24}
const sky=(el:number,t:number)=>({t,az:0,el,range:149597870.7}) as unknown as EphRow
const horizon={profile:Array(360).fill(0)} as Horizon
const sun=Array.from({length:121},(_,i)=>sky(i%24<12?10:-10,i)),earth=Array.from({length:121},(_,i)=>sky(i%24<18?15:-15,i))
const a=buildSeries('a',sun,earth,horizon),b=buildSeries('b',sun.map((r,i)=>({...r,el:i%24<6?10:-10})),earth,horizon)
const ranking=rankSites([a,b],0,c)
for(const item of ranking){assert.deepEqual(item.result,evaluateWindow(item.slug==='a'?a:b,0,24,c));checks++}
check(rankSites([a,{...a,slug:'same'}],0,c)[0].slug==='a','stable order on exact ties')
check(rankSites([a],-1,c).length===0,'out-of-coverage rank omitted')
check(rankSites([a],.5,c).length===0,'fractional arrival rejected')
const days=calendarDays(a,c,0,4)
for(const day of days){const candidates=[0,6,12,18].map(h=>day.day*24+h).filter(r=>r+24<=a.hours);const passing=candidates.map(row=>({row,result:evaluateWindow(a,row,row+24,c)})).filter(x=>x.result.pass).sort((x,y)=>y.result.margin-x.result.margin||x.row-y.row);check(day.row===(passing[0]?.row??null),'calendar chooses best actually evaluated start')}
check(calendarDays(a,{...c,minLitPct:100},0,0)[0].row===null,'failed date is not offered')
const events=missionEvents(a,0,c).events
check(events.some(e=>e.label==='Sunset'&&e.row===12),'sunset follows dark run boundary')
check(events.some(e=>e.label==='Earthset'&&e.row===18),'earthset follows gap run boundary')
check(!events.some(e=>e.label==='Sunrise'&&e.row===0),'unknown pre-coverage boundary is not a sunrise')
check(events.at(-1)?.row===24,'mission endpoint retained')
check(missionEvents(a,24,c).events.every(e=>e.row>=24&&e.row<=48),'events clipped to selected mission')
check(countdown(27,0)==='in 1 d 3 h 0 min','countdown arithmetic')
check(countdown(0,1)==='ago 1 h 0 min','past event marked')
const start=Date.UTC(2026,8,1)
check(nowRow(start,start,121)===0,'now coverage start')
check(nowRow(start+120*3600000,start,121)===120,'now coverage end')
check(nowRow(start-1,start,121)===null,'now does not clamp before coverage')
check(nowRow(start+120*3600000+1,start,121)===null,'now does not extrapolate')
check(nowRow(start+1800000,start,121)===.5,'now retains fractional time')
for(const z of landingZones(()=>500,20)){check(z.maxSlopeDeg===0,'flat plane zero slope');check(z.reliefM===0,'flat plane zero relief');check(z.coverage===1,'flat plane complete coverage')}
for(const z of landingZones((e,n)=>500+.1*e+.2*n,5))check(Math.abs(z.maxSlopeDeg!-Math.atan(Math.hypot(.1,.2))*180/Math.PI)<1e-8,'tilted plane resolved slope')
check(landingZones(()=>null,20).every(z=>z.maxSlopeDeg===null&&z.coverage===0&&z.reliefM===null),'missing terrain never flat')
check(landingZones(()=>500,20)[0].interpolated,'10m zone on 20m DEM marked coarse')
const note='Reference ROI4 1 m comparison: +1.46 percentage points; not a general uncertainty.'
for(const scope of ['illumination','earth','power','thermal','ground','ranking','comms','time'] as AccuracyScope[]){const text=JSON.stringify(accuracyText(scope,20,0,note));check(text.includes('1.46')===(scope==='illumination'),'reference residual only on illumination')}
const geo={startMs:start,stepMs:3600000,stations:[{name:'Test',elev:new Float32Array(121).fill(30)}]}
const comms=missionComms(a,0,24,start,geo)
check(comms.opportunityPct===75,'DSN opportunity requires Earth visibility')
check(comms.longestGapH===6,'DSN opportunity gap uses full interval')
check(comms.stations[0].pct===75,'station coverage uses simultaneous local visibility')
check(missionComms(a,0,24,start,null).opportunityPct===null,'missing DSN not zero coverage')
check(missionComms(a,0,24,start,{...geo,stations:[{name:'Test',elev:new Float32Array(2).fill(30)}]}).opportunityPct===null,'partial DSN coverage not presented as complete')
const pixel=new SurfaceResolutionController(1,.75)
for(let i=0;i<180;i++)pixel.sample(40,3000+i*40)
check(pixel.dpr>=.75,'desktop resolution floor')
let now=15000;for(let i=0;i<1200;i++){now+=16;pixel.sample(16,now)}
check(pixel.dpr>.75,'resolution can recover after sustained inexpensive frames')
const before=pixel.dpr;pixel.sample(900,now+900);check(pixel.dpr===before,'long stall does not lower pixel density')
const earthLine=objectiveLine(newObjective(),{heading:0,earth:{az:358,el:-1.5},skylineEl:-1.7,visitor:{eastM:0,northM:0},antenna:{deployed:false,pointingErrorDeg:0,earthVisible:true}},'Test',null)!
check(earthLine.text.includes('0.2° above the measured skyline'),'visible Earth below level horizontal uses positive skyline clearance')
check(!earthLine.text.includes('-1.5° above'),'guidance never calls negative elevation above the horizontal')
const visitA=newGlanceVisitKey(),visitB=newGlanceVisitKey(),glance=consoleGlanceStore.getSnapshot()
check(visitA!==visitB,'each surface visit has an independent headset scope')
const oldGlance={...glance,visitKey:visitA,verdict:'Meets',siteName:'Old site'}
check(glanceForVisit(oldGlance,visitA,'Old site')===oldGlance,'matching headset context preserves its actual readout')
check(glanceForVisit(oldGlance,visitB,'New site').verdict==='Loading mission'&&glanceForVisit(oldGlance,visitB,'New site').siteName==='New site','headset entry never reuses another visit verdict')
// Next passing arrival: every hour (calendar granularity), never later than the old six-hour stepping, range stated.
{
  const { readFileSync } = await import('node:fs')
  const { DEFAULT_POWER } = await import('../src/architect/power.ts')
  const rd = (f: string) => JSON.parse(readFileSync('public/data/' + f, 'utf8'))
  const ref: Constraints = { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } } as Constraints
  for (const slug of ['malapert-massif', 'de-gerlache-rim', 'connecting-ridge']) {
    const s = buildSeries(slug, rd(`ephemeris/${slug}.sun.json`).rows, rd(`ephemeris/${slug}.earth.json`).rows, rd(`horizons/${slug}.json`))
    for (const row of [1272, 9000]) {
      const found = nextPassingArrival(s, row, ref)
      check(found.fromRow === row + 1 && found.checked === found.toRow - found.fromRow + 1, `${slug} ${row}: searched range is reported exactly`)
      if (found.row !== null) {
        check(evaluateWindow(s, found.row, found.row + 336, ref).pass, `${slug} ${row}: the found arrival really passes`)
        let earlier = false; for (let h = found.fromRow; h < found.row; h++) if (evaluateWindow(s, h, h + 336, ref).pass) earlier = true
        check(!earlier, `${slug} ${row}: no earlier hourly arrival was skipped`)
        let six: number | null = null; for (let h = row + 6; h <= Math.min(s.hours - 336, row + 2160); h += 6) if (evaluateWindow(s, h, h + 336, ref).pass) { six = h; break }
        check(six === null || found.row <= six, `${slug} ${row}: never later than six-hour stepping`)
      }
      check(/every hourly arrival from/.test(arrivalSearchText(found, r => String(r))), `${slug} ${row}: the notice states the searched hours`)
    }
    const end = nextPassingArrival(s, s.hours - 336, ref)
    check(end.row === null && end.checked === 0 && /cached predictions/.test(arrivalSearchText(end, r => String(r))), `${slug}: no search beyond coverage, and it says so`)
  }
}
// Sun and Earth visible together: same hourly flags as the solver; never more than either body alone.
{
  const { readFileSync } = await import('node:fs')
  const rd = (f: string) => JSON.parse(readFileSync('public/data/' + f, 'utf8'))
  const s = buildSeries('malapert-massif', rd('ephemeris/malapert-massif.sun.json').rows, rd('ephemeris/malapert-massif.earth.json').rows, rd('horizons/malapert-massif.json'))
  for (const row of [1104, 1272, 5000, 9000]) {
    const j = jointVisibility(s, row, row + 336), lit = s.litPrefix[row + 336] - s.litPrefix[row], link = s.linkPrefix[row + 336] - s.linkPrefix[row]
    check(j.hours === 336 && j.both <= Math.min(lit, link) && j.both >= lit + link - 336, `row ${row}: shared hours lie between the overlap bounds of Sun and Earth hours`)
    check(j.longestH <= j.both && (j.longestH === 0) === (j.longestStartRow === null), `row ${row}: longest shared window is consistent`)
    let manual = 0; for (let i = row; i < row + 336; i++) if (s.litPrefix[i + 1] - s.litPrefix[i] && s.linkPrefix[i + 1] - s.linkPrefix[i]) manual++
    check(manual === j.both, `row ${row}: shared hours match an hour-by-hour count`)
  }
  const ref = jointVisibility(s, 1104, 1440)
  check(ref.both === 336 && ref.pct === 100 && ref.longestH === 336, 'Reference 17 Oct mission: Sun and Earth visible together all 336 hours (both 100% alone)')
}
console.log(`Mission console ranking, calendar, events, terrain, provenance and quality: ${checks} checks passed`)
