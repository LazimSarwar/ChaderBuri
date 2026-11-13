import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as T from 'three'
import { localFrame,sitePosition } from '../data'
import { viewpointCoordinates } from '../lib/surfaceExplorer'
import { attitudeAt, type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'

/** Optional two-metre ruler, twenty metres from the observer. No downloaded model. */
export function VisitScale({runtime,clock,moon,bearing}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;bearing:number|null}) {
  const group=useRef<T.Group>(null)
  const marks=useMemo(()=>new Float32Array([0,0,0,0,2,0,-.3,0,0,.3,0,0,-.3,1,0,.3,1,0,-.3,2,0,.3,2,0]),[])
  const position=useMemo(()=>new T.Vector3(),[])
  useFrame(()=>{
    const node=group.current,anchor=runtime.visitAnchor
    if(!node)return
    node.visible=runtime.visit&&runtime.terrainReady&&bearing!==null&&!!anchor
    if(!node.visible||!anchor||bearing===null)return
    const origin=viewpointCoordinates({lat:Math.asin(anchor.up.y)*180/Math.PI,lonEast:Math.atan2(-anchor.up.z,anchor.up.x)*180/Math.PI},runtime.visitOffset)
    position.set(...sitePosition(origin.lat,origin.lonEast))
    const originFrame=localFrame([position.x,position.y,position.z]),a=bearing*Math.PI/180, arc=20/LUNAR_RADIUS_M
    position.multiplyScalar(Math.cos(arc)).addScaledVector(new T.Vector3(...originFrame.north),Math.sin(arc)*Math.cos(a)).addScaledVector(new T.Vector3(...originFrame.east),Math.sin(arc)*Math.sin(a)).normalize()
    const lat=Math.asin(position.y)*180/Math.PI, lon=Math.atan2(-position.z,position.x)*180/Math.PI
    const height=runtime.terrainStore?.bestHeight(lat,lon)
    if(height==null){node.visible=false;return}
    const frame=localFrame([position.x,position.y,position.z]), q=attitudeAt(moon,clock.current.row)
    node.position.copy(position).multiplyScalar(1+(height+0.03)/LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
    node.quaternion.copy(q).multiply(new T.Quaternion().setFromRotationMatrix(new T.Matrix4().makeBasis(new T.Vector3(...frame.east),new T.Vector3(...frame.up),new T.Vector3(...frame.north).negate())))
  })
  if(bearing===null)return null
  return <group ref={group} scale={1/LUNAR_RADIUS_M} visible={false}>
    <lineSegments><bufferGeometry><bufferAttribute attach="attributes-position" args={[marks,3]}/></bufferGeometry><lineBasicMaterial color="#ebcf86" toneMapped={false}/></lineSegments>
    <Html position={[0,2.5,0]} center wrapperClass="scene-label-anchor" style={{pointerEvents:'none'}}><span className="visit-scale-label">2 m reference · illustrative</span></Html>
  </group>
}
