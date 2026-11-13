import * as T from 'three'
import type { TrailPoint } from '../lib/expedition'
import { LUNAR_RADIUS_M } from './terrain.ts'

/** Retain unchanged boot matrices and line vertices between steps. A trimmed trail is rebuilt in order. */
export class TrailGeometryWriter {
  private first: TrailPoint | undefined
  private length = 0
  private boots = 0
  private origin = new T.Vector3(Infinity, Infinity, Infinity)
  private inverse = new T.Quaternion(0, 0, 0, 0)
  private normal = new T.Vector3()
  private position = new T.Vector3()
  private offset = new T.Vector3()
  private heading = new T.Quaternion()
  private up = new T.Vector3(0, 1, 0)
  private object = new T.Object3D()

  update(points: readonly TrailPoint[], origin: T.Vector3, inverse: T.Quaternion, positions: T.BufferAttribute, mesh: T.InstancedMesh) {
    const rebuild = this.first !== points[0] || points.length < this.length || !this.origin.equals(origin) || !this.inverse.equals(inverse)
    const start = rebuild ? 0 : this.length, bootStart = rebuild ? 0 : this.boots
    let count = bootStart
    for (let i = start; i < points.length; i++) {
      const p = points[i], normal = this.normal.fromArray(p.normal).applyQuaternion(inverse).normalize()
      const position = this.position.fromArray(p.point).sub(origin).multiplyScalar(LUNAR_RADIUS_M).applyQuaternion(inverse).addScaledVector(normal, .025)
      positions.setXYZ(i, position.x, position.y, position.z)
      if (!p.step) continue
      this.object.quaternion.setFromUnitVectors(this.up, normal).multiply(this.heading.setFromAxisAngle(this.up, -p.heading * Math.PI / 180))
      this.object.position.copy(position).add(this.offset.set(p.step % 2 ? -.095 : .095, 0, 0).applyQuaternion(this.object.quaternion))
      this.object.updateMatrix(); mesh.setMatrixAt(count++, this.object.matrix)
    }
    // Buffer uploads are bounded to changed entries. Keep Three's existing pending ranges (multiple updates can
    // precede a draw); the renderer merges and clears them when it uploads.
    if (points.length > start) { positions.addUpdateRange(start * 3, (points.length - start) * 3); positions.needsUpdate = true }
    if (count > bootStart) { mesh.instanceMatrix.addUpdateRange(bootStart * 16, (count - bootStart) * 16); mesh.instanceMatrix.needsUpdate = true }
    mesh.count = count
    this.first = points[0]; this.length = points.length; this.boots = count
    this.origin.copy(origin); this.inverse.copy(inverse)
    return { start, boots: count }
  }
}

