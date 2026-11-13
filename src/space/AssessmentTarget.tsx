import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as T from 'three'
import { attitudeAt,type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'

/** A navigation annotation at the fixed analysis coordinate, not landed hardware. */
export function AssessmentTarget({runtime,clock,moon}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData}){
 const root=useRef<T.Group>(null)
 useFrame(()=>{
  const node=root.current,a=runtime.visitAnchor;if(!node)return
  node.visible=runtime.visit&&runtime.terrainReady&&!!a;if(!node.visible||!a)return
  const lat=Math.asin(a.up.y)*180/Math.PI,lon=Math.atan2(-a.up.z,a.up.x)*180/Math.PI,h=runtime.terrainStore?.bestHeight(lat,lon)
  if(h==null){node.visible=false;return}
  const q=attitudeAt(moon,clock.current.row)
  node.position.copy(a.up).multiplyScalar(1+(h+.06)/LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
  node.quaternion.copy(q).multiply(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),a.up))
 })
 return <group ref={root} visible={false} scale={1/LUNAR_RADIUS_M}>
  <mesh rotation={[-Math.PI/2,0,0]}><ringGeometry args={[.5,.54,32]}/><meshBasicMaterial color="#9ecbd5" side={T.DoubleSide} transparent opacity={.85} depthWrite={false}/></mesh>
  <mesh position={[0,.55,0]}><cylinderGeometry args={[.01,.01,1.1,5]}/><meshBasicMaterial color="#a4cbd6"/></mesh>
  <mesh position={[0,1.1,0]}><octahedronGeometry args={[.09,0]}/><meshBasicMaterial color="#a4cbd6" wireframe/></mesh>
  <Html position={[0,1.4,0]} center wrapperClass="scene-label-anchor" style={{pointerEvents:'none'}}><span className="visit-scale-label">Assessment target · fixed coordinate</span></Html>
 </group>
}
