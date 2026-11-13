import * as T from 'three'
export type GroundContact={position:[number,number,number];normal:[number,number,number]}
/** Project an illustration onto the actual rendered DEM facet, in local model metres. */
export function groundContacts(mesh:T.Mesh,root:T.Group,points:readonly (readonly [number,number])[],metresPerUnit:number):(GroundContact|null)[]{
 mesh.updateWorldMatrix(true,false);root.updateWorldMatrix(true,false)
 const rotation=root.getWorldQuaternion(new T.Quaternion()),direction=new T.Vector3(0,-1,0).applyQuaternion(rotation),inverse=rotation.clone().invert(),normalMatrix=new T.Matrix3().getNormalMatrix(mesh.matrixWorld)
 return points.map(([x,z])=>{
  const start=root.localToWorld(new T.Vector3(x,100,z)),ray=new T.Raycaster(start,direction,0,300/metresPerUnit),hits:T.Intersection[]=[]
  // The surface terrain intentionally opts out of automatic pointer picking during a visit. These few deliberate
  // contact measurements must still hit its exact triangles; calling intersectObject would use that no-op override,
  // repeatedly retry and keep invalidating the shadows. Do not re-enable expensive pointer raycasts on the terrain.
  T.Mesh.prototype.raycast.call(mesh,ray,hits)
  let hit:T.Intersection|undefined
  for(const candidate of hits)if(!hit||candidate.distance<hit.distance)hit=candidate
  if(!hit?.face)return null
  const p=root.worldToLocal(hit.point.clone()),n=hit.face.normal.clone().applyNormalMatrix(normalMatrix).applyQuaternion(inverse).normalize();if(n.y<0)n.negate()
  return {position:p.toArray() as [number,number,number],normal:n.toArray() as [number,number,number]}
 })
}
