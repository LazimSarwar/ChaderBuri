import { useMemo,useRef,useState,useEffect } from 'react'
import { useFrame,useThree } from '@react-three/fiber'
import * as T from 'three'
import type { Runtime } from './SpaceScene'
import { LUNAR_RADIUS_M } from './terrain'
import { groundContacts,type GroundContact } from './groundContactMath'

export function useGroundContacts(runtime:Runtime,root:React.RefObject<T.Group|null>,points:readonly (readonly [number,number])[]){
 const [contacts,setContacts]=useState<(GroundContact|null)[]>([]),key=useRef(''),attempt=useRef({key:'',count:0,after:0}),timer=useRef<ReturnType<typeof setTimeout>|null>(null),{invalidate}=useThree(),signature=JSON.stringify(points)
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current)},[])
 useFrame(()=>{const node=root.current,mesh=runtime.terrainMesh,a=runtime.visitAnchor;if(!node?.visible||!mesh||!a||!runtime.terrainReady)return
  // Surface frames provide the exact DEM height/offset inputs. Do not reconstruct a rounded height from world
  // transforms: lunar rotation/floating-origin roundoff made stationary pads look changed hundreds of times.
  const moon=runtime.positions.get('Moon'),placement=node.userData.surfacePlacementKey??(moon?Math.round(node.position.clone().add(runtime.origin).sub(moon).length()*LUNAR_RADIUS_M*20):0)
  const next=`${mesh.geometry.uuid}/${a.up.x}/${a.up.y}/${a.up.z}/${placement}/${signature}`;if(next===key.current)return
  if(attempt.current.key!==next)attempt.current={key:next,count:0,after:0}
  if(attempt.current.count>=8||performance.now()<attempt.current.after)return
  const result=groundContacts(mesh,node,points,LUNAR_RADIUS_M)
  // Floating-origin transforms can settle a frame after the mesh becomes ready.
  // Never cache that first empty ray result as a permanent missing footpad.
  if(result.every(p=>p!==null))key.current=next
  else{attempt.current.count++;attempt.current.after=performance.now()+100;if(timer.current)clearTimeout(timer.current);timer.current=setTimeout(()=>invalidate(),110)}
  setContacts(result);invalidate()

 })
 return contacts
}
export function ContactShade({contact,radius=.34}:{contact:GroundContact;radius?:number}){
 const map=useMemo(()=>{const size=32,bytes=new Uint8Array(size*size*4);for(let y=0;y<size;y++)for(let x=0;x<size;x++){const d=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2));bytes.set([0,0,0,Math.max(0,1-d)**2*110],(y*size+x)*4)}const t=new T.DataTexture(bytes,size,size);t.needsUpdate=true;return t},[])
 useEffect(()=>()=>map.dispose(),[map])
 const n=new T.Vector3(...contact.normal),p=new T.Vector3(...contact.position).addScaledVector(n,.003)
 return <mesh userData={{focusIgnore:true}} position={p} quaternion={new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,1),n)}><planeGeometry args={[radius*2,radius*2]}/><meshBasicMaterial map={map} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2}/></mesh>
}
