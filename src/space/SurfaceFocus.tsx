import { useEffect,useMemo,useRef,useState } from 'react'
import { useFrame,useThree } from '@react-three/fiber'
import * as T from 'three'
import type { Runtime,SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'
import { EQUIPMENT_POSITIONS,OUTPOST_POSITION,type SurfaceObject } from '../lib/surfaceMission'
import type { SurfaceFocus as Focus } from '../lib/surfacePolish'
import { LUNAR_RADIUS_M } from './terrain'
import { GroundCue,rimMaterial,useRim } from './SurfaceHighlight'

/** Ground cue placement for a focused object (payloads sit on the lander deck: rim only). */
export const CUE:Record<'lander'|'panel'|'antenna',{at:{eastM:number;northM:number};radius:number}>={lander:{at:OUTPOST_POSITION,radius:2.55},panel:{at:EQUIPMENT_POSITIONS.panel,radius:1.2},antenna:{at:EQUIPMENT_POSITIONS.antenna,radius:.8}}

/**
 * Reticle focus on the illustrative exhibits: the object under the centre of view gets a soft rim glow over its
 * own surfaces and a thin ring on the ground around it (no bounding box). E inspects it. The focus / select
 * callbacks and the userData.surfaceObject contract are unchanged.
 */
export function SurfaceFocus({runtime,clock,moon,open,onFocus,onSelect}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;open:boolean;onFocus?:(focus:Focus|null)=>void;onSelect?:(object:SurfaceObject,index?:number)=>void}){
 const {scene,camera,gl}=useThree(),last=useRef(''),focus=useRef<Focus|null>(null),handlers=useRef({onFocus,onSelect}),ray=useMemo(()=>new T.Raycaster(),[])
 const roots=useRef<T.Object3D[]>([]),scanAt=useRef(-Infinity),centre=useMemo(()=>new T.Vector2(0,0),[]),hits=useRef<T.Intersection[]>([])
 const [target,setTarget]=useState<{node:T.Object3D;object:SurfaceObject}|null>(null)
 const rim=useMemo(()=>rimMaterial('#f3e6c4',.24),[])
 useEffect(()=>()=>rim.dispose(),[rim])
 useRim(target?.node??null,rim)
 handlers.current={onFocus,onSelect}
 useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.target!==gl.domElement||event.key.toLowerCase()!=='e'||event.repeat||!focus.current)return;event.preventDefault();event.stopImmediatePropagation();handlers.current.onSelect?.(focus.current.object,focus.current.payloadIndex)};gl.domElement.addEventListener('keydown',key,true);return()=>gl.domElement.removeEventListener('keydown',key,true)},[gl])
 useFrame(()=>{
  let next:Focus|null=null,group:T.Object3D|null=null
  if(runtime.visit&&runtime.terrainReady&&!open&&!runtime.equipmentDrag){
   const now=performance.now();if(now-scanAt.current>500){scanAt.current=now;roots.current=[];scene.traverse(o=>{if(o.userData.surfaceRoot&&o.visible)roots.current.push(o)})}
   ray.setFromCamera(centre,camera);ray.far=18/LUNAR_RADIUS_M
   hits.current.length=0;ray.intersectObjects(roots.current,true,hits.current)
   for(const hit of hits.current){
    let node:T.Object3D|null=hit.object,kind:SurfaceObject|undefined,index:number|undefined,hidden=false,owner:T.Object3D|null=null
    while(node){if(!node.visible||node.userData.focusIgnore)hidden=true;if(!kind&&node.userData.surfaceObject){kind=node.userData.surfaceObject;index=node.userData.payloadIndex;owner=node}node=node.parent}
    if(hidden||!kind)continue
    next={object:kind,payloadIndex:index,label:kind==='panel'?'Adjust solar panel':kind==='antenna'?'Aim antenna':kind==='payload'?'Inspect instrument':'Inspect lander exhibit',distanceM:Math.round(hit.distance*LUNAR_RADIUS_M*10)/10};group=owner;break
   }
  }
  focus.current=next
  if((group??null)!==(target?.node??null))setTarget(group&&next?{node:group,object:next.object}:null)
  const key=next?`${next.object}/${next.payloadIndex}/${Math.round(next.distanceM*2)}`:''
  if(key!==last.current){last.current=key;handlers.current.onFocus?.(next)}
 })
 const cue=target&&target.object!=='payload'&&target.object in CUE?CUE[target.object as keyof typeof CUE]:null
 return <GroundCue runtime={runtime} clock={clock} moon={moon} at={cue?.at??null} radius={cue?.radius??1} color="#f3e6c4" opacity={.32}/>
}

/**
 * Deliberate "locate this" cue for the equipment an activity concerns: a soft pulsing ring on the ground, a slim
 * beacon visible from a distance and a gentle rim glow on the object itself. Static when motion is off.
 */
export function SurfaceLocate({runtime,clock,moon,object,pulse}:{runtime:Runtime;clock:React.RefObject<SimClock>;moon:BodyData;object:'lander'|'antenna'|'panel'|null;pulse:boolean}){
 const {scene,invalidate}=useThree(),[node,setNode]=useState<T.Object3D|null>(null),checked=useRef(0)
 const rim=useMemo(()=>rimMaterial('#8fd3e8',.55),[])
 useEffect(()=>()=>rim.dispose(),[rim])
 useRim(node,rim)
 useEffect(()=>{setNode(null);checked.current=0;invalidate()},[object,invalidate])
 useFrame(()=>{
  // The equipment group exists only while deployed; look again twice a second.
  const now=performance.now();rim.uniforms.strength.value=pulse?.22+.14*Math.sin(now/1000*Math.PI*2/1.8):.3
  if(!object||now-checked.current<500)return;checked.current=now
  let found:T.Object3D|null=null;scene.traverse(o=>{if(!found&&o.userData.surfaceObject===object&&o.visible)found=o})
  if(found!==node)setNode(found)
 })
 const cue=object?CUE[object]:null
 return <GroundCue runtime={runtime} clock={clock} moon={moon} at={cue?.at??null} radius={cue?.radius??1} color="#8fd3e8" opacity={.55} pulse={pulse} beacon={object==='lander'?7:object?4.2:0}/>
}
