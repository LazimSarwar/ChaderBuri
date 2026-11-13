import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { TerrainStore, TERRAIN_POLICY as p, LUNAR_RADIUS_M as R, datasetContains, terrainPixel, nearMissionSite, type TerrainManifest } from '../src/space/terrain.ts'

const preview = process.argv[2]
const raw = JSON.parse(readFileSync(preview ?? 'public/data/terrain/manifest.json','utf8'))
const manifest: TerrainManifest = raw
const sites = JSON.parse(readFileSync('public/data/sites.json','utf8')) as {slug:string;lat:number;lonEast:number}[]
assert.deepEqual(raw.scope.policy,p)
assert.equal(raw.scope.sitesSha256,createHash('sha256').update(readFileSync('public/data/sites.json')).digest('hex'))
assert.equal(raw.scope.kind,'mission-site-surroundings')
const store = new TerrainStore(manifest)
const packaged = new Map(manifest.datasets.map(d => [d.key,new Set(d.packagedTiles)]))
for(const d of manifest.datasets){
  assert.ok(d.packagedTiles?.length)
  assert.equal(packaged.get(d.key)!.size,d.packagedTiles!.length)
  const files = readdirSync('public'+d.path).filter(f=>f.endsWith('.bin.gz')).map(f=>f.replace('.bin.gz',''))
  for(const tile of d.packagedTiles!) assert.ok(files.includes(tile),`Required tile exists: ${d.key}/${tile}`)
  if(!preview) assert.deepEqual(new Set(files),packaged.get(d.key),'Physical files exactly match retained package')
}

// Independent great-circle destinations probe every site's permitted camera
// perimeter, including longitudes across the pole and date-line wrap.
function destination(lat:number,lon:number,distance:number,bearing:number){
  const phi=lat*Math.PI/180,lambda=lon*Math.PI/180,a=distance/R,b=bearing*Math.PI/180
  const out=Math.asin(Math.sin(phi)*Math.cos(a)+Math.cos(phi)*Math.sin(a)*Math.cos(b))
  return {lat:out*180/Math.PI,lon:(lambda+Math.atan2(Math.sin(b)*Math.sin(a)*Math.cos(phi),Math.cos(a)-Math.sin(phi)*Math.sin(out)))*180/Math.PI}
}
let points=0,patches=0
const needed = new Set<string>()
for(const site of sites){
  assert.ok(nearMissionSite(site.lat,site.lonEast,[site]))
  for(let b=0;b<360;b+=30){
    const inside=destination(site.lat,site.lonEast,p.siteRadiusM-1,b)
    const outside=destination(site.lat,site.lonEast,p.siteRadiusM+1,b)
    assert.ok(nearMissionSite(inside.lat,inside.lon,[site]))
    assert.ok(!nearMissionSite(outside.lat,outside.lon,[site]))
  }
  const centres = [{lat:site.lat,lon:site.lonEast},...Array.from({length:24},(_,i)=>destination(site.lat,site.lonEast,p.siteRadiusM-1,i*15))]
  for(const centre of centres) for(const altitude of [2,500,1499,1500,2999,3000,14999,29999,30000,49999]){
    const chosen=store.choose(centre.lat,centre.lon,altitude)
    const base=Math.max(chosen.spacingM,Math.ceil(altitude*p.altitudeSpacingFactor/chosen.spacingM)*chosen.spacingM)
    const steps=[base]
    while(steps.at(-1)!*p.gridHalfSteps<p.maxPatchHalfExtentM&&steps.length<p.maxPatchRings){const next=Math.min(p.maxGridStepM,steps.at(-1)!*4);if(next<=steps.at(-1)!)break;steps.push(next)}
    for(const step of steps){
      const dataset=step===base?chosen:store.forSpacing(step,{lat:centre.lat,lon:centre.lon})
      // Interior grid and every boundary, at several LOD transitions. These
      // destinations use great-circle bearings independently of mesh vectors.
      for(let y=-p.gridHalfSteps;y<=p.gridHalfSteps;y+=16)for(let x=-p.gridHalfSteps;x<=p.gridHalfSteps;x+=16){
        const point=destination(centre.lat,centre.lon,Math.hypot(x,y)*step,Math.atan2(x,y)*180/Math.PI)
        const d=datasetContains(dataset,point.lat,point.lon)?dataset:manifest.datasets.find(d=>d.key==='global')!
        let [px,py]=terrainPixel(d,point.lat,point.lon)
        px=d.projection==='cylindrical'?((px%d.width)+d.width)%d.width:Math.max(0,Math.min(d.width-1.000001,px))
        py=Math.max(0,Math.min(d.height-1.000001,py))
        const tile=`${Math.floor(px/d.blockSize)}-${Math.floor(py/d.blockSize)}`
        assert.ok(packaged.get(d.key)!.has(tile),`${site.slug} @${altitude}m needs ${d.key}/${tile}`)
        needed.add(`${d.key}/${tile}`);points++
      }
    }
    patches++
  }
}
assert.ok(!nearMissionSite(0,0,sites))
assert.ok(!nearMissionSite(-90,0,[]))
const originalFetch=globalThis.fetch
let requests=0
globalThis.fetch=async()=>{requests++;throw new Error('Unexpected network request')}
try{await assert.rejects(store.ensure(manifest.datasets.find(d=>d.key==='global')!,[{lat:0,lon:0}]),/outside supported/);assert.equal(requests,0)}finally{globalThis.fetch=originalFetch}
console.log(`Terrain scope verified: ${patches} site/approach/altitude cases, ${points.toLocaleString()} surface probes, ${needed.size} required tiles; arbitrary equatorial terrain blocked before download.`)
