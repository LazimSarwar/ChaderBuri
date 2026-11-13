import type * as T from 'three'

/** Keep an empty instanced mesh out of render/shadow processing; dirty only the live matrix prefix. */
export function updateLiveInstances(mesh: T.InstancedMesh, count: number) {
  mesh.count = count
  mesh.visible = count > 0
  if (!count) return
  mesh.instanceMatrix.clearUpdateRanges()
  mesh.instanceMatrix.addUpdateRange(0, count * 16)
  mesh.instanceMatrix.needsUpdate = true
}
