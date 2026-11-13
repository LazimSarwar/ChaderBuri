import { useMemo,useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import { localFrame,sitePosition } from '../data'
import { viewpointCoordinates } from '../lib/surfaceExplorer'
import { attitudeAt,type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'

/** Attach visitor illustrations to measured ground without changing the analysis target. */
export function useSurfaceFrame(runtime:Runtime,clock:React.RefObject<SimClock>,moon:BodyData,eastM=0,northM=0){
 const root=useRef<T.Group>(null)
 const tmp=useMemo(()=>({basis:new T.Quaternion(),matrix:new T.Matrix4(),e:new T.Vector3(),u:new T.Vector3(),n:new T.Vector3(),anchor:null as typeof runtime.visitAnchor,eastM:NaN,northM:NaN,origin:{lat:0,lonEast:0},point:{lat:0,lonEast:0},direction:[0,0,0] as [number,number,number]}),[])
 useFrame(()=>{
  const node=root.current,a=runtime.visitAnchor;if(!node)return
  // Hidden until their shader programs have linked in the background (no first-draw stall).
  node.visible=runtime.visit&&runtime.terrainReady&&runtime.shadersWarm&&!!a;if(!node.visible||!a)return
  if(tmp.anchor!==a||tmp.eastM!==eastM||tmp.northM!==northM){tmp.eastM=eastM;tmp.northM=northM;tmp.anchor=a;tmp.origin={lat:Math.asin(a.up.y)*180/Math.PI,lonEast:Math.atan2(-a.up.z,a.up.x)*180/Math.PI};tmp.point=viewpointCoordinates(tmp.origin,{eastM,northM});tmp.direction=sitePosition(tmp.point.lat,tmp.point.lonEast) as [number,number,number];const f=localFrame(sitePosition(tmp.origin.lat,tmp.origin.lonEast));tmp.basis.setFromRotationMatrix(tmp.matrix.makeBasis(tmp.e.set(...f.east),tmp.u.set(...f.up),tmp.n.set(...f.north).negate()))}
  const point=tmp.point,ground=runtime.terrainStore?.bestHeight(point.lat,point.lonEast)
  if(ground==null){node.visible=false;return}
  // Stable physical placement for the contact cache. Recovering height from a rotated, floating-origin world
  // position can flip across a rounding boundary every frame even while this illustration is stationary.
  node.userData.surfacePlacementKey=`${eastM}/${northM}/${ground}`
  const q=attitudeAt(moon,clock.current.row)
  node.position.set(...tmp.direction).multiplyScalar(1+(ground+.025)/LUNAR_RADIUS_M).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin)
  node.quaternion.copy(q).multiply(tmp.basis)
 })
 return root
}
