import { useEffect,useMemo,useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import { mergeGeometries,mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { motionDelta } from '../lib/astronautMotion'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime } from './SpaceScene'
import { useReducedMotion } from '../useReducedMotion'
import { FABRIC_TILE_M,fabricNormalTexture,gloveNormalTexture,lunarSurround,lunarSurroundTexture } from './surfaceTextures'
import { indexExactGeometry } from './exactGeometry'

/**
 * The visitor's own pressure-suit gloves and sleeves at the bottom corners of the view.
 *
 * Presentation only: they are anchored to the camera, never touch terrain, rocks or any measured value,
 * are skipped by surface focus (userData.focusIgnore) and neither cast nor receive shadows. They are lit by
 * the scene's Sun direction, plus a dim regolith surround scaled by the measured Sun elevation (bounce light).
 * Photos keep them, since a photo is the visitor's own view.
 *
 * Drawing: every glove part is in the transparent queue at renderOrder >= 1000 (opaque alpha), after a
 * zero-size marker that clears the depth buffer, so terrain can never clip them. The solar-system log depth
 * buffer cannot separate centimetre parts half a metre from the eye, so the whole rig is drawn enlarged
 * by DEPTH_SCALE at the same angular size; the parts then depth-sort correctly against each other.
 * Three draw calls per hand: white suit fabric, grey rubberised glove, metal wrist disconnect.
 */

// Hand model in metres, right hand, wrist at the origin: fingers along -z, back of the hand +y, thumb on -x.
type Part={geometry:T.BufferGeometry;matrix:T.Matrix4}
const deg=Math.PI/180
/** Scale a part's UVs so the fabric tile keeps one real size (FABRIC_TILE_M) across parts. */
function tile(g:T.BufferGeometry,su:number,sv:number,ov=0){const uv=g.getAttribute('uv') as T.BufferAttribute;for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*su,uv.getY(i)*sv+ov);return g}
/** A lathe (turned) shell along +z from z0, radius from a profile function; elliptical cross-section. */
function shell(z0:number,length:number,radius:(t:number)=>number,steps:number,sx=1,sy=1,around=28){
 const points=Array.from({length:steps+1},(_,i)=>{const t=i/steps;return new T.Vector2(radius(t),t*length)})
 const g=new T.LatheGeometry(points,around).rotateX(Math.PI/2).scale(sx,sy,1).translate(0,0,z0)
 const circumference=2*Math.PI*radius(.5)*(sx+sy)/2
 return tile(g,Math.max(1,Math.round(circumference/FABRIC_TILE_M)),length/FABRIC_TILE_M)
}
function bake(parts:Part[]){
 const baked=parts.map(p=>{const g=p.geometry.index?p.geometry.toNonIndexed():p.geometry.clone();for(const name of Object.keys(g.attributes))if(name!=='position'&&name!=='normal'&&name!=='uv')g.deleteAttribute(name);if(!g.getAttribute('uv'))g.setAttribute('uv',new T.BufferAttribute(new Float32Array(g.getAttribute('position').count*2),2));g.applyMatrix4(p.matrix);return g})
 const merged=mergeGeometries(baked,false)!
 for(const g of baked)g.dispose();for(const p of parts)p.geometry.dispose()
 return indexExactGeometry(merged)
}
/** A tapered limb segment along -z from its base: r0 at the base, r1 at the end, oval cross-section (flatter across the back). */
function tapered(r0:number,r1:number,length:number,flat=FLAT){
 const g=new T.CylinderGeometry(r1,r0,length,18,4,true).rotateX(-Math.PI/2).translate(0,0,-length/2).scale(1,flat,1)
 return tile(g,1,length/FABRIC_TILE_M*1.6)
}
/** A small ellipsoid (knuckles, finger tips, the thumb's muscle). */
function blob(rx:number,ry:number,rz:number,segments=18){return tile(new T.SphereGeometry(1,segments,Math.round(segments*.7)).scale(rx,ry,rz),1,.5)}
/**
 * A cushioned superellipsoid for the back of the hand: squarer than an ellipsoid (exponent < 1), narrower toward the
 * wrist and arched across the knuckles. Welded so its normals are smooth; fabric UVs projected from above.
 */
function cushion(rx:number,ry:number,rz:number,exponent:number,taper:number,arch:number){
 const sphere=new T.SphereGeometry(1,36,24);sphere.deleteAttribute('normal');sphere.deleteAttribute('uv')
 const g=mergeVertices(sphere),p=g.getAttribute('position') as T.BufferAttribute;sphere.dispose()
 const f=(v:number)=>Math.sign(v)*Math.abs(v)**exponent
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),width=1-taper*(z*.5+.5)
  p.setXYZ(i,f(x)*rx*width,f(y)*ry+(y>0?arch*(1-x*x):0),f(z)*rz)
 }
 g.computeVertexNormals()
 const uv=new Float32Array(p.count*2);for(let i=0;i<p.count;i++)uv.set([p.getX(i)/FABRIC_TILE_M*1.4,p.getZ(i)/FABRIC_TILE_M*1.4],i*2)
 g.setAttribute('uv',new T.BufferAttribute(uv,2))
 return g
}
/** Soft fabric folds on a turned shell: a gentle radial ripple that drifts around the limb. */
function rumple(g:T.BufferGeometry,z0:number,length:number,amount:number,lobes:number){
 const p=g.getAttribute('position') as T.BufferAttribute
 for(let i=0;i<p.count;i++){
  const x=p.getX(i),y=p.getY(i),z=p.getZ(i),t=Math.max(0,Math.min(1,(z-z0)/length)),a=Math.atan2(y,x)
  const k=1+amount*Math.sin(t*Math.PI)*(Math.sin(a*lobes+t*7)*.6+Math.sin(a*(lobes+3)-t*11)*.4)
  p.setXYZ(i,x*k,y*k,z)
 }
 g.computeVertexNormals();return g
}
const FLAT=.86
/**
 * One finger: fabric phalanges with a slight bunching over each knuckle, then a rubberised grip cap over the
 * distal segment and tip (the dark grip of an EVA glove, seen on the backs and sides of the fingers).
 */
function finger(base:T.Vector3,yaw:number,lengths:number[],radius:number,curl:number[],glove:Part[],rubber:Part[],pitch=0,roll=0){
 let at=base.clone(),bend=pitch
 const taper=[1,.94,.88,.8]
 lengths.forEach((length,i)=>{
  bend+=curl[i]
  const m=new T.Matrix4().makeRotationFromEuler(new T.Euler(-bend,yaw,roll,'YXZ')).setPosition(at),r0=radius*taper[i],r1=radius*taper[i+1]
  glove.push({geometry:blob(r0*1.025,r0*FLAT*1.02,r0*1.03),matrix:m.clone()})
  if(i<lengths.length-1)glove.push({geometry:tapered(r0,r1,length),matrix:m.clone()})
  else{
   const split=length*.3
   glove.push({geometry:tapered(r0,r0*.98,split+.002),matrix:m.clone()})
   rubber.push({geometry:tapered(r0*1.05,r1*1.05,length-split).translate(0,0,-split),matrix:m.clone()})
   rubber.push({geometry:blob(r1*1.05,r1*FLAT*1.05,r1*1.2).translate(0,0,-length),matrix:m.clone()})
  }
  at=new T.Vector3(0,0,-length).applyMatrix4(m)
 })
}
/**
 * Pressure glove after the current EVA pattern: an off-white outer layer (thermal-micrometeoroid fabric) over a
 * flat, cushioned back of the hand and full fingers in a relaxed, slightly spread rest; dark rubber grip on the
 * finger tips, palm and knuckle bar; a wrinkled gauntlet with a strap, the coloured wrist-disconnect bearing,
 * then the white suit sleeve with convolute folds. Proportions follow a large gloved hand (about 9 cm wide).
 */
function buildGlove(){
 const suit:Part[]=[],glove:Part[]=[],rubber:Part[]=[],metal:Part[]=[],accent:Part[]=[]
 const at=(x:number,y:number,z:number,euler?:T.Euler)=>{const m=new T.Matrix4();if(euler)m.makeRotationFromEuler(euler);return m.setPosition(x,y,z)}
 // Hand: the cushioned back, a raised stitched back panel, a rubber palm and the knuckle restraint bar.
 glove.push({geometry:cushion(.045,.0145,.05,.62,.16,.0035),matrix:at(0,0,-.058)})
 glove.push({geometry:cushion(.035,.0042,.036,.5,.1,.0022),matrix:at(.002,.0128,-.062)})
 rubber.push({geometry:cushion(.041,.006,.043,.6,.12,0),matrix:at(0,-.0112,-.062)})
 rubber.push({geometry:new T.CapsuleGeometry(.0078,.066,4,14).rotateZ(Math.PI/2).scale(1,.75,1),matrix:at(.001,.0118,-.1)})
 // Four fingers resting nearly straight with a soft curl and a little spread (index toward the thumb).
 const spec:[number,number,number[],number,number[]][]=[
  [-.0315,3*deg,[.038,.024,.02],.0104,[14*deg,19*deg,12*deg]],
  [-.0105,.5*deg,[.042,.026,.021],.0107,[16*deg,21*deg,13*deg]],
  [.0105,-1.5*deg,[.039,.025,.02],.0103,[18*deg,23*deg,14*deg]],
  [.0305,-4.5*deg,[.031,.02,.017],.0093,[21*deg,25*deg,16*deg]],
 ]
 for(const [x,yaw,lengths,radius,curl] of spec)finger(new T.Vector3(x,.002,-.104),yaw,lengths,radius,curl,glove,rubber,-2*deg)
 // Thumb: the thenar pad at the inner heel of the hand, then the thumb forward, out and a little under.
 glove.push({geometry:blob(.018,.015,.034,20),matrix:at(-.036,-.002,-.056,new T.Euler(0,26*deg,0))})
 finger(new T.Vector3(-.045,-.001,-.07),30*deg,[.03,.024],.0118,[6*deg,14*deg],glove,rubber,-3*deg,-35*deg)
 // Gauntlet: a flared, softly wrinkled cuff of glove fabric with a rubber strap and its buckle tab.
 glove.push({geometry:rumple(shell(-.012,.088,t=>.049+.016*t+.0035*Math.sin(t*Math.PI),12,1.12,.8,36),-.012,.088,.045,5),matrix:new T.Matrix4()})
 rubber.push({geometry:new T.TorusGeometry(.0598,.0045,8,44).scale(1.12,.8,1),matrix:at(0,0,.034)})
 rubber.push({geometry:new T.BoxGeometry(.024,.009,.018),matrix:at(.006,.049,.034)})
 metal.push({geometry:new T.BoxGeometry(.012,.004,.012),matrix:at(.006,.0545,.034)})
 // Wrist disconnect: anodised bearing ring between two bright lips.
 metal.push({geometry:new T.TorusGeometry(.066,.0066,10,44),matrix:at(0,0,.078)})
 accent.push({geometry:new T.CylinderGeometry(.0712,.0712,.019,44,1,true).rotateX(Math.PI/2),matrix:at(0,0,.088)})
 metal.push({geometry:new T.TorusGeometry(.0698,.005,10,44),matrix:at(0,0,.099)})
 // Suit sleeve leaving the frame, with convolute folds every fabric tile.
 const fold=(t:number)=>{const z=t*.5,k=((z/FABRIC_TILE_M)%1+1)%1;return .07+.026*Math.min(1,z/.18)+.0045*Math.exp(-(((k-.5)/.09)**2))-.002*Math.exp(-(((k-.5)/.03)**2))}
 suit.push({geometry:rumple(shell(.097,.5,fold,80,1.06,.94,32),.097,.5,.018,4),matrix:new T.Matrix4()})
 return {suit:bake(suit),glove:bake(glove),rubber:bake(rubber),metal:bake(metal),accent:bake(accent)}
}

/**
 * Glove materials: drawn in the transparent queue (after the depth clear) but opaque and unblended, front faces only.
 * They skip the logarithmic fragment depth: during the glove pass the camera's near/far bracket the rig (see the
 * clear/restore markers), so ordinary depth is precise and the GPU can reject hidden glove fragments early.
 * Measured on Intel UHD 630 at 1440x900: the double-sided, log-depth version cost about 8 ms a frame.
 */
const material=(color:string,roughness:number,metalness:number,normalMap:T.Texture|null,normalScale:number)=>{
 const m=new T.MeshStandardMaterial({color,roughness,metalness,normalMap,normalScale:new T.Vector2(normalScale,normalScale),envMap:lunarSurroundTexture(),transparent:true,blending:T.NoBlending,opacity:1,depthWrite:true,depthTest:true,side:T.FrontSide})
 m.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <logdepthbuf_fragment>','')}
 m.customProgramCacheKey=()=>'field-glove-linear-depth'
 return m
}
/** Glove-pass depth range, in rig metres from the eye (the rig is drawn DEPTH_SCALE times enlarged). */
const GLOVE_NEAR_M=.1,GLOVE_FAR_M=2,GLOVE_PASS=1e6
/** Pose of the right glove; the left one is its mirror image. Screen anchor in NDC at a fixed angular size. */
const POSE={ndcX:.82,ndcY:-1.12,depthM:.45,pitch:30*deg,yaw:22*deg,roll:34*deg}
const DEPTH_SCALE=25000
const REFERENCE_TAN=Math.tan(30*deg)

export function FieldGloves({runtime,enabled,motionScale=1}:{runtime:Runtime;enabled:boolean;
 /** Strength of idle, walking and turning sway (0..1); reduced motion forces 0. */
 motionScale?:number}){
 const root=useRef<T.Group>(null),hands=useRef<(T.Group|null)[]>([null,null]),reduced=useReducedMotion()
 const model=useMemo(buildGlove,[])
 const weave=useMemo(fabricNormalTexture,[]),wrinkles=useMemo(gloveNormalTexture,[])
 const materials=useMemo(()=>({suit:material('#e9e7e1',.9,0,weave,.8),glove:material('#e7e4dc',.9,0,wrinkles,.75),rubber:material('#4b4c4e',.78,0,wrinkles,.25),metal:material('#c3c7ca',.4,.88,null,0),accent:material('#5d7d99',.38,.7,null,0),clear:new T.MeshBasicMaterial({colorWrite:false,depthWrite:false,depthTest:false,transparent:true})}),[weave,wrinkles])
 // Markers around the glove pass: the first clears depth and narrows the camera's depth range to the rig, the last
 // restores it (both are zero-size and draw nothing visible).
 const saved=useRef<{near:number;far:number}|null>(null)
 const clearer=useMemo(()=>{const m=new T.Mesh(new T.PlaneGeometry(1e-6,1e-6),materials.clear);m.renderOrder=1000;m.frustumCulled=false;m.onBeforeRender=(renderer,_scene,camera)=>{renderer.state.buffers.depth.setMask(true);renderer.clearDepth();const lens=camera as T.PerspectiveCamera;if(!lens.isPerspectiveCamera)return;saved.current={near:lens.near,far:lens.far};const unit=DEPTH_SCALE/LUNAR_RADIUS_M;lens.near=GLOVE_NEAR_M*unit;lens.far=GLOVE_FAR_M*unit;lens.updateProjectionMatrix()};m.userData.focusIgnore=true;return m},[materials])
 const restorer=useMemo(()=>{const m=new T.Mesh(new T.PlaneGeometry(1e-6,1e-6),materials.clear);m.renderOrder=1003;m.frustumCulled=false;m.onBeforeRender=(_renderer,_scene,camera)=>{const lens=camera as T.PerspectiveCamera,s=saved.current;if(!s||!lens.isPerspectiveCamera)return;saved.current=null;lens.near=s.near;lens.far=s.far;lens.updateProjectionMatrix()};m.userData.focusIgnore=true;return m},[materials])
 useEffect(()=>()=>{for(const g of Object.values(model))g.dispose();for(const m of Object.values(materials))m.dispose();weave.dispose();wrinkles.dispose();clearer.geometry.dispose();restorer.geometry.dispose()},[model,materials,weave,wrinkles,clearer,restorer])
 const motion=useRef({walk:0,idle:0,swing:0,turn:0,yaw:NaN,last:{eastM:0,northM:0}}),surround=useMemo(()=>new T.Euler(),[]),sun=useMemo(()=>new T.Vector3(),[])
 const lit=[materials.suit,materials.glove,materials.rubber,materials.metal,materials.accent]
 useEffect(()=>{for(const m of lit)m.envMapRotation=surround},[materials,surround])
 useFrame(({camera,invalidate},delta)=>{
  const node=root.current;if(!node)return
  node.visible=enabled&&runtime.visit&&runtime.terrainReady&&runtime.shadersWarm&&!runtime.landing&&!!runtime.visitAnchor
  if(!node.visible)return
  const lens=camera as T.PerspectiveCamera
  node.position.copy(camera.position);node.quaternion.copy(camera.quaternion);node.scale.setScalar(DEPTH_SCALE/LUNAR_RADIUS_M)
  // Bounce light from the regolith: the surround's ground lies under the visitor's local up (camera.up on a visit).
  const sunPosition=runtime.positions.get('Sun'),moonPosition=runtime.positions.get('Moon')
  if(sunPosition&&moonPosition){const intensity=lunarSurround(surround,camera.up,sun.copy(sunPosition).sub(moonPosition));for(const m of lit)m.envMapIntensity=m.metalness>.5?intensity*1.4:Math.max(.12,intensity)}
  // Constant angular size and screen anchor whatever the lens; narrow screens shrink them so the centre stays clear.
  const tan=Math.tan(lens.fov*deg/2),aspect=lens.aspect||1,size=tan/REFERENCE_TAN*Math.min(1,aspect/1.45)
  const dt=motionDelta(delta),m=motion.current,moved=Math.hypot(runtime.visitOffset.eastM-m.last.eastM,runtime.visitOffset.northM-m.last.northM);m.last={...runtime.visitOffset}
  const walking=moved>1e-6&&moved<1&&!runtime.astronaut.airborne,scale=reduced?0:Math.max(0,Math.min(1,motionScale))
  // Turning: the hands trail the head a little and settle (smoothed yaw rate, rad/s).
  const yaw=runtime.visitLook?.yaw??0,rate=Number.isFinite(m.yaw)&&dt>0?Math.atan2(Math.sin(yaw-m.yaw),Math.cos(yaw-m.yaw))/dt:0;m.yaw=yaw
  m.turn+=(Math.max(-3,Math.min(3,rate))-m.turn)*(1-Math.exp(-dt*8))
  if(!scale){m.swing=0;m.turn=0}
  else{m.walk+=Math.min(.15,walking?moved:0)*Math.PI*2/1.6;m.idle+=dt;m.swing+=((walking?1:0)-m.swing)*(1-Math.exp(-dt*6))}
  hands.current.forEach((hand,i)=>{
   if(!hand)return
   const side=i===0?1:-1,stride=Math.sin(m.walk+(i?Math.PI:0))*m.swing*scale,breathe=Math.sin(m.idle*1.4+i*.9)*scale,lag=m.turn*scale
   // Idle sway advances only on frames the demand loop already draws, so it never keeps the GPU busy.
   hand.position.set(side*POSE.ndcX*POSE.depthM*tan*aspect-lag*.006*size,POSE.ndcY*POSE.depthM*tan+(breathe*.0022+Math.abs(stride)*.006)*size,-POSE.depthM+stride*.018*size)
   hand.rotation.set(POSE.pitch+stride*.05+breathe*.006,side*POSE.yaw+lag*.02,side*POSE.roll,'YXZ')
   hand.scale.set(side*size,size,size)
  })
  // Let the turn lag and the stride settle after input stops (a few frames, then the canvas sleeps again).
  if(Math.abs(m.turn)>.02||(!walking&&m.swing>.02))invalidate()
 })
 const parts=(<>
  {/* Nearest parts first, so the sleeve behind them is rejected by depth. */}
  <mesh geometry={model.glove} material={materials.glove} renderOrder={1001} frustumCulled={false}/>
  <mesh geometry={model.rubber} material={materials.rubber} renderOrder={1001} frustumCulled={false}/>
  <mesh geometry={model.metal} material={materials.metal} renderOrder={1001} frustumCulled={false}/>
  <mesh geometry={model.accent} material={materials.accent} renderOrder={1001} frustumCulled={false}/>
  <mesh geometry={model.suit} material={materials.suit} renderOrder={1002} frustumCulled={false}/>
 </>)
 // Group render order is the primary transparent sort key in three.js, so the whole glove pass (clear, gloves, restore)
 // sorts after every other object, whatever renderOrder or group order those use; nested groups carry it too.
 return <group ref={root} visible={false} renderOrder={GLOVE_PASS} userData={{focusIgnore:true,decorative:true,fieldGloves:true}}>
  <primitive object={clearer}/>
  <primitive object={restorer}/>
  <group ref={node=>{hands.current[0]=node}} renderOrder={GLOVE_PASS}>{parts}</group>
  <group ref={node=>{hands.current[1]=node}} renderOrder={GLOVE_PASS}>{parts}</group>
 </group>
}
