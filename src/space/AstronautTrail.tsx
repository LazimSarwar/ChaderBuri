import { useMemo,useRef,useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import * as T from 'three'
import { localFrame } from '../data'
import { MAX_TRAIL_POINTS } from '../lib/expedition'
import { attitudeAt,type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import { TrailGeometryWriter } from './trailGeometry'
import type { Runtime,SimClock } from './SpaceScene'

export function AstronautTrail({runtime,clock,moon,showLine}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;showLine:boolean}){
 const root=useRef<T.Group>(null),boots=useRef<T.InstancedMesh>(null),line=useRef<T.Line>(null),revision=useRef(-1),previousRuntime=useRef(runtime)
 const transforms=useMemo(()=>({anchor:null as Runtime['visitAnchor'],basis:new T.Quaternion(),inverse:new T.Quaternion(),matrix:new T.Matrix4(),east:new T.Vector3(),up:new T.Vector3(),south:new T.Vector3(),writer:new TrailGeometryWriter()}),[])
 const sole=useMemo(()=>{
  const s=new T.Shape();s.moveTo(-.065,-.15);s.lineTo(.065,-.15);s.lineTo(.075,.09);s.quadraticCurveTo(.075,.17,0,.18);s.quadraticCurveTo(-.075,.17,-.075,.09);s.closePath()
  for(let i=0;i<5;i++){const y=-.115+i*.05,h=new T.Path();h.moveTo(-.048,y);h.lineTo(-.048,y+.012);h.lineTo(.048,y+.012);h.lineTo(.048,y);h.closePath();s.holes.push(h)}
  return new T.ShapeGeometry(s,4).rotateX(-Math.PI/2)
 },[])
 const trail=useMemo(()=>{const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(MAX_TRAIL_POINTS*3),3).setUsage(T.DynamicDrawUsage));return g},[])
 const traceObject=useMemo(()=>new T.Line(trail,new T.LineBasicMaterial({color:'#c4b179',transparent:true,opacity:.65,depthWrite:false})),[trail])
 useEffect(()=>()=>{sole.dispose();trail.dispose();traceObject.material.dispose()},[sole,trail,traceObject])
 useFrame(()=>{
  const node=root.current,mesh=boots.current,trace=line.current,anchor=runtime.visitAnchor,origin=runtime.trailOrigin
  if(!node||!mesh||!trace)return
  node.visible=runtime.visit&&runtime.terrainReady&&!!origin&&!!anchor
  if(!node.visible||!origin||!anchor)return
  if(transforms.anchor!==anchor){
   const frame=localFrame([anchor.up.x,anchor.up.y,anchor.up.z])
   transforms.anchor=anchor;transforms.basis.setFromRotationMatrix(transforms.matrix.makeBasis(transforms.east.set(...frame.east),transforms.up.set(...frame.up),transforms.south.set(...frame.north).negate()));transforms.inverse.copy(transforms.basis).invert()
  }
  const {basis,inverse}=transforms,q=attitudeAt(moon,clock.current.row)
  node.position.copy(origin).applyQuaternion(q).add(runtime.positions.get('Moon')!).sub(runtime.origin);node.quaternion.copy(q).multiply(basis)
  trace.visible=showLine&&runtime.trail.length>1
  if(previousRuntime.current!==runtime){previousRuntime.current=runtime;revision.current=-1}
  if(revision.current===runtime.trailRevision)return
  revision.current=runtime.trailRevision
  transforms.writer.update(runtime.trail,origin,inverse,trail.getAttribute('position') as T.BufferAttribute,mesh)
  trail.setDrawRange(0,runtime.trail.length)
 })
 return <group ref={root} scale={1/LUNAR_RADIUS_M} visible={false}>
  <instancedMesh ref={boots} args={[sole,undefined,MAX_TRAIL_POINTS]} frustumCulled={false}><meshBasicMaterial color="#20201e" transparent opacity={.67} side={T.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-2}/></instancedMesh>
  <primitive object={traceObject} ref={line} frustumCulled={false}/>
 </group>
}
