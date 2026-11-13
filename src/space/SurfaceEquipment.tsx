import { useEffect,useRef,useMemo } from 'react'
import { useFrame,useThree,type ThreeEvent } from '@react-three/fiber'
import * as T from 'three'
import type { Equipment } from '../lib/expedition'
import { type BodyData } from './ephemeris'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime,SimClock } from './SpaceScene'
import { useSurfaceFrame } from './useSurfaceFrame'
import { ContactShade,useGroundContacts } from './SurfaceContact'
import { orientEquipment,EQUIPMENT_POSITIONS,type SurfaceObject } from '../lib/surfaceMission'
import { deploymentStep,easeDeployment } from '../lib/surfacePolish'
import { useReducedMotion } from '../useReducedMotion'
import { antennaBase,antennaHead,hardwareMaterials,lightHardware,solarPanelHead } from './hardware'
import { equipmentDragAllowed } from '../lib/equipmentGesture'
import { getEquipmentAdjust,useEquipmentAdjust } from './equipmentAdjust'

/**
 * Visible pointing motion for the example hardware: eases toward the commanded angle (degrees, wrapping for
 * bearings) with a speed limit, so a button press or a guide action reads as the mount slewing, not a jump.
 * Dragging and reduced motion snap.
 */
function slew(current:number,target:number,seconds:number,snap:boolean,wrap:boolean){
 if(snap||!Number.isFinite(current))return target
 const delta=wrap?((target-current+540)%360)-180:target-current,dt=Math.max(0,Math.min(.05,seconds))
 const step=delta*(1-Math.exp(-dt*4.5)),limit=95*dt
 return current+Math.max(-limit,Math.min(limit,Math.abs(delta)<.02?delta:step))
}
/** Illustrative example hardware geometry, built once and shared by every visit. */
let parts:{panel:ReturnType<typeof solarPanelHead>;antenna:ReturnType<typeof antennaHead>;base:ReturnType<typeof antennaBase>}|null=null
const hardwareParts=()=>parts??={panel:solarPanelHead(),antenna:antennaHead(),base:antennaBase()}

type Props={runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;equipment:Equipment;active?:SurfaceObject|null;onChange?:(e:Equipment)=>void;onSelect?:(object:SurfaceObject)=>void}
function Instrument({object,...p}:Props&{object:'panel'|'antenna'}){
 const position=EQUIPMENT_POSITIONS[object],root=useSurfaceFrame(p.runtime,p.clock,p.moon,position.eastM,position.northM),moving=useRef<T.Group>(null),head=useRef<T.Group>(null),progress=useRef(0),azimuth=useRef(0),elevation=useRef(0),shadowAt=useRef(0),settled=useRef(true),reduced=useReducedMotion()
 const {scene,invalidate}=useThree(),m=hardwareMaterials(),shapes=hardwareParts(),sun=useMemo(()=>new T.Vector3(),[]),up=useMemo(()=>new T.Vector3(),[]),drag=useRef<{x:number;y:number;start:Equipment}|null>(null),contacts=useGroundContacts(p.runtime,root,[[0,0],[-.48,.28],[.48,.28],[0,-.48]])
 // The facing arrow is a display aid: it never takes pointer events.
 const arrow=useMemo(()=>{const a=new T.ArrowHelper(new T.Vector3(0,1,0),new T.Vector3(0,object==='panel'?1.3:1.4,0),.75,0x8fbdcd,.12,.06);a.line.raycast=a.cone.raycast=()=>{};return a},[object])
 useEffect(()=>()=>{arrow.line.geometry.dispose();arrow.cone.geometry.dispose();(arrow.line.material as T.Material).dispose();(arrow.cone.material as T.Material).dispose()},[arrow])
 const shadow=()=>scene.traverse(o=>{if(o instanceof T.DirectionalLight&&o.castShadow)o.shadow.needsUpdate=true})
 useEffect(()=>{shadow();invalidate()},[p.equipment,contacts,scene,invalidate])
 // Aiming by drag: only in this instrument's explicit "Aim by dragging" mode (see equipmentDragAllowed).
 const adjusting=useEquipmentAdjust(),capture=useRef<{target:Element;id:number}|null>(null),hovered=useRef(false)
 const adjustable=adjusting===object&&p.active===object&&p.equipment[object]
 const stopDrag=useRef(()=>{})
 stopDrag.current=()=>{
  const c=capture.current;capture.current=null
  if(c){try{if(c.target.hasPointerCapture?.(c.id))c.target.releasePointerCapture(c.id)}catch{/* already released */}}
  if(drag.current||p.runtime.equipmentDrag){drag.current=null;p.runtime.equipmentDrag=false}
 }
 useEffect(()=>{
  const stop=()=>stopDrag.current(),hidden=()=>{if(document.hidden)stop()}
  window.addEventListener('blur',stop);window.addEventListener('pointercancel',stop);window.addEventListener('pointerup',stop);document.addEventListener('visibilitychange',hidden);document.addEventListener('pointerlockchange',stop)
  return()=>{stop();window.removeEventListener('blur',stop);window.removeEventListener('pointercancel',stop);window.removeEventListener('pointerup',stop);document.removeEventListener('visibilitychange',hidden);document.removeEventListener('pointerlockchange',stop)}
 },[])
 // Leaving the mode, closing the card or packing the instrument away ends any drag in progress.
 useEffect(()=>{if(!adjustable){stopDrag.current();if(hovered.current){hovered.current=false;document.body.style.cursor=''}}},[adjustable])
 useEffect(()=>()=>{if(hovered.current)document.body.style.cursor=''},[])
 useFrame((_,dt)=>{
  const e=p.equipment,on=e[object],node=moving.current,h=head.current;if(!node||!h)return
  const sunPosition=p.runtime.positions.get('Sun'),moonPosition=p.runtime.positions.get('Moon')
  if(object==='panel'&&root.current?.visible&&sunPosition&&moonPosition)lightHardware(up.set(0,1,0).applyQuaternion(root.current.quaternion),sun.copy(sunPosition).sub(moonPosition))
  const before=progress.current;progress.current=deploymentStep(before,on,dt,reduced);const amount=easeDeployment(progress.current)
  node.visible=progress.current>.001;node.scale.setScalar(Math.max(.001,amount))
  const az=object==='panel'?e.panelAz:e.antennaAz,el=object==='panel'?e.panelTilt:e.antennaEl
  // A freshly deployed instrument unfolds already facing its setting; later changes slew visibly.
  const settle=reduced||!!drag.current||before<.001
  azimuth.current=slew(azimuth.current,az,dt,settle,true)
  elevation.current=slew(elevation.current,el,dt,settle,false)
  const a=azimuth.current*Math.PI/180,b=elevation.current*Math.PI/180
  if(object==='panel'){h.rotation.set(0,-a,0);const panel=h.children[0];if(panel)panel.rotation.x=-(Math.PI/2*(1-amount)+b*amount);arrow.setDirection(new T.Vector3(Math.sin(a)*Math.sin(b),Math.cos(b),-Math.cos(a)*Math.sin(b)))}
  else{const d=new T.Vector3(Math.sin(a)*Math.cos(b),Math.sin(b),-Math.cos(a)*Math.cos(b));h.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),d);arrow.setDirection(d)}
  arrow.visible=p.active===object&&progress.current>.99
  // While it moves, redraw every frame but refresh the static sunlight shadow map only a few times a second
  // (it re-renders the whole terrain), then once more when it comes to rest.
  const moving_=Math.abs(before-progress.current)>.0001||Math.abs(((az-azimuth.current+540)%360)-180)>.03||Math.abs(el-elevation.current)>.03,now=performance.now()
  if(moving_){invalidate();if(now-shadowAt.current>160){shadowAt.current=now;shadow()}settled.current=false}
  else if(!settled.current){settled.current=true;shadow();invalidate()}
 })
 const allowed=(button:number)=>equipmentDragAllowed({object,button,deployed:p.equipment[object],visible:!!root.current?.visible&&progress.current>.99,active:p.active,adjusting:getEquipmentAdjust(),pointerLocked:!!document.pointerLockElement})
 const controls={
  // Not in aiming mode: do nothing here, so the press reaches the camera and the drag turns the view.
  onPointerDown:(event:ThreeEvent<PointerEvent>)=>{
   if(!allowed(event.button))return
   event.stopPropagation();p.runtime.equipmentDrag=true;drag.current={x:event.clientX,y:event.clientY,start:p.equipment}
   const target=event.target as unknown as Element
   try{target.setPointerCapture(event.pointerId);capture.current={target,id:event.pointerId}}catch{/* capture unavailable: window pointerup still ends the drag */}
  },
  onPointerMove:(event:ThreeEvent<PointerEvent>)=>{const d=drag.current;if(!d)return;if(!allowed(0)||event.buttons===0){stopDrag.current();return};event.stopPropagation();p.onChange?.({...d.start,...orientEquipment(d.start,object,event.clientX-d.x,event.clientY-d.y)})},
  onPointerUp:()=>stopDrag.current(),
  onLostPointerCapture:()=>stopDrag.current(),
  onPointerOver:()=>{if(adjustable&&!document.pointerLockElement){hovered.current=true;document.body.style.cursor='grab'}},
  onPointerOut:()=>{if(hovered.current){hovered.current=false;document.body.style.cursor=''}},
  onClick:(event:ThreeEvent<MouseEvent>)=>{event.stopPropagation();if(event.delta<=3&&!p.runtime.dragged)p.onSelect?.(object)},
 }
 // The mast stands on the rendered DEM facet under it (the frame itself sits on the interpolated height).
 const base=contacts[0]?contacts[0].position[1]:0
 return <group ref={root} scale={1/LUNAR_RADIUS_M} visible={false} userData={{surfaceRoot:true}}>
  {/* Packed-away equipment takes no pointer events at all (three.js raycasts ignore visibility). */}
  <group ref={moving} visible={false} position={[0,base,0]} userData={{surfaceObject:object}} {...(p.equipment[object]?controls:{})}>
   {contacts.slice(1).map((c,i)=>{if(!c)return null;const end=new T.Vector3(...c.position).setY(c.position[1]-base),start=new T.Vector3(0,.65,0),d=end.clone().sub(start);return <group key={i}><mesh castShadow position={end.clone().add(start).multiplyScalar(.5)} quaternion={new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),d.clone().normalize())}><cylinderGeometry args={[.018,.024,d.length(),10]}/><primitive object={m.metal} attach='material'/></mesh><mesh position={new T.Vector3(...c.position).setY(c.position[1]-base).addScaledVector(new T.Vector3(...c.normal),.018)} quaternion={new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0),new T.Vector3(...c.normal))}><cylinderGeometry args={[.065,.085,.03,16]}/><primitive object={m.pad} attach='material'/></mesh></group>})}
   <mesh castShadow position={[0,.68,0]} material={m.metal}><cylinderGeometry args={[.026,.04,1.36,14]}/></mesh>
   {/* Joints: the leg collar where the struts meet the mast, and the azimuth bearing under the head. */}
   <mesh castShadow position={[0,.65,0]} material={m.dark}><cylinderGeometry args={[.05,.05,.07,16]}/></mesh>
   <mesh position={[0,.65,0]} material={m.metal}><torusGeometry args={[.05,.006,6,20]}/></mesh>
   <mesh castShadow position={[0,object==='panel'?1.21:1.31,0]} material={m.dark}><cylinderGeometry args={[.055,.06,.05,18]}/></mesh>
   <mesh position={[0,object==='panel'?1.238:1.338,0]} material={m.metal}><cylinderGeometry args={[.05,.055,.008,18]}/></mesh>
   {object==='panel'?<group ref={head} position={[0,1.3,0]}><group>
    {shapes.panel.map(([key,geometry])=><mesh key={key} geometry={geometry} material={m[key]} castShadow receiveShadow/>)}
   </group>
    {/* Elevation yoke (turns with azimuth, not with tilt): two cheeks on the bearing and the hinge pin. */}
    {[-1,1].map(s=><mesh key={s} castShadow position={[s*.115,-.045,0]} material={m.dark}><boxGeometry args={[.016,.1,.07]}/></mesh>)}
    <mesh position={[0,-.088,0]} material={m.dark}><boxGeometry args={[.25,.014,.07]}/></mesh>
    <mesh rotation={[0,0,Math.PI/2]} material={m.metal}><cylinderGeometry args={[.011,.011,.26,10]}/></mesh>
   </group>:<>{shapes.base.map(([key,geometry])=><mesh key={key} geometry={geometry} material={m[key]} castShadow/>)}<group ref={head} position={[0,1.4,0]}>
    {shapes.antenna.map(([key,geometry])=><mesh key={key} geometry={geometry} material={m[key]} castShadow/>)}
   </group></>}
   <primitive object={arrow}/>
   {/* Aiming mode is visible in the scene: a gold handle ring around the head (display only, no pointer events). */}
   {adjustable&&<mesh position={[0,object==='panel'?1.3:1.4,0]} rotation={[Math.PI/2,0,0]} raycast={()=>{}} renderOrder={4}><torusGeometry args={[object==='panel'?.82:.6,.014,8,64]}/><meshBasicMaterial color='#f2c46d' transparent opacity={.85} depthWrite={false} toneMapped={false}/></mesh>}
  </group>
  {p.equipment[object]&&contacts.slice(1).map((c,i)=>c&&<ContactShade key={i} contact={c} radius={.16}/>)}
 </group>
}
export function SurfaceEquipment(p:Props){return <><Instrument {...p} object='panel'/><Instrument {...p} object='antenna'/></>}
