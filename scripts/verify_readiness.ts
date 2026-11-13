import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSiteStory } from '../src/siteStories.ts'
import { requestJson } from '../src/lib/request.ts'
import { ProgressiveSites } from '../src/lib/progressiveSites.ts'
import { validatePredictionIndex, type PredictionIndex } from '../src/lib/predictionIndex.ts'
import type { SiteBundle } from '../src/lib/siteProducts.ts'
import type { Site } from '../src/data.ts'
let checks=0
const check=(ok:unknown,message:string)=>{assert.ok(ok,message);checks++}
const read=(p:string)=>JSON.parse(readFileSync('public/data/'+p,'utf8'))
const catalog:Site[]=read('sites.json'),index:PredictionIndex=read('prediction-index.json')
validatePredictionIndex(index)
const fixture=(site:Site):SiteBundle=>({site,eph:{sun:read(`ephemeris/${site.slug}.sun.json`),earth:read(`ephemeris/${site.slug}.earth.json`)},horizon:read(`horizons/${site.slug}.json`),duty:read(`dutycycle/${site.slug}.json`)})
for(const site of catalog){
 const b=fixture(site),story=buildSiteStory(site,b.duty,b.horizon,catalog)
 check(story.facts.some(f=>f.includes(b.duty.litPct.toFixed(1)+'%')),'Story reads the actual illumination')
 check(story.facts.some(f=>f.includes(b.duty.longestDarkH.toLocaleString()+' h')),'Story reads the current longest darkness')
 check(story.facts.some(f=>f.includes('does not establish a radio service')),'Earth visibility never claims a radio service')
 check(story.sources.length===3&&story.look.length===3,'Every story has products and measured bearings')
 const changed=buildSiteStory(site,{...b.duty,litPct:12.3,longestDarkH:4321},b.horizon,catalog)
 check(changed.facts.some(f=>f.includes('12.3%'))&&changed.facts.some(f=>f.includes((4321).toLocaleString())),'Changing a product changes its story automatically')
}
const first=fixture(catalog[0]),second=fixture(catalog[1]),third=fixture(catalog[2])
const fixtures=new Map([first,second,third].map(b=>[b.site.slug,b]))
const started:string[]=[],ready:string[]=[],waiting=new Map<string,(b:SiteBundle)=>void>()
const loader=new ProgressiveSites(catalog.slice(0,3),site=>{started.push(site.slug);return new Promise(resolve=>waiting.set(site.slug,resolve))},index,b=>ready.push(b.site.slug),()=>{},1)
const initial=loader.request(first.site.slug)
check(started.length===1,'Only the requested first site starts before first readiness')
waiting.get(first.site.slug)!(first);await initial
check(ready.length===1&&started.length===1,'The first usable site does not wait for the catalog')
loader.prefetch();const priority=loader.request(third.site.slug)
check(started.length===2,'Background concurrency is bounded')
waiting.get(second.site.slug)!(second);await new Promise(r=>setTimeout(r,0))
check(started.at(-1)===third.site.slug,'A selected queued site is prioritized')
waiting.get(third.site.slug)!(third);await priority;loader.stop()
const broken=new ProgressiveSites([first.site],async()=>first,{...index,coverage:{...index.coverage,samples:index.coverage.samples+1}},()=>{throw Error('Must not publish')},()=>{})
await assert.rejects(broken.request(first.site.slug),/indexed UTC grid/);checks++
broken.stop()
const originalFetch=globalThis.fetch
try{
 let cancelled=false
 globalThis.fetch=async(_url,options)=>{options?.signal?.addEventListener('abort',()=>{cancelled=true});return new Promise(()=>{})}
 await assert.rejects(requestJson('/stalled',{timeoutMs:20}),/timed out/);checks++
 check(cancelled,'Timed-out fetch is aborted')
 globalThis.fetch=async()=>new Response('{"ok":true}')
 await assert.rejects(requestJson('/changed',{expectedSha256:'0'.repeat(64)}),/fingerprint mismatch/);checks++
 const abort=new AbortController();abort.abort()
 await assert.rejects(requestJson('/cancelled',{signal:abort.signal}),/cancelled/);checks++
}finally{globalThis.fetch=originalFetch}
console.log(`Progressive loading, deadlines and scientific claim checks passed: ${checks}`)
