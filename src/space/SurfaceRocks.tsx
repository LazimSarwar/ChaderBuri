import { useMemo,useRef,useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { viewpointCoordinates } from '../lib/surfaceExplorer'
import { OUTPOST_POSITION } from '../lib/surfaceMission'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { useSurfaceFrame } from './useSurfaceFrame'
import { BURI_POSITION } from './BuriFigure'

/** Instance budget per rock form: chipped blocks, weathered rounded stones, flat slabs. */
const LIMITS=[300,200,70] as const,NEAR_M=2,FAR_M=130

/** Stable pseudo-random generator so every visit shows the same stones. */
function generator(seed:number){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296}}
/** Smooth 3D value noise for rock surfaces (deterministic). */
function noise3(x:number,y:number,z:number,seed:number){
 const h=(i:number,j:number,k:number)=>{const s=Math.sin(i*127.1+j*311.7+k*74.7+seed*13.3)*43758.5453;return s-Math.floor(s)}
 const xi=Math.floor(x),yi=Math.floor(y),zi=Math.floor(z),xf=x-xi,yf=y-yi,zf=z-zi,u=xf*xf*(3-2*xf),v=yf*yf*(3-2*yf),w=zf*zf*(3-2*zf)
 const l=(a:number,b:number,t:number)=>a+(b-a)*t
 return l(l(l(h(xi,yi,zi),h(xi+1,yi,zi),u),l(h(xi,yi+1,zi),h(xi+1,yi+1,zi),u),v),l(l(h(xi,yi,zi+1),h(xi+1,yi,zi+1),u),l(h(xi,yi+1,zi+1),h(xi+1,yi+1,zi+1),u),v),w)
}
/**
 * A natural rock: a noisy sphere chipped by random fracture planes (flat faces, sharp edges), with a flattened
 * underside. A per-vertex occlusion tone darkens recesses and the buried base, so every instance reads as solid.
 */
function rockGeometry(seed:number,{detail,cuts,lumpy,squash}:{detail:number;cuts:number;lumpy:number;squash:number}){
 const base=new T.IcosahedronGeometry(1,detail);base.deleteAttribute('normal');base.deleteAttribute('uv')
 const g=mergeVertices(base);base.dispose()
 const p=g.getAttribute('position') as T.BufferAttribute,rand=generator(seed),planes=Array.from({length:cuts},()=>{const n=new T.Vector3(rand()*2-1,(rand()*2-1)*.8,rand()*2-1).normalize();return {n,d:.62+rand()*.3}})
 const v=new T.Vector3(),radii:number[]=[]
 for(let i=0;i<p.count;i++){
  v.fromBufferAttribute(p,i)
  const r=1+lumpy*((noise3(v.x*1.6,v.y*1.6,v.z*1.6,seed)-.5)*1.2+(noise3(v.x*4.1,v.y*4.1,v.z*4.1,seed+3)-.5)*.45)
  v.multiplyScalar(r)
  // Fracture planes: anything beyond a plane is pushed back onto it, leaving a flat broken face.
  for(const plane of planes){const over=v.dot(plane.n)-plane.d;if(over>0)v.addScaledVector(plane.n,-over)}
  if(v.y<-.3)v.y=-.3+(v.y+.3)*.35
  v.y*=squash
  p.setXYZ(i,v.x,v.y,v.z);radii.push(v.length())
 }
 g.computeVertexNormals()
 const mean=radii.reduce((a,b)=>a+b,0)/radii.length,colour=new Float32Array(p.count*3)
 for(let i=0;i<p.count;i++){
  const y=p.getY(i),hollow=Math.max(0,mean-radii[i])*1.4,speck=(noise3(p.getX(i)*9,y*9,p.getZ(i)*9,seed+7)-.5)*.16
  const tone=Math.max(.45,Math.min(1.1,1-hollow-(y<0?.25*Math.min(1,-y/.3/squash):0)+speck))
  colour.set([tone,tone,tone],i*3)
 }
 g.setAttribute('color',new T.BufferAttribute(colour,3))
 g.computeBoundingSphere()
 return g
}

/**
 * Bounded illustrative dressing. No rock is used for slope, safety or science claims; terrain height stays the DEM.
 * Distribution: a steep size law (many pebbles, few blocks), a sparse background field, and a few ejecta clusters
 * around small fresh craters. Partly buried; same regolith tones as the soil shader; cast and receive sunlight shadows.
 * Each stone sits in a soft contact shade (illustrative ambient occlusion). Stones near the visitor use the detailed
 * mesh, farther ones a lighter version of the same shape (re-sorted every few metres walked); the render quality
 * draws a stable share of the stones (larger blocks always stay).
 */
export function SurfaceRocks({runtime,clock,moon,share=1}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;
 /** Share of the stones drawn (render quality); positions never change. */
 share?:number}){
 const root=useSurfaceFrame(runtime,clock,moon),meshes=useRef<(T.InstancedMesh|null)[]>([null,null,null,null,null,null]),shades=useRef<T.InstancedMesh|null>(null),anchorKey=useRef(''),sorted=useRef({eastM:NaN,northM:NaN,share:-1})
 const stones=useRef<{kind:number;matrix:T.Matrix4;colour:T.Color;eastM:number;northM:number;size:number;keep:number;shade:T.Matrix4}[]>([])
 const geometries=useMemo(()=>{const forms=[{seed:17,cuts:9,lumpy:.22,squash:.85,detail:3},{seed:41,cuts:3,lumpy:.16,squash:.8,detail:3},{seed:73,cuts:7,lumpy:.14,squash:.45,detail:2}];return [...forms.map(f=>rockGeometry(f.seed,f)),...forms.map(f=>rockGeometry(f.seed,{...f,detail:1}))]},[])
 const material=useMemo(()=>new T.MeshStandardMaterial({vertexColors:true,roughness:.96,metalness:0}),[])
 const shade=useMemo(()=>{const size=64,bytes=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const d=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2));bytes.set([0,0,0,Math.max(0,Math.min(1,(1-d)/.55))**2*80],(y*size+x)*4)}const t=new T.DataTexture(bytes,size,size);t.needsUpdate=true;return {texture:t,geometry:new T.PlaneGeometry(1,1).rotateX(-Math.PI/2),material:new T.MeshBasicMaterial({map:t,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,toneMapped:false})}},[])
 useEffect(()=>()=>{for(const g of geometries)g.dispose();material.dispose();shade.texture.dispose();shade.geometry.dispose();shade.material.dispose()},[geometries,material,shade])
 useFrame(()=>{
  const a=runtime.visitAnchor,m=meshes.current;if(!a||m.some(x=>!x)||!shades.current||!runtime.visit||!runtime.terrainReady)return
  const origin={lat:Math.asin(a.up.y)*180/Math.PI,lonEast:Math.atan2(-a.up.z,a.up.x)*180/Math.PI},base=runtime.terrainStore?.bestHeight(origin.lat,origin.lonEast)
  if(base==null)return
  const key=`${origin.lat}/${origin.lonEast}/${base}`
  if(anchorKey.current!==key){
   anchorKey.current=key;sorted.current.share=-1
   const rand=generator(31791),object=new T.Object3D(),counts=[0,0,0],list:typeof stones.current=[]
   const clear=(eastM:number,northM:number)=>{const r=Math.hypot(eastM,northM);return r>=NEAR_M&&r<=FAR_M&&Math.hypot(eastM-OUTPOST_POSITION.eastM,northM-OUTPOST_POSITION.northM)>=3.6&&Math.hypot(eastM-BURI_POSITION.eastM,northM-BURI_POSITION.northM)>=1.3}
   const place=(eastM:number,northM:number,size:number,kind:number)=>{
    if(!clear(eastM,northM)||counts[kind]>=LIMITS[kind])return
    const point=viewpointCoordinates(origin,{eastM,northM}),h=runtime.terrainStore?.bestHeight(point.lat,point.lonEast);if(h==null)return
    const height=size*(kind===2?.5:.75+rand()*.35),buried=.22+rand()*.3
    // Bury by a share of the height plus a couple of centimetres, so DEM interpolation never leaves a stone floating.
    object.position.set(eastM,h-base-height*buried*.85-.015,-northM)
    object.rotation.set((rand()-.5)*.35,rand()*Math.PI*2,(rand()-.5)*.35)
    object.scale.set(size*(.8+rand()*.5),height,size*(.7+rand()*.5));object.updateMatrix()
    // Regolith-matched tones (linear): mostly soil grey, fresher blocks a little brighter, a slight warm/cool lean.
    const grey=.19+rand()*.09+(size>.25?.05*rand():0),warm=(rand()-.45)*.014
    const footprint=Math.max(object.scale.x,object.scale.z)*1.5,shadeMatrix=new T.Matrix4().compose(new T.Vector3(eastM,h-base+.012,-northM),new T.Quaternion().setFromEuler(new T.Euler(0,object.rotation.y,0)),new T.Vector3(footprint,1,footprint*.85))
    list.push({kind,matrix:object.matrix.clone(),colour:new T.Color().setRGB(grey+warm,grey,grey-warm*.9),eastM,northM,size,keep:size>.3?0:rand(),shade:shadeMatrix});counts[kind]++
   }
   const sizeLaw=(min:number,max:number,steep:number)=>min+(max-min)*Math.pow(rand(),steep)
   const kindFor=()=>{const r=rand();return r<.55?0:r<.85?1:2}
   // Ejecta clusters around a few small craters, then the background field.
   for(let c=0;c<9;c++){
    const angle=rand()*Math.PI*2,range=7+rand()*(FAR_M*.6),ce=Math.sin(angle)*range,cn=Math.cos(angle)*range,spread=1.2+rand()*3,n=10+Math.floor(rand()*16)
    for(let i=0;i<n;i++){const t=rand()*Math.PI*2,r=spread*(.55+Math.sqrt(rand())*.9);place(ce+Math.sin(t)*r,cn+Math.cos(t)*r,sizeLaw(.04,.45,3),kindFor())}
   }
   for(let i=0;i<2400&&counts.some((n,k)=>n<LIMITS[k]);i++){
    // Area-uniform out to FAR_M, but only stones big enough to read at that range are kept far away.
    const angle=rand()*Math.PI*2,range=NEAR_M+Math.sqrt(rand())*(FAR_M-NEAR_M),size=sizeLaw(.025,.7,5.2)
    if(size<range*.0035)continue
    place(Math.sin(angle)*range,Math.cos(angle)*range,size,kindFor())
   }
   stones.current=list
  }
  // Level of detail and quality share: re-sort when the visitor has walked a few metres or the share changed.
  const at=runtime.visitOffset,s=sorted.current
  if(s.share===share&&Math.hypot(at.eastM-s.eastM,at.northM-s.northM)<3)return
  // Only a new set of stones needs the static shadow map redrawn; a detail swap casts the same shadow.
  const redrawShadows=s.share!==share
  sorted.current={eastM:at.eastM,northM:at.northM,share}
  const counts=[0,0,0,0,0,0];let shaded=0
  for(const stone of stones.current){
   if(stone.keep>=share)continue
   const d=Math.hypot(stone.eastM-at.eastM,stone.northM-at.northM),slot=stone.kind+(d>14+stone.size*20?3:0),mesh=m[slot]!
   mesh.setMatrixAt(counts[slot],stone.matrix);mesh.setColorAt(counts[slot],stone.colour);counts[slot]++
   if(stone.size>.06&&d<16+stone.size*30)shades.current.setMatrixAt(shaded++,stone.shade)
  }
  m.forEach((mesh,k)=>{mesh!.count=counts[k];mesh!.instanceMatrix.needsUpdate=true;if(mesh!.instanceColor)mesh!.instanceColor.needsUpdate=true;mesh!.computeBoundingSphere()})
  shades.current.count=shaded;shades.current.instanceMatrix.needsUpdate=true
  if(redrawShadows)runtime.shadowDirty=true
 })
 const total=LIMITS[0]+LIMITS[1]+LIMITS[2]
 return <group ref={root} scale={1/LUNAR_RADIUS_M} visible={false} userData={{decorative:true,focusIgnore:true}}>
  {geometries.map((g,k)=><instancedMesh key={k} ref={node=>{meshes.current[k]=node;if(node&&!anchorKey.current)node.count=0}} args={[g,material,LIMITS[k%3]]} castShadow receiveShadow frustumCulled={false} userData={{decorative:true,focusIgnore:true}}/>)}
  <instancedMesh ref={node=>{shades.current=node;if(node){node.raycast=()=>{};if(!anchorKey.current)node.count=0}}} args={[shade.geometry,shade.material,total]} renderOrder={1} frustumCulled={false} userData={{focusIgnore:true}}/>
 </group>
}
