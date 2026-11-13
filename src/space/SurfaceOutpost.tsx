import { useMemo,useEffect,useRef,useState } from 'react'
import { useFrame,useThree,type ThreeEvent } from '@react-three/fiber'
import * as T from 'three'
import type { Mission,Site } from '../data'
import { surfaceMission,surfaceProfile,OUTPOST_POSITION,type SurfaceObject } from '../lib/surfaceMission'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { useSurfaceFrame } from './useSurfaceFrame'
import { ContactShade,useGroundContacts } from './SurfaceContact'
import type { GroundContact } from './groundContactMath'
import { hardwareMaterials,landerBody,lightHardware } from './hardware'
import { radialTexture } from './surfaceTextures'

const UP=new T.Vector3(0,1,0),RAD=Math.PI/180
/** Stretch a unit-height cylinder between two points. */
function place(mesh:T.Mesh|null,a:T.Vector3,b:T.Vector3){if(!mesh)return;const d=b.clone().sub(a),length=d.length();mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(UP,length>1e-6?d.divideScalar(length):UP);mesh.scale.set(1,Math.max(1e-4,length),1)}
/** Footpad: a shallow turned dish. */
const footpad=(()=>{let g:T.LatheGeometry|null=null;return ()=>g??=new T.LatheGeometry([[0,0],[.3,0],[.36,.03],[.37,.07],[.33,.09],[.08,.1],[0,.1]].map(([x,y])=>new T.Vector2(x,y)),28)})()

/** One landing leg. Fixed descent stance until contact, then a smooth blend onto the measured DEM facet. */
function Leg({foot:[x,z],height,contact,runtime}:{foot:readonly [number,number];height:number;contact:GroundContact|null|undefined;runtime:Runtime}){
 const upper=useRef<T.Mesh>(null),sleeve=useRef<T.Mesh>(null),lower=useRef<T.Mesh>(null),pad=useRef<T.Mesh>(null),m=hardwareMaterials(),last=useRef<{stance:number;contact:GroundContact|null|undefined}>({stance:-1,contact:undefined})
 useFrame(()=>{
  const stance=contact?runtime.lander.legStance:0
  if(last.current.stance===stance&&last.current.contact===contact)return
  last.current={stance,contact}
  const free=new T.Vector3(x,0,z),p=contact?free.clone().lerp(new T.Vector3(...contact.position),stance):free
  const n=contact?UP.clone().lerp(new T.Vector3(...contact.normal),stance).normalize():UP.clone(),end=p.clone().addScaledVector(n,.14)
  const top=new T.Vector3(x/1.85*.7,height*.58,z/1.85*.7)
  place(upper.current,top,end);place(sleeve.current,top,top.clone().lerp(end,.48))
  place(lower.current,new T.Vector3(x/1.85*.75,.7,z/1.85*.75),end)
  if(pad.current){pad.current.position.copy(p).addScaledVector(n,.005);pad.current.quaternion.setFromUnitVectors(UP,n)}
 })
 return <group>
  <mesh ref={upper} castShadow material={m.metal}><cylinderGeometry args={[.032,.032,1,12]}/></mesh>
  <mesh ref={sleeve} castShadow material={m.gold}><cylinderGeometry args={[.055,.055,1,12]}/></mesh>
  <mesh ref={lower} castShadow material={m.metal}><cylinderGeometry args={[.022,.022,1,10]}/></mesh>
  <mesh ref={pad} castShadow receiveShadow geometry={footpad()} material={m.pad}/>
 </group>
}
const glowTexture=()=>radialTexture([[0,'rgba(255,244,220,1)'],[.18,'rgba(255,214,150,.65)'],[.5,'rgba(255,170,90,.18)'],[1,'rgba(255,150,80,0)']])
const STATUS_COLOR={ok:'#3ddc97',warn:'#f0b45a',fail:'#ff5d78',none:'#8a9aa3'}

/**
 * Deliberately simplified exhibit, never a reconstruction of a vehicle's present condition.
 * The same object flies the time-compressed landing simulation: the outer group is the pad
 * frame on measured ground; the inner vehicle follows `runtime.lander`, which is at the pad
 * with no offset once landed, so there is no swap and no jump at touchdown.
 */
export function SurfaceOutpost({runtime,clock,moon,site,missions,onSelect,status='none'}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;site:Site;missions:Mission[];onSelect?:(object:SurfaceObject,payloadIndex?:number)=>void;status?:'ok'|'warn'|'fail'|'none'}){
 const root=useSurfaceFrame(runtime,clock,moon,OUTPOST_POSITION.eastM,OUTPOST_POSITION.northM),mission=surfaceMission(site,missions),profile=surfaceProfile(mission),nova=profile==='nova',concept=profile==='concept',height=nova?3.3:2.25
 const feet=useMemo(()=>Array.from({length:nova?6:4},(_,i)=>{const a=i*Math.PI*2/(nova?6:4)+Math.PI/4;return [Math.cos(a)*1.85,Math.sin(a)*1.85] as const}),[nova]),contacts=useGroundContacts(runtime,root,feet)
 const {scene,invalidate,camera}=useThree(),fill=useRef<T.AmbientLight>(null),lamp=useRef<T.DirectionalLight>(null),lampTarget=useMemo(()=>new T.Object3D(),[]),wasVisible=useRef(false)
 const vehicle=useRef<T.Group>(null),plume=useRef<T.Group>(null),cone=useRef<T.Mesh>(null),flare=useRef<T.Sprite>(null),groundGlow=useRef<T.Mesh>(null),[grounded,setGrounded]=useState(true)
 useEffect(()=>{scene.traverse(o=>{if(o instanceof T.DirectionalLight&&o.castShadow)o.shadow.needsUpdate=true});invalidate()},[contacts,scene,invalidate])
 const body=useMemo(()=>landerBody(height,concept||!nova?8:6),[height,nova,concept]),materials=hardwareMaterials(),sun=useMemo(()=>new T.Vector3(),[]),up=useMemo(()=>new T.Vector3(),[])
 const glow=useMemo(glowTexture,[])
 useEffect(()=>()=>{glow.dispose()},[glow])
 useEffect(()=>()=>{for(const [,g] of body.geometries)g.dispose()},[body])
 useFrame(()=>{
  if(fill.current)fill.current.intensity=runtime.visit?(runtime.inspectionEnabled?.25:.1):0;if(lamp.current){lamp.current.intensity=runtime.visit&&runtime.inspectionEnabled?2.2:0;lamp.current.position.copy(camera.position).add(new T.Vector3(-2,3,1).applyQuaternion(camera.quaternion).divideScalar(LUNAR_RADIUS_M));if(root.current)lampTarget.position.copy(root.current.position);lamp.current.target=lampTarget}
  if(root.current?.visible&&!wasVisible.current){scene.traverse(o=>{if(o instanceof T.DirectionalLight&&o.castShadow)o.shadow.needsUpdate=true});invalidate()}wasVisible.current=!!root.current?.visible
  // Regolith bounce on the hardware: surround under the pad's local up, scaled by the measured Sun elevation.
  const sunPosition=runtime.positions.get('Sun'),moonPosition=runtime.positions.get('Moon')
  if(root.current?.visible&&sunPosition&&moonPosition)lightHardware(up.set(0,1,0).applyQuaternion(root.current.quaternion),sun.copy(sunPosition).sub(moonPosition))
  // Canonical lander transform, relative to the pad.
  const L=runtime.lander,v=vehicle.current
  if(v){
   v.position.set(L.eastM-OUTPOST_POSITION.eastM,L.altM,-(L.northM-OUTPOST_POSITION.northM))
   if(L.pitchDeg>.01){const h=L.headingDeg*RAD,travel=new T.Vector3(Math.sin(h),0,-Math.cos(h));v.quaternion.setFromAxisAngle(UP.clone().cross(travel.negate()).normalize(),L.pitchDeg*RAD)}else v.quaternion.identity()
  }
  const burning=L.plume>.01,flicker=.88+Math.sin(performance.now()*.047)*.07+Math.sin(performance.now()*.113)*.05
  if(plume.current)plume.current.visible=burning
  if(burning&&cone.current&&flare.current){
   // Lunar descent-engine plumes are faint in vacuum: a pale cone and a hot nozzle glow.
   const length=2.2+L.plume*3.2;cone.current.scale.set(1,length,1);cone.current.position.y=-length/2;(cone.current.material as T.MeshBasicMaterial).opacity=.16*L.plume*flicker
   flare.current.scale.setScalar(1.6+L.plume*1.4*flicker);(flare.current.material as T.SpriteMaterial).opacity=Math.min(1,.55+L.plume*.45)*flicker
  }
  if(groundGlow.current){const g=burning?L.plume*Math.max(0,1-L.altM/18)*.32*flicker:0;groundGlow.current.visible=g>.005;(groundGlow.current.material as T.MeshBasicMaterial).opacity=g}
  const nowGrounded=L.legStance>=.99;if(nowGrounded!==grounded)setGrounded(nowGrounded)
 })
 const click=(object:SurfaceObject,index?:number)=>(e:ThreeEvent<MouseEvent>)=>{if(runtime.dragged||e.delta>3)return;e.stopPropagation();onSelect?.(object,index)}
 const payloads=mission?.payloads?.slice(0,3)??[{name:'Solar survey'},{name:'Earth visibility'}]
 return <><ambientLight ref={fill} intensity={0}/><primitive object={lampTarget}/><directionalLight ref={lamp} intensity={0}/><group ref={root} scale={1/LUNAR_RADIUS_M} visible={false} userData={{surfaceRoot:true}}>
  <mesh ref={groundGlow} position={[0,.04,0]} rotation={[-Math.PI/2,0,0]} visible={false} userData={{focusIgnore:true}}><circleGeometry args={[7,32]}/><meshBasicMaterial map={glow} color="#ffcf9a" transparent opacity={0} blending={T.AdditiveBlending} depthWrite={false}/></mesh>
  <group ref={vehicle}>
   <group onClick={click('lander')} userData={{surfaceObject:'lander'}}>
    {body.geometries.map(([key,geometry])=><mesh key={key} geometry={geometry} material={materials[key]} castShadow receiveShadow/>)}
    {feet.map((foot,i)=><Leg key={i} foot={foot} height={height} contact={contacts[i]} runtime={runtime}/>)}
    {/* Beacon mast with the mission status light. */}
    <mesh position={[.35,body.top+.4+.5,0]} castShadow material={materials.metal}><cylinderGeometry args={[.016,.02,1.0,8]}/></mesh>
    <mesh position={[.35,height+1,0]} rotation={[Math.PI/2,0,0]} material={materials.metal}><torusGeometry args={[.1,.012,6,20]}/></mesh>
    <mesh position={[.35,height+1.18,0]} userData={{focusIgnore:true}}><sphereGeometry args={[.045,10,8]}/><meshBasicMaterial color={STATUS_COLOR[status]} toneMapped={false}/></mesh>
   </group>
   {payloads.map((_,i)=><group key={i} position={[-.65+i*.65,body.top+.22,.65]} userData={{surfaceObject:'payload',payloadIndex:i}} onClick={click('payload',i)}><mesh castShadow material={materials.white}><boxGeometry args={[.28,.32,.3]}/></mesh><mesh position={[0,.165,0]} material={materials.silver}><boxGeometry args={[.3,.02,.32]}/></mesh><mesh position={[0,.02,.16]} rotation={[Math.PI/2,0,0]} material={materials.dark}><cylinderGeometry args={[.075,.075,.04,16]}/></mesh><mesh position={[0,.02,.181]} rotation={[Math.PI/2,0,0]}><circleGeometry args={[.06,16]}/><meshStandardMaterial color="#0c1218" metalness={.2} roughness={.08}/></mesh></group>)}
   <group ref={plume} position={[0,.21,0]} visible={false} userData={{focusIgnore:true}}>
    <mesh ref={cone}><cylinderGeometry args={[.95,.22,1,20,1,true]}/><meshBasicMaterial color="#ffe2b8" transparent opacity={0} blending={T.AdditiveBlending} depthWrite={false} side={T.DoubleSide} toneMapped={false}/></mesh>
    <sprite ref={flare} position={[0,-.15,0]}><spriteMaterial map={glow} transparent blending={T.AdditiveBlending} depthWrite={false} toneMapped={false}/></sprite>
   </group>
  </group>
  {grounded&&contacts.map((contact,i)=>contact&&<ContactShade key={i} contact={contact} radius={.52}/>)}
 </group></>
}
