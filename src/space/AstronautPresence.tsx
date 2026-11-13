import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import { localFrame,sitePosition } from '../data'
import { viewpointCoordinates } from '../lib/surfaceExplorer'
import type { SurfacePreferences } from '../lib/surfacePolish'
import { attitudeAt,type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'
import { useReducedMotion } from '../useReducedMotion'

export function AstronautPresence({runtime,clock,moon,preferences}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;preferences:SurfacePreferences}){
 const root=useRef<T.Group>(null),left=useRef<T.Group>(null),right=useRef<T.Group>(null),last=useRef({eastM:0,northM:0}),phase=useRef(0),reduced=useReducedMotion()
 useFrame(()=>{const node=root.current,a=runtime.visitAnchor;if(!node)return;node.visible=runtime.visit&&runtime.terrainReady&&preferences.astronautView&&!!a;if(!node.visible||!a)return
  const nominal={lat:Math.asin(a.up.y)*180/Math.PI,lonEast:Math.atan2(-a.up.z,a.up.x)*180/Math.PI},point=viewpointCoordinates(nominal,runtime.visitOffset),height=runtime.terrainStore?.bestHeight(point.lat,point.lonEast);if(height==null){node.visible=false;return}
  const frame=localFrame(sitePosition(point.lat,point.lonEast)),q=attitudeAt(moon,clock.current.row),basis=new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(...frame.east),new T.Vector3(...frame.up),new T.Vector3(...frame.north).negate()))
  node.position.set(...frame.up).multiplyScalar(1+Math.max(height,runtime.astronaut.feetM??height)/LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
  node.quaternion.copy(q).multiply(basis).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),-(runtime.visitLook?.yaw??0)))
  const distance=Math.hypot(runtime.visitOffset.eastM-last.current.eastM,runtime.visitOffset.northM-last.current.northM);last.current={...runtime.visitOffset};phase.current+=Math.min(.15,distance)*Math.PI*2/.9
  const move=preferences.motion&&!reduced&&!runtime.astronaut.airborne&&distance>1e-6?Math.sin(phase.current)*.09:0
  if(left.current)left.current.position.z=-.12+move;if(right.current)right.current.position.z=-.12-move
 })
 // First-person suit overlay avoids metre-scale depth loss in the solar-system log buffer.
 // Opaque alpha in the transparent queue gives the separate suit pieces back-to-front ordering.
 return <group ref={root} scale={1/LUNAR_RADIUS_M} visible={false}>
  {[-1,1].map(side=><group key={side} ref={side===-1?left:right} position={[side*.16,0,-.12]}>
   {/* Suit leg rounded at the thigh: looking down shows a soft limb, never a flat cut end. */}
   <mesh renderOrder={1000} frustumCulled={false} castShadow position={[0,.42,.1]}><capsuleGeometry args={[.095,.5,6,16]}/><meshStandardMaterial transparent opacity={1} depthTest={false} depthWrite={false} color="#dcdcd4" roughness={.92}/></mesh>
   <mesh renderOrder={1000} frustumCulled={false} castShadow position={[0,.12,-.07]}><boxGeometry args={[.22,.21,.36]}/><meshStandardMaterial transparent opacity={1} depthTest={false} depthWrite={false} color="#c4c3ba" roughness={.95}/></mesh>
   <mesh renderOrder={1000} frustumCulled={false} position={[0,.13,-.25]} rotation={[Math.PI/2,0,0]} scale={[1,1,.85]}><cylinderGeometry args={[.11,.11,.06,16,1,false,-Math.PI/2,Math.PI]}/><meshStandardMaterial transparent opacity={1} depthTest={false} depthWrite={false} color="#c4c3ba" roughness={.95}/></mesh>
   <mesh renderOrder={1000} frustumCulled={false} castShadow position={[0,.025,-.075]}><boxGeometry args={[.235,.05,.39]}/><meshStandardMaterial transparent opacity={1} depthTest={false} depthWrite={false} color="#4a4e4a" roughness={1}/></mesh>
   {Array.from({length:4},(_,i)=><mesh renderOrder={1000} frustumCulled={false} key={i} position={[0,.225,-.18+i*.058]}><boxGeometry args={[.19,.014,.012]}/><meshStandardMaterial transparent opacity={1} depthTest={false} depthWrite={false} color="#6a736e" roughness={.9}/></mesh>)}
  </group>)}
 </group>
}



