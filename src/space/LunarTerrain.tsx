import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useFrame,
  useLoader,
  useThree,
  type ThreeEvent,
} from '@react-three/fiber'
import * as T from 'three'
import { localFrame, sitePosition, type Site } from '../data'
import { attitudeAt, UNIT_KM, type BodyData } from './ephemeris'
import {
  LUNAR_RADIUS_M,
  TERRAIN_POLICY,
  datasetContains,
  type GeoPoint,
  type TerrainStore,
} from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import { SOIL_PERIOD_M, soilDetailTexture, terrainNoiseTexture } from './surfaceTextures'

/** Shader detail by render quality: 0 low, 1 balanced, 2 high (uniform switches; never a recompile). */
export type TerrainDetail = 0 | 1 | 2

/** Half-width of the visit's sunlight shadow box around the patch centre. */
const VISIT_SHADOW_EXTENT_M = 60
export type TerrainView = {
  active: boolean
  lat: number
  lon: number
  altitudeM: number
  resolutionM: number
  source: string
  loading: boolean
  error: string
}
type Patch = {
  geometry: T.BufferGeometry
  center: T.Vector3
  basis: T.Quaternion
  cutCos: number
  resolutionM: number
  source: string
}
const vertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec3 moonDirection; varying vec2 vUv; varying vec3 vNormal; varying vec3 vDirection;varying vec3 vMetres;varying vec2 vSoil;
uniform mat3 soilBasis;uniform vec2 soilOrigin;
void main(){vUv=uv;vNormal=normal;vDirection=moonDirection;vMetres=position*1737400.0;vSoil=(soilBasis*vMetres).xz+soilOrigin;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
vec3 transformedNormal=normalMatrix*normal;vec4 worldPosition=modelMatrix*vec4(position,1.0);
#include <shadowmap_vertex>
#include <logdepthbuf_vertex>
}`
const fragment = `
#include <logdepthbuf_pars_fragment>
#include <packing>
#include <shadowmap_pars_fragment>
uniform bool receiveShadow;
#include <shadowmask_pars_fragment>
uniform sampler2D map;uniform sampler2D soilMap;uniform sampler2D noiseMap;uniform float soilReady;uniform vec3 sunlight;uniform vec3 inspectionDirection;uniform float inspectionOn;uniform float inspectionWidth;uniform float explorationLight;uniform float detail;uniform float fineDetail;uniform float detailMid;uniform float detailFine;uniform float suitLamp;uniform float contrast;uniform vec3 eyeMetres;uniform vec3 headDirection;uniform vec3 fillColor;uniform mat3 soilBasis;
varying vec2 vUv;varying vec3 vNormal;varying vec3 vDirection;varying vec3 vMetres;varying vec2 vSoil;
// Illustrative regolith, anchored in lunar body coordinates. It never displaces the DEM.
// vSoil wraps every SOIL_P metres, so every periodic layer below repeats a whole number of times in that span.
#define SOIL_P ${SOIL_PERIOD_M}.0
float soilHash(vec2 p,float period){p=mod(p,period);vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
// Tileable value-noise lookup (32 cells per tile): r noise, gb its gradient per cell, a a second noise.
vec2 noiseSlope(vec4 n){return (n.gb*2.0-1.0)*1.5;}
// Small impact craterlets, display relief only, in metres. Irregular rims, mostly old and soft, a few fresh ones.
// A crater reaches at most half a cell from its centre, so only the 2 x 2 cells around the nearest corner matter.
// x: height (m), yz: gradient (m/m), w: albedo shift.
vec4 craterlets(vec2 pm,float cellM,float density){float period=SOIL_P/cellM;vec2 p=pm/cellM,cell=floor(p),f=fract(p),toward=vec2(f.x<.5?-1.0:1.0,f.y<.5?-1.0:1.0);vec4 r=vec4(0.0);
for(int k=0;k<4;k++){vec2 c=vec2(k==1||k==3?1.0:0.0,k>=2?1.0:0.0)*toward,id=cell+c;if(soilHash(id,period)>=density)continue;
vec2 centre=c+vec2(soilHash(id+19.3,period),soilHash(id+41.7,period));float s=soilHash(id+7.0,period);float radius=.05+.15*s*s;
vec2 v=f-centre;float dist=length(v);if(dist>radius*2.0)continue;
// Irregular rim: low harmonics of the bearing, from the unit offset (no trigonometry).
vec2 u=v/max(dist,1e-4),w=vec2(soilHash(id+5.3,period),soilHash(id+8.9,period))*2.0-1.0;
float rr=radius*(1.0+.1*dot(vec2(u.x*u.x-u.y*u.y,2.0*u.x*u.y),w)+.07*dot(u,w.yx)+.05*(4.0*u.x*u.x*u.x-3.0*u.x)*w.x);
float d=dist/rr,age=pow(soilHash(id+11.9,period),.35),depth=rr*cellM*mix(.1,.03,age),rimW=mix(.24,.5,age),rimH=mix(.4,.12,age);
float bowl=exp(-2.3*d*d),rim=exp(-pow((d-1.0)/rimW,2.0)),h=depth*(rimH*rim-bowl),dh=depth*(4.6*d*bowl-2.0*rimH*(d-1.0)/(rimW*rimW)*rim);
r.x+=h;r.yz+=dh*v/(max(dist,1e-4)*rr*cellM);r.w+=(1.0-age)*(.07*exp(-pow((d-1.3)*1.8,2.0))-.03*bowl);}return r;}
// Scattered pebbles with their low-Sun shadows, display only. One stone at most per cell (centre in the middle 40%,
// radius <= .15 cell), so a stone and its clamped shadow only reach the cells on its down-Sun side: a 2 x 2 block.
// xy: gradient (m/m), z: albedo shift, w: sunlight factor (shadow).
vec4 pebbles(vec2 pm,float cellM,float density,vec2 sunH,float tanEl){float period=SOIL_P/cellM;vec2 p=pm/cellM,base=floor(p),dir=vec2(sunH.x>0.0?1.0:-1.0,sunH.y>0.0?1.0:-1.0);vec4 r=vec4(0.0,0.0,0.0,1.0);
for(int k=0;k<4;k++){vec2 o=vec2(k==1||k==3?1.0:0.0,k>=2?1.0:0.0)*dir,id=base+o;if(soilHash(id+3.7,period)>=density)continue;
vec2 c=id+.3+.4*vec2(soilHash(id+1.3,period),soilHash(id+8.1,period));float rad=.03+.12*pow(soilHash(id+2.9,period),2.5),hgt=rad*(.3+.45*soilHash(id+6.6,period));
vec2 v=p-c;float d2=dot(v,v)/(rad*rad);
if(k==0&&d2<1.0){float z=sqrt(1.0-d2);r.xy-=hgt*v/(rad*rad*max(z,.3));r.z+=(soilHash(id+9.2,period)-.4)*.45;}
else if(d2>=1.0){float along=dot(-v,sunH),perp=abs(dot(v,vec2(-sunH.y,sunH.x)));if(along>0.0&&perp<rad){float top=hgt*sqrt(1.0-perp*perp/(rad*rad)),ray=along*max(tanEl,hgt/.55);r.w*=1.0-.82*smoothstep(-.15*hgt,.15*hgt,top-ray);}}}
return r;}
// Scanned regolith, texture-bombed: a slowly varying index picks a random offset per patch and patches blend
// across a soft seam, so the 2.7 m photo tile never repeats visibly. One RGBA read (slope + albedo), two only inside a seam.
vec4 soilBomb(vec2 uv,vec2 gx,vec2 gy,float index){float l=index*7.0,i=floor(l),f=fract(l);
vec2 oa=fract(sin(vec2(3.1,7.7)*i)*43.7),ob=fract(sin(vec2(3.1,7.7)*(i+1.0))*43.7);
vec4 a,b;if(f<.2){a=textureGrad(soilMap,uv+oa,gx,gy);b=a;}else if(f>.8){b=textureGrad(soilMap,uv+ob,gx,gy);a=b;}else{a=textureGrad(soilMap,uv+oa,gx,gy);b=textureGrad(soilMap,uv+ob,gx,gy);}
float w=smoothstep(.2,.8,f);return mix(a,b,clamp(w+2.4*(a.b-b.b)*w*(1.0-w),0.0,1.0));}
void main(){
#include <logdepthbuf_fragment>
vec3 n=normalize(vNormal);float day=dot(n,sunlight);float shade=getShadowMask();
vec3 radial=normalize(vDirection);
vec2 mapUV=vec2((atan(-radial.z,radial.x)+3.14159265)/6.2831853,(asin(clamp(radial.y,-1.0,1.0))+1.5707963)/3.14159265);
vec3 toEye=eyeMetres-vMetres;float rangeM=length(toEye);vec3 view=toEye/max(rangeM,.0001);
// Away from a surface visit the illustrative grey fades with range, so an approach view meets the globe's map albedo.
float local=detail*mix(1.0-smoothstep(1500.0,15000.0,rangeM),1.0,explorationLight);
// Pixel footprint on the ground (m): between the mean and the longest axis, so grazing views keep some detail
// without aliasing. Every layer fades by its own size against this, so there is no range band anywhere.
vec2 sdx=dFdx(vSoil),sdy=dFdy(vSoil);float foot=max(sqrt(sqrt(abs(sdx.x*sdy.y-sdx.y*sdy.x))*max(length(sdx),length(sdy))),1e-5);
vec2 sunSoil=(soilBasis*sunlight).xz;vec2 sunH=length(sunSoil)>1e-5?normalize(sunSoil):vec2(1.0,0.0);float tanEl=max(day,0.0)/max(sqrt(max(1.0-day*day,0.0)),1e-3);
// Noise tiles of 4096, 1024 and 256 m (128, 32 and 8 m cells); mip-filtered, three reads in all.
vec4 nT=texture2D(noiseMap,vSoil/4096.0),nM=texture2D(noiseMap,vSoil/1024.0+.31),nS=texture2D(noiseMap,vSoil/256.0+.17);
// Far tone: broad albedo mottling (128, 32 and 8 m) that stays visible to the horizon.
float tone=.42*nT.r+.18*nT.a+.24*nM.a+.16*mix(nS.a,.5,smoothstep(1.0,4.0,foot));
// Gentle undulation on 32 m and 8 m scales; it catches the grazing Sun so distant ground is never plastic-smooth.
vec2 swell=noiseSlope(nM)*(.7/32.0)*(1.0-smoothstep(2.0,7.0,foot))+noiseSlope(nS)*(.18/8.0)*(1.0-smoothstep(.5,1.8,foot));
// Scanned soil near the feet (2.7 m tile, bombed) and a rotated 10.7 m layer for mid-range patches.
float near=soilReady*local,nearB=near*detailMid*(1.0-smoothstep(.9,2.2,foot));vec4 sA=vec4(.5,.5,.5,1.0),sB=sA;
if(near>.01&&foot<.4)sA=soilBomb(vSoil*.375,sdx*.375,sdy*.375,nS.r);
// The rotated 10.7 m layer fades out beyond about 100 m, where it averages to the mean in its mip chain anyway.
if(nearB>.01)sB=textureGrad(soilMap,vec2(vSoil.y,-vSoil.x)*.09375+.37,vec2(sdx.y,-sdx.x)*.28,vec2(sdy.y,-sdy.x)*.28);
// Craterlets fade before they are smaller than a few pixels, so they never alias into streaks.
vec4 craters=vec4(0.0);float cBig=local*detailMid*(1.0-smoothstep(.025,.07,foot/32.0)),cSmall=local*fineDetail*detailFine*(1.0-smoothstep(.025,.07,foot/8.0));
if(cBig>.01)craters+=craterlets(vSoil,32.0,.36)*cBig;
if(cSmall>.01)craters+=craterlets(vSoil,8.0,.42)*cSmall;
// One pebble layer (2 m cells); finer gravel at the feet comes from the scanned photo.
vec4 stones=vec4(0.0,0.0,0.0,1.0);float pMid=local*detailMid*(1.0-smoothstep(.03,.09,foot/2.0));
if(pMid>.01){vec4 s=pebbles(vSoil,2.0,.42,sunH,tanEl);stones.xyz+=s.xyz*pMid;stones.w*=mix(1.0,s.w,pMid);}
// Fine soil grain (3 cm) right at the feet.
vec2 grain=vec2(0.0);float gFine=local*fineDetail*detailFine*(1.0-smoothstep(.004,.012,foot));
if(gFine>.01)grain=noiseSlope(textureGrad(noiseMap,vSoil,sdx,sdy))*(32.0*.0011)*gFine;
vec3 albedo=mix(texture2D(map,mapUV).rgb,vec3(.232,.226,.214),local);
float variation=mix(1.0,.6+.8*tone,local)*(1.0+(sA.b*2.0-1.0)*.8*near)*(1.0+(sB.b*2.0-1.0)*.5*nearB)+craters.w*1.6+stones.z;
albedo*=max(.3,variation);
// Fine relief as a slope field in body-anchored soil coordinates (metres per metre); the DEM mesh is untouched.
vec2 slopeA=(sA.rg*2.0-1.0)*.42,slopeB=(sB.rg*2.0-1.0)*.42*.25;
vec2 slope=local*swell+near*slopeA+nearB*vec2(-slopeB.y,slopeB.x)+craters.yz+stones.xy+grain;
slope*=min(1.0,1.6/max(length(slope),.0001));
vec3 tx=vec3(soilBasis[0][0],soilBasis[1][0],soilBasis[2][0]),ty=vec3(soilBasis[0][2],soilBasis[1][2],soilBasis[2][2]);
vec3 fineNormal=normalize(n-slope.x*normalize(tx-n*dot(tx,n))-slope.y*normalize(ty-n*dot(ty,n)));
float lambert=max(dot(fineNormal,sunlight),0.0);
// Surface-visit photometry: a lunar-Lambert reflectance (limb term plus phase darkening, after McEwen)
// instead of a flat Lambert disc model, plus a narrow opposition surge looking down-Sun. Display only;
// the incident Sun direction stays measured.
float mu=max(dot(fineNormal,view),0.0),phaseAngle=acos(clamp(dot(sunlight,view),-1.0,1.0));
float limb=.15+.5*exp(-phaseAngle/1.2);
float lunarLambert=(limb*2.0*lambert/(lambert+max(mu,.04))+(1.0-limb)*lambert)*(.55+.6*exp(-phaseAngle/.9)+.3*exp(-phaseAngle/.06))*1.35;
float sunTerm=mix(1.6*pow(lambert,.8),lunarLambert*smoothstep(-.012,.02,day)*stones.w,explorationLight);
// Display aid: a faint, slightly bluish fill (earthshine-like) keeps shadowed ground from reading as pure black.
vec3 col=albedo*(.012*(1.0-explorationLight)+sunTerm*shade+fillColor*(.55+.45*max(fineNormal.y,0.0)));
// Raking survey fill and a soft head-directed lamp replace the flat white wash (skipped, by uniform, when both are off).
if(inspectionOn+suitLamp>0.0){
float spot=exp(-pow(length(normalize(vDirection)-inspectionDirection)/inspectionWidth,2.0))*(1.0-smoothstep(-.015,0.0,day)*shade);
float cone=smoothstep(.72,.95,dot(normalize(-toEye),headDirection));
float survey=.035+.32*max(dot(fineNormal,normalize(vec3(.7,.22,.55))),0.0);
float helmet=1.5*max(dot(fineNormal,normalize(toEye)),0.0)*cone/(1.0+rangeM*rangeM/60.0);
float orbitSpot=(.12+.85*max(dot(n,normalize(vec3(.4,1.0,.3))),0.0))*spot;
col+=albedo*inspectionOn*mix(orbitSpot,survey+helmet,explorationLight);
// Optional illustrative suit lamp (off by default): the same head-directed cone, without the survey fill.
col+=albedo*suitLamp*explorationLight*helmet*(1.0-inspectionOn);
}
// Optional display tone curve; geometry, normals and incident-light direction stay measured.
col=mix(col,pow(max(col,vec3(0.0)),vec3(1.08))*1.12,contrast);
gl_FragColor=vec4(col,1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`

async function buildPatch(
  store: TerrainStore,
  centerLat: number,
  centerLon: number,
  altitudeM: number,
): Promise<Patch> {
  const half = TERRAIN_POLICY.gridHalfSteps, gridSteps = half * 2
  const chosen = store.choose(centerLat, centerLon, altitudeM)
  const base = Math.max(
    chosen.spacingM,
    Math.ceil((altitudeM * TERRAIN_POLICY.altitudeSpacingFactor) / chosen.spacingM) * chosen.spacingM,
  )
  const steps = [base]
  while (steps[steps.length - 1] * TERRAIN_POLICY.gridHalfSteps < TERRAIN_POLICY.maxPatchHalfExtentM && steps.length < TERRAIN_POLICY.maxPatchRings) {
    const next = Math.min(TERRAIN_POLICY.maxGridStepM, steps[steps.length - 1] * 4)
    if (next <= steps[steps.length - 1]) break
    steps.push(next)
  }
  const up = new T.Vector3(...sitePosition(centerLat, centerLon)),
    frame = localFrame([up.x, up.y, up.z])
  const east = new T.Vector3(...frame.east),
    north = new T.Vector3(...frame.north),
    south = north.clone().negate()
  const basis = new T.Quaternion().setFromRotationMatrix(
    new T.Matrix4().makeBasis(east, up, south),
  )
  const vertices: {
    east: number
    north: number
    point: T.Vector3
    geo: GeoPoint
    dataset: ReturnType<TerrainStore['choose']>
  }[] = []
  const faces: number[] = []
  const global = store.manifest.datasets.find((d) => d.key === 'global')!
  const add = (e: number, n: number, d: ReturnType<TerrainStore['choose']>) => {
    const distance = Math.hypot(e, n),
      angle = distance / LUNAR_RADIUS_M
    const p = up.clone().multiplyScalar(Math.cos(angle))
    if (distance)
      p.addScaledVector(east, (e / distance) * Math.sin(angle)).addScaledVector(
        north,
        (n / distance) * Math.sin(angle),
      )
    const geo = {
      lat: (Math.asin(Math.max(-1, Math.min(1, p.y))) * 180) / Math.PI,
      lon: (Math.atan2(-p.z, p.x) * 180) / Math.PI,
    }
    const id = vertices.length
    vertices.push({
      east: e,
      north: n,
      point: p,
      geo,
      dataset: datasetContains(d, geo.lat, geo.lon) ? d : global,
    })
    return id
  }
  let previous = 0,
    previousDataset = chosen
  for (const step of steps) {
    const extent = step * TERRAIN_POLICY.gridHalfSteps
    const dataset =
      step === base
        ? chosen
        : store.forSpacing(step, { lat: centerLat, lon: centerLon })
    const hole = previous ? Math.ceil(previous / step + 1) * step : 0
    const grid: number[][] = []
    for (let y = 0; y <= gridSteps; y++) {
      grid[y] = []
      for (let x = 0; x <= gridSteps; x++)
        grid[y][x] = add((x - half) * step, (half - y) * step, dataset)
    }
    for (let y = 0; y < gridSteps; y++)
      for (let x = 0; x < gridSteps; x++) {
        const e0 = (x - half) * step,
          e1 = e0 + step,
          n1 = (half - y) * step,
          n0 = n1 - step
        if (hole && e0 >= -hole && e1 <= hole && n0 >= -hole && n1 <= hole)
          continue
        const a = grid[y][x],
          b = grid[y + 1][x],
          c = grid[y][x + 1],
          d = grid[y + 1][x + 1]
        faces.push(a, b, c, c, b, d)
      }
    if (previous) {
      // Sew each inner edge to the coarser grid with a zipper triangulation.
      // Every inner boundary vertex remains, preventing T-junction holes.
      const outerCount = Math.round((hole * 2) / step),
        innerCount = gridSteps
      for (let side = 0; side < 4; side++) {
        const sidePoint = (along: number, r: number): [number, number] =>
          side === 0
            ? [along, r]
            : side === 1
              ? [r, -along]
              : side === 2
                ? [-along, -r]
                : [-r, along]
        const inner = Array.from({ length: innerCount + 1 }, (_, i) =>
          add(
            ...sidePoint(-previous + (2 * previous * i) / innerCount, previous),
            previousDataset,
          ),
        )
        const outer = Array.from({ length: outerCount + 1 }, (_, i) =>
          add(...sidePoint(-hole + (2 * hole * i) / outerCount, hole), dataset),
        )
        let i = 0,
          j = 0
        while (i < innerCount || j < outerCount) {
          if (
            j === outerCount ||
            (i < innerCount && (i + 1) / innerCount <= (j + 1) / outerCount)
          ) {
            faces.push(inner[i], outer[j], inner[i + 1])
            i++
          } else {
            faces.push(inner[i], outer[j], outer[j + 1])
            j++
          }
        }
      }
    }
    // Give input and camera rendering a frame between mesh bands.
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    previous = extent
    previousDataset = dataset
  }
  const groups = new Map<typeof chosen, GeoPoint[]>()
  for (const v of vertices) {
    if (!groups.has(v.dataset)) groups.set(v.dataset, [])
    groups.get(v.dataset)!.push(v.geo)
  }
  await Promise.all([...groups].map(([d, p]) => store.ensure(d, p)))
  await store.ensure(chosen, [{ lat: centerLat, lon: centerLon }])
  const ground = store.height(chosen, centerLat, centerLon)!
  const center = up
    .clone()
    .multiplyScalar((LUNAR_RADIUS_M + ground) / (UNIT_KM * 1000))
  const coordinates = new Float32Array(vertices.length * 3),
    uv = new Float32Array(vertices.length * 2),
    directions = new Float32Array(vertices.length * 3)
  for (let i = 0; i < vertices.length; i++) {
    if (i > 0 && i % 8192 === 0)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      )
    const v = vertices[i],
      height = store.height(v.dataset, v.geo.lat, v.geo.lon)
    if (height === null)
      throw new Error('Measured terrain has a missing elevation sample')
    const p = v.point
      .clone()
      .multiplyScalar((LUNAR_RADIUS_M + height) / (UNIT_KM * 1000))
      .sub(center)
    coordinates.set([p.dot(east), p.dot(up), p.dot(south)], i * 3)
    directions.set([v.point.x, v.point.y, v.point.z], i * 3)
    uv.set([((v.geo.lon + 180) / 360 + 1) % 1, (v.geo.lat + 90) / 180], i * 2)
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.BufferAttribute(coordinates, 3))
  geometry.setAttribute('uv', new T.BufferAttribute(uv, 2))
  geometry.setAttribute('moonDirection', new T.BufferAttribute(directions, 3))
  geometry.setIndex(faces)
  // Zipper side orientation can differ from grid orientation; ensure all
  // triangles face the radial up side before calculating the final normals.
  const indices = geometry.getIndex()!
  for (let i = 0; i < indices.count; i += 3) {
    const a = indices.getX(i),
      b = indices.getX(i + 1),
      c = indices.getX(i + 2)
    const ax = coordinates[a * 3],
      az = coordinates[a * 3 + 2]
    const crossY =
      (coordinates[b * 3 + 2] - az) * (coordinates[c * 3] - ax) -
      (coordinates[b * 3] - ax) * (coordinates[c * 3 + 2] - az)
    if (crossY < 0) {
      indices.setX(i + 1, c)
      indices.setX(i + 2, b)
    }
  }
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return {
    geometry,
    center,
    basis,
    cutCos: Math.cos((previous / LUNAR_RADIUS_M) * 0.94),
    resolutionM: chosen.spacingM,
    source: chosen.source,
  }
}

export function LunarTerrain({
  store,
  moon,
  runtime,
  clock,
  sites,
  contrast = false,
  detailLevel = 2,
  shadowMapSize,
  suitLamp = false,
  onView,
}: {
  store: TerrainStore
  moon: BodyData
  runtime: Runtime
  clock: React.RefObject<SimClock>
  /** measured terrain exists only at the mission sites; elsewhere the globe
   *  stays an orbital view — there is nothing to do on random ground */
  sites: Site[]
  contrast?: boolean
  /** Decorative soil detail from the render quality; never changes the DEM. */
  detailLevel?: TerrainDetail
  /** Sunlight shadow map size; default 1024 (512 on narrow screens). */
  shadowMapSize?: number
  /** Illustrative helmet lamp on the regolith (display only). */
  suitLamp?: boolean
  onView?: (v: TerrainView) => void
}) {
  const { invalidate, raycaster: pointerRaycaster } = useThree()
  const narrow=useThree(state=>state.size.width)<768,shadowSize=shadowMapSize??(narrow?512:1024)
  const [patch, setPatch] = useState<Patch | null>(null)
  const siteUnits = useMemo(
    () => sites.map((s) => new T.Vector3(...sitePosition(s.lat, s.lonEast)).normalize()),
    [sites],
  )
  const group = useRef<T.Group>(null),
    busy = useRef(false),
    last = useRef({ lat: 999, lon: 999, altitude: Infinity }),
    error = useRef(''),
    tick = useRef(0),
    soilFade = useRef({ last: 0 }),
    reported = useRef(''),
    reportedAt = useRef(0)
  // The view report only reaches the app when something it shows changed: an unchanged report every 250 ms would
  // re-render the whole interface four times a second during a visit (measured: most of the visit's JS garbage).
  const report = (v: TerrainView) => {
    const key = `${v.active}/${v.lat.toFixed(5)}/${v.lon.toFixed(5)}/${Number(v.altitudeM.toPrecision(3))}/${v.resolutionM}/${v.source}/${v.loading}/${v.error}`
    // A slow refresh still re-sends an unchanged view, in case the app cleared its copy (e.g. on a focus change).
    if (key === reported.current && performance.now() - reportedAt.current < 10000) return
    reported.current = key
    reportedAt.current = performance.now()
    onView?.(v)
  }
  const map = useLoader(T.TextureLoader, '/textures/space/moon-map.jpg')
  const [soilMap,setSoilMap]=useState<T.Texture|null>(null),soilLoading=useRef(false)
  const noise = useMemo(terrainNoiseTexture, [])
  useEffect(() => () => noise.dispose(), [noise])
  const material = useMemo(
    () =>
      new T.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        // Front faces only for the camera pass. Every patch triangle winds along its upward normal (all 157,184 checked)
        // and the camera is always above the surface, so back faces are hidden behind front faces; the logarithmic depth
        // buffer writes gl_FragDepth, which disables early depth rejection, so each hidden back-face fragment was still
        // fully shaded. Measured at High on an Intel UHD 630: about 5-10 ms less GPU per frame when turning, with identical
        // ground views and <=0.12% of horizon pixels changed, where hidden back faces had won near-ties at grazing angles.
        // The shadow pass keeps both sides (its previous behaviour), so shadows are unchanged.
        side: T.FrontSide,
        shadowSide: T.DoubleSide,
        lights: true,
        uniforms: T.UniformsUtils.merge([
          T.UniformsLib.lights,
          {
            map: { value: map },
            soilMap:{value:map},soilReady:{value:0},noiseMap:{value:noise},
            sunlight: { value: new T.Vector3() },
            inspectionDirection: { value: runtime.inspectionDirection },
            inspectionOn: { value: 0 },
            inspectionWidth: { value: 0.09 },
            explorationLight: { value: 0 },
            soilBasis: { value: new T.Matrix3() },
            soilOrigin: { value: new T.Vector2() },
            eyeMetres: { value: new T.Vector3() },
            headDirection: { value: new T.Vector3() },
            detail: { value: 0 },
            fineDetail: { value: 1 },
            suitLamp: { value: 0 },
            detailMid: { value: 1 },
            detailFine: { value: 1 },
            contrast: { value: 0 },
            fillColor: { value: new T.Vector3() },
          },
        ]),
      }),
    [map, runtime, noise],
  )
  const light = useRef<T.DirectionalLight>(null),
    lightTarget = useMemo(() => new T.Object3D(), []),
    lastShadow = useRef({ patch: null as Patch | null, row: -1, extent: 0, eastM: 0, northM: 0, sun: new T.Vector3(), at: -Infinity })
  useEffect(() => () => material.dispose(), [material])
  // The scanned soil fades in over a moment (see useFrame), so its arrival never pops.
  useEffect(()=>{material.uniforms.soilMap.value=soilMap??map;material.uniforms.soilReady.value=0;soilFade.current.last=performance.now();invalidate();return()=>soilMap?.dispose()},[soilMap,map,material,invalidate])
  // Detail layers switch by uniform (coherent branches), so a quality change never recompiles the terrain shader.
  useEffect(()=>{material.uniforms.detailMid.value=detailLevel>=1?1:0;material.uniforms.detailFine.value=detailLevel>=2?1:0;invalidate()},[material,detailLevel,invalidate])
  // A new shadow map size takes effect on the next shadow refresh.
  const appliedShadowSize=useRef(shadowSize)
  useEffect(()=>{const l=light.current;if(!l||appliedShadowSize.current===shadowSize)return;appliedShadowSize.current=shadowSize;l.shadow.mapSize.set(shadowSize,shadowSize);l.shadow.map?.dispose();l.shadow.map=null;l.shadow.needsUpdate=true;lastShadow.current.extent=0;invalidate()},[shadowSize,invalidate])
  useEffect(() => () => patch?.geometry.dispose(), [patch])
  // A never-drawn stand-in with the patch's attributes, so a scene-wide renderer.compileAsync() links the terrain
  // program in the background before the first patch exists (the program is keyed by material and attributes).
  const warmGeometry = useMemo(() => { const g = new T.BufferGeometry(); for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2], ['moonDirection', 3]] as const) g.setAttribute(name, new T.BufferAttribute(new Float32Array(3 * size), size)); return g }, [])
  useEffect(() => () => warmGeometry.dispose(), [warmGeometry])
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const frameTemp=useMemo(()=>({body:new T.Vector3(),unit:new T.Vector3(),sun:new T.Vector3(),shadowSun:new T.Vector3(),point:new T.Vector3(),inverse:new T.Quaternion(),localInverse:new T.Quaternion(),matrix:new T.Matrix4()}),[])
  useFrame(({ camera }) => {
    const q = attitudeAt(moon, clock.current.row)
    const bodyCamera = camera.position
      .clone()
      .add(runtime.origin)
      .sub(runtime.positions.get('Moon')!)
      .applyQuaternion(frameTemp.inverse.copy(q).invert())
    // A surface visit needs its fine mesh centred on the selected target,
    // rather than retaining an approach patch centred tens of kilometres away.
    const unit = runtime.visit&&runtime.visitAnchor?frameTemp.unit.copy(runtime.visitAnchor.up):frameTemp.unit.copy(bodyCamera).normalize(),
      lat = (Math.asin(Math.max(-1, Math.min(1, unit.y))) * 180) / Math.PI,
      lon = (Math.atan2(-unit.z, unit.x) * 180) / Math.PI
    const height = store.bestHeight(lat, lon) ?? 0,
      altitude = runtime.visit?Math.max(1,runtime.eyeHeightM):bodyCamera.length() * LUNAR_RADIUS_M - LUNAR_RADIUS_M - height
    // Measured terrain exists only around the mission sites. Elsewhere the
    // bump-mapped globe is the view — tiles would be scenery with no purpose.
    const nearSite =
      siteUnits.some((u) => u.dot(unit) >= Math.cos(TERRAIN_POLICY.siteRadiusM / LUNAR_RADIUS_M))
    const visible =
      runtime.focus === 'Moon' && !runtime.sky && altitude < TERRAIN_POLICY.maxTerrainAltitudeM && nearSite
    if (group.current) group.current.visible = visible && !!patch
    if (!visible) {
      runtime.terrainReady = false
      if (performance.now() - tick.current > 250) {
        tick.current = performance.now()
        report({
          active: false,
          lat,
          lon,
          altitudeM: altitude,
          resolutionM: patch?.resolutionM ?? 1900,
          source: patch?.source ?? '',
          loading: false,
          error: '',
        })
      }
      return
    }
    // The scanned regolith photo becomes one slope + albedo lookup (built once, on first visit).
    if(runtime.visit&&!soilMap&&!soilLoading.current){soilLoading.current=true;new T.ImageLoader().load('/textures/space/regolith-detail-v1.jpg',image=>{if(!alive.current)return;try{setSoilMap(soilDetailTexture(image));invalidate()}catch{/* Procedural layers remain usable. */}},undefined,()=>{/* Procedural fallback remains usable; avoid a per-frame retry loop. */})}
    // Decorative detail now follows the scene's render quality (detailLevel); the soil photo fades in once loaded.
    if(soilMap&&material.uniforms.soilReady.value<1){const now=performance.now(),dt=Math.min(.1,(now-soilFade.current.last)/1000);soilFade.current.last=now;material.uniforms.soilReady.value=Math.min(1,material.uniforms.soilReady.value+dt/.9);invalidate()}
    material.uniforms.suitLamp.value=suitLamp&&runtime.visit?1:0
    const desired = store.choose(lat, lon, altitude)
    const delta =
      ((Math.hypot(
        lat - last.current.lat,
        (lon - last.current.lon) * Math.cos((lat * Math.PI) / 180),
      ) *
        Math.PI) /
        180) *
      LUNAR_RADIUS_M
    const changed =
      (runtime.visit&&delta>Math.max(10,desired.spacingM)) ||
      delta > Math.max(50, (patch?.resolutionM ?? 1900) * 12) ||
      desired.source !== patch?.source ||
      altitude > last.current.altitude * 1.8 ||
      altitude < last.current.altitude * 0.55
    if (!busy.current && changed) {
      busy.current = true
      error.current = ''
      buildPatch(store, lat, lon, Math.max(2, altitude))
        .then((p) => {
          if (alive.current) {
            setPatch(p)
            setTimeout(() => {
              if (alive.current) invalidate()
            }, 270)
            last.current = { lat, lon, altitude }
          } else p.geometry.dispose()
        })
        .catch((e) => {
          error.current = String(e)
        })
        .finally(() => {
          busy.current = false
          invalidate()
        })
    }
    runtime.terrainReady = !!patch&&(!runtime.visit||!runtime.visitAnchor||frameTemp.point.copy(patch.center).normalize().dot(runtime.visitAnchor.up)>=Math.cos(Math.max(10,patch.resolutionM*2)/LUNAR_RADIUS_M))
    if (patch && group.current) {
      group.current.position
        .copy(runtime.positions.get('Moon')!)
        .sub(runtime.origin)
        .add(frameTemp.point.copy(patch.center).applyQuaternion(q))
      group.current.quaternion.copy(q).multiply(patch.basis)
      runtime.terrainDirection.copy(patch.center).normalize()
      runtime.terrainCos = patch.cutCos
      material.uniforms.sunlight.value
        .copy(runtime.positions.get('Sun')!)
        .sub(runtime.positions.get('Moon')!)
        .normalize()
        .applyQuaternion(frameTemp.localInverse.copy(group.current.quaternion).invert())
      material.uniforms.inspectionOn.value = runtime.inspectionEnabled ? 1 : 0
      material.uniforms.explorationLight.value = runtime.visit ? 1 : 0
      material.uniforms.soilBasis.value.setFromMatrix4(frameTemp.matrix.makeRotationFromQuaternion(patch.basis))
      material.uniforms.soilOrigin.value.set(((patch.center.x*LUNAR_RADIUS_M)%SOIL_PERIOD_M+SOIL_PERIOD_M)%SOIL_PERIOD_M,((patch.center.z*LUNAR_RADIUS_M)%SOIL_PERIOD_M+SOIL_PERIOD_M)%SOIL_PERIOD_M)
      material.uniforms.eyeMetres.value.copy(bodyCamera).sub(patch.center).applyQuaternion(frameTemp.localInverse.copy(patch.basis).invert()).multiplyScalar(LUNAR_RADIUS_M)
      camera.getWorldDirection(material.uniforms.headDirection.value).applyQuaternion(group.current.quaternion.clone().invert())
      material.uniforms.inspectionDirection.value.copy(
        runtime.inspectionDirection,
      )
      material.uniforms.inspectionWidth.value = runtime.local
        ? Math.max(20, Math.min(10000, altitude * 1.5)) / LUNAR_RADIUS_M
        : 0.09
      material.uniforms.detail.value = runtime.visit ? 0.85 : runtime.local ? 0.65 : 0
      // Display aid only (about 3% of full sunlight, slightly blue like earthshine): shadowed ground keeps its form.
      material.uniforms.fillColor.value.set(0.030, 0.033, 0.041).multiplyScalar(runtime.visit ? 1 : 0)
      material.uniforms.contrast.value = contrast && runtime.visit ? 1 : 0
      if (light.current) {
        const l = light.current,
          sunDirection = runtime.positions
            .get('Sun')!
            .clone()
            .sub(runtime.positions.get('Moon')!)
            .normalize()
        // The hardware, rocks and gloves (standard materials) lose direct sunlight as the Sun sinks below the local
        // horizontal, matching the regolith shader's own fade; otherwise they glowed in sunlight beyond the shadow box.
        const sunUp=material.uniforms.sunlight.value.y
        l.intensity=runtime.visit?2.6*T.MathUtils.smoothstep(sunUp,-.02,.02):0
        l.target = lightTarget
        if (!runtime.visit) lightTarget.position.copy(group.current.position)
        const extent = runtime.visit?VISIT_SHADOW_EXTENT_M:Math.max(1000, Math.min(30000, altitude * 1.5)),
          previous = lastShadow.current, sunBody = frameTemp.shadowSun.copy(sunDirection).applyQuaternion(frameTemp.inverse.copy(q).invert())
        if (
          previous.patch !== patch ||
          (previous.sun.angleTo(sunBody) > Math.PI / 1800 && performance.now()-previous.at >= 250) ||
          Math.abs(extent - previous.extent) > extent * 0.1 ||
          runtime.shadowDirty ||
          (runtime.visit && Math.hypot(runtime.visitOffset.eastM - previous.eastM, runtime.visitOffset.northM - previous.northM) > 8)
        ) {
          runtime.shadowDirty = false
          // On the surface the static shadow box follows the visitor (refreshed every 8 m walked).
          lightTarget.position.copy(runtime.visit ? camera.position : group.current.position)
          const c = l.shadow.camera
          c.left = c.bottom = -extent / LUNAR_RADIUS_M
          c.right = c.top = extent / LUNAR_RADIUS_M
          c.near=runtime.visit?499000/LUNAR_RADIUS_M:.000001
          c.far=runtime.visit?501000/LUNAR_RADIUS_M:1
          l.shadow.bias=runtime.visit?-.00004:-.00001
          // Grazing sunlight needs about one shadow texel of normal offset, or the ground self-shadows in bands.
          l.shadow.normalBias=runtime.visit?1.1*(2*extent/l.shadow.mapSize.x)/LUNAR_RADIUS_M:.000001
          c.updateProjectionMatrix()
          l.shadow.needsUpdate = true
          lastShadow.current = { patch, row: clock.current.row, extent, eastM: runtime.visitOffset.eastM, northM: runtime.visitOffset.northM, sun: sunBody.clone(), at: performance.now() }
        }
        l.position
          .copy(lightTarget.position)
          .addScaledVector(sunDirection, 500000 / LUNAR_RADIUS_M)
      }
    }
    if (performance.now() - tick.current > 250) {
      tick.current = performance.now()
      report({
        active: runtime.local,
        lat,
        lon,
        altitudeM: altitude,
        resolutionM: patch?.resolutionM ?? desired.spacingM,
        source: patch?.source ?? desired.source,
        loading: busy.current,
        error: error.current,
      })
    }
  })
  const inspect = (e: ThreeEvent<PointerEvent>) => {
    if (!runtime.inspectionEnabled || runtime.visit) return
    invalidate()
    e.stopPropagation()
    runtime.inspectionDrag = true
    if (runtime.controls) runtime.controls.enabled = false
    runtime.inspectionDirection
      .copy(e.point)
      .add(runtime.origin)
      .sub(runtime.positions.get('Moon')!)
      .applyQuaternion(attitudeAt(moon, clock.current.row).invert())
      .normalize()
  }
  return (
    <>
      <primitive object={lightTarget} />
      <directionalLight
        ref={light}
        intensity={0}
        castShadow
        shadow-autoUpdate={false}
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-camera-near={0.000001}
        shadow-camera-far={1}
        shadow-bias={-0.00001}
        shadow-normalBias={0.000001}
      />
      <group ref={group}>
        {patch && (
          <mesh
            castShadow
            receiveShadow
            geometry={patch.geometry}
            ref={node=>{runtime.terrainMesh=node;if(node)node.userData.spacingM=patch.resolutionM}}
            material={material}
            // Skip only Fiber's automatic pointer ray. Explicit inspection, flag and contact rays still need the DEM.
            raycast={function(this:T.Mesh,ray,hits){ if(!runtime.visit||ray!==pointerRaycaster) T.Mesh.prototype.raycast.call(this,ray,hits) }}
            onPointerDown={inspect}
            onPointerMove={(e) => {
              if (runtime.inspectionDrag && e.buttons) inspect(e)
            }}
          />
        )}
      </group>
      <mesh geometry={warmGeometry} material={material} visible={false} castShadow receiveShadow frustumCulled={false} raycast={() => {}} userData={{ focusIgnore: true, shaderWarmup: true }} />
    </>
  )
}
