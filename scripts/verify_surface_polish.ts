import assert from 'node:assert/strict'
import * as T from 'three'
import { groundContacts } from '../src/space/groundContactMath.ts'
import { deploymentStep,easeDeployment,presentationAngle,presentationBob,parseSurfacePreferences,DEFAULT_SURFACE_PREFERENCES } from '../src/lib/surfacePolish.ts'
let checks=0
const check=(x:unknown,message:string)=>{assert.ok(x,message);checks++}
const close=(x:number,y:number,eps=1e-5)=>check(Math.abs(x-y)<eps,`${x} agrees with ${y}`)
check(JSON.stringify(parseSurfacePreferences(null))===JSON.stringify(DEFAULT_SURFACE_PREFERENCES),'Missing preferences use safe defaults')
check(!parseSurfacePreferences({motion:'true'}).motion,'Malformed stored motion preference does not turn camera movement on')
check(parseSurfacePreferences({motion:true,astronautView:true,quietHud:false}).motion,'Explicit motion opt-in is retained')
check(!('unknown' in parseSurfacePreferences({unknown:true})),'Unknown options are discarded')
let p=0
for(let i=0;i<60;i++){p=deploymentStep(p,true,1/60,false);check(p>=0&&p<=1,'Deployment stays bounded')}
close(p,1)
for(let i=0;i<60;i++)p=deploymentStep(p,false,1/60,false)
close(p,0)
close(deploymentStep(0,true,20,false),.05/.55)
close(deploymentStep(0,true,.01,true),1)
close(deploymentStep(1,false,.01,true),0)
close(deploymentStep(.4,true,NaN,false),.4)
for(const x of [0,.2,.5,.8,1])check(easeDeployment(x)>=0&&easeDeployment(x)<=1,'Deployment easing cannot overshoot')
close(easeDeployment(0),0);close(easeDeployment(1),1)
check(presentationAngle(359,1,.05,false)>359,'Crossing north takes the short angular path')
check(presentationAngle(1,359,.05,false)<1,'Reverse crossing takes the short angular path')
close(presentationAngle(359,1,.05,true),1)
for(let d=0;d<20;d+=.13){const bob=presentationBob(d,true,false,true,false);check(Math.abs(bob)<=.008,'Visual bob never exceeds 8 mm')}
for(const args of [[1,false,false,true,false],[1,true,true,true,false],[1,true,false,false,false],[1,true,false,true,true]] as const)close(presentationBob(...args),0)
const R=1737400,geometry=new T.PlaneGeometry(100/R,100/R).rotateX(-Math.PI/2),material=new T.MeshBasicMaterial()
for(let i=0;i<12;i++){
 const parent=new T.Group();parent.position.set(3+i,7-i,2);parent.rotation.set(i*.12,i*.24,i*.07)
 const ground=new T.Mesh(geometry,material);ground.rotation.z=.2;parent.add(ground)
 const model=new T.Group();model.scale.setScalar(1/R);parent.add(model);parent.updateMatrixWorld(true)
 const contacts=groundContacts(ground,model,[[1,0],[-1,0],[0,1],[90,0]],R)
 check(contacts[0]!==null&&contacts[1]!==null,'Foot points hit the transformed measured plane')
 close(contacts[0]!.position[1],Math.tan(.2),.0001);close(contacts[1]!.position[1],-Math.tan(.2),.0001)
 close(new T.Vector3(...contacts[0]!.normal).length(),1)
 close(contacts[0]!.normal[1],Math.cos(.2))
 check(contacts[3]===null,'Missing terrain leaves a contact absent rather than inventing a flat point')
}
geometry.dispose();material.dispose()
console.log(`Surface polish, terrain contact and motion checks passed: ${checks}`)
