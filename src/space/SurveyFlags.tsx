import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import { sitePosition } from '../data'
import type { FieldReading } from '../lib/fieldwork'
import { attitudeAt,type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'

/** Visitor annotations, not previously landed hardware. Eight simple flags at most. */
function SurveyFlag({reading,runtime,clock,moon}:{reading:FieldReading;runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData}){
 const root=useRef<T.Group>(null)
 useFrame(()=>{
  const node=root.current;if(!node)return
  node.visible=runtime.visit&&runtime.terrainReady
  if(!node.visible)return
  const up=new T.Vector3(...sitePosition(reading.lat,reading.lonEast)),q=attitudeAt(moon,clock.current.row)
  node.position.copy(up).multiplyScalar(1+(reading.elevationM+.03)/LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
  node.quaternion.copy(q).multiply(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),up))
 })
 return <group ref={root} scale={1/LUNAR_RADIUS_M} visible={false}>
  <mesh position={[0,.65,0]}><cylinderGeometry args={[.012,.012,1.3,5]}/><meshBasicMaterial color="#c5ccd0"/></mesh>
  <mesh position={[.23,1.12,0]}><planeGeometry args={[.46,.28]}/><meshBasicMaterial color="#dbb963" side={T.DoubleSide}/></mesh>
 </group>
}
export function SurveyFlags(p:{readings:FieldReading[];runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData}){
 return <>{p.readings.map(reading=><SurveyFlag key={reading.id} reading={reading} runtime={p.runtime} clock={p.clock} moon={p.moon}/>)}</>
}
