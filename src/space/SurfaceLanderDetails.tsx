import { useMemo,useEffect,useRef } from 'react'
import * as T from 'three'
function Cable({points}:{points:[number,number,number][]}){
 const signature=JSON.stringify(points)
 const geometry=useMemo(()=>new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),20,.014,5,false),[signature])
 useEffect(()=>()=>geometry.dispose(),[geometry])
 return <mesh geometry={geometry} castShadow><meshStandardMaterial color="#343c3d" roughness={.8}/></mesh>
}
function Fasteners({height,radius}:{height:number;radius:number}){
 const ref=useRef<T.InstancedMesh>(null)
 useEffect(()=>{const mesh=ref.current;if(!mesh)return;const o=new T.Object3D();let count=0
  for(let face=0;face<6;face++){const a=face*Math.PI/3,n=new T.Vector3(Math.sin(a),0,Math.cos(a)),t=new T.Vector3(Math.cos(a),0,-Math.sin(a));for(const y of [height*.36,height*.64])for(const x of [-.2,.2]){o.position.copy(n).multiplyScalar(radius+.03).addScaledVector(t,x);o.position.y=y;o.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),n);o.updateMatrix();mesh.setMatrixAt(count++,o.matrix)}}mesh.count=count;mesh.instanceMatrix.needsUpdate=true
 },[height,radius])
 return <instancedMesh ref={ref} args={[undefined,undefined,24]} castShadow><cylinderGeometry args={[.022,.022,.018,6]}/><meshStandardMaterial color="#b5b8ad" metalness={.7} roughness={.4}/></instancedMesh>
}
export function SurfaceLanderDetails({height,nova}:{height:number;nova:boolean}){
 const r=nova?.72:1.06
 return <>
  <Fasteners height={height} radius={r}/>
  {[-1,1].map(side=><group key={side} position={[side*(r+.12),height*.6,-.23]}>
   <mesh castShadow><capsuleGeometry args={[.16,height*.28,5,12]}/><meshStandardMaterial color="#cacdc5" metalness={.25} roughness={.5}/></mesh>
   {[-1,1].map(band=><mesh key={band} rotation={[Math.PI/2,0,0]} position={[0,band*height*.09,0]}><torusGeometry args={[.165,.025,5,16]}/><meshStandardMaterial color="#69757a" metalness={.7} roughness={.4}/></mesh>)}
  </group>)}
  {[-1,1].map(side=><group key={side} position={[side*.4,height*.79,.62]}>
   <mesh castShadow><boxGeometry args={[.34,.22,.3]}/><meshStandardMaterial color="#75858c" metalness={.55} roughness={.4}/></mesh>
   <mesh position={[0,0,.155]}><boxGeometry args={[.26,.14,.015]}/><meshStandardMaterial color="#cbd0c7" metalness={.3} roughness={.75}/></mesh>
   <mesh castShadow position={[0,-.16,0]}><boxGeometry args={[.44,.045,.35]}/><meshStandardMaterial color="#9caaa9" metalness={.65} roughness={.45}/></mesh>
  </group>)}
  <Cable points={[[r,height*.76,0],[r+.26,height*.66,.24],[r+.28,height*.4,.3],[r*.8,height*.3,.2]]}/>
  <Cable points={[[-r,height*.72,.05],[-r-.2,height*.6,.25],[-r-.2,.6,.45],[-.35,.4,.45]]}/>
  <mesh castShadow position={[0,height*.84,-r]}><boxGeometry args={[.7,.32,.07]}/><meshStandardMaterial color="#d1d3c9" metalness={.15} roughness={.9}/></mesh>
  {Array.from({length:8},(_,i)=><mesh key={i} position={[-.29+i*.083,height*.84,-r-.045]}><boxGeometry args={[.023,.27,.016]}/><meshStandardMaterial color="#5d6b70" metalness={.4} roughness={.7}/></mesh>)}
  {[.25,.7].map((level,i)=><mesh key={i} position={[0,height*level,0]}><cylinderGeometry args={[r+.025,r+.025,.035,6,1,true]}/><meshStandardMaterial color="#8e8f7f" metalness={.65} roughness={.55} side={T.DoubleSide}/></mesh>)}
 </>
}
