import assert from 'node:assert/strict'
import * as T from 'three'
import { WarmMaterialCache } from '../src/space/shaderWarmup.ts'
import { TrailGeometryWriter } from '../src/space/trailGeometry.ts'
import { LUNAR_RADIUS_M } from '../src/space/terrain.ts'
import { groundContacts } from '../src/space/groundContactMath.ts'
import type { TrailPoint } from '../src/lib/expedition.ts'

let checks = 0
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++ }

// Previously warmed materials reused by a freshly mounted focus overlay must not trigger another scene compile.
const scene = new T.Scene(), hidden = new T.Group(), geometry = new T.BoxGeometry(), material = new T.MeshBasicMaterial()
hidden.visible = false; scene.add(hidden)
const original = new T.Mesh(geometry, material), light = new T.PointLight(); hidden.add(original, light)
const cache = new WarmMaterialCache(); cache.remember(scene)
const overlay = new T.Mesh(new T.SphereGeometry(), material); scene.add(overlay)
check(cache.takeNew(scene).children.length === 0, 'New geometry with the same shader inputs reuses the warmed program')
check(!hidden.visible && light.visible && original.parent === hidden && overlay.parent === scene, 'Warm-up preserves hidden parents, light visibility and ownership')
const instanced = new T.InstancedMesh(geometry, material, 2); scene.add(instanced)
let batch = cache.takeNew(scene)
check(batch.children.length === 1 && batch.children[0] !== instanced, 'Instancing introduces a distinct shader variant in a detached proxy')
check((batch.children[0] as T.Mesh).geometry === geometry && (batch.children[0] as T.Mesh).material === material && instanced.parent === scene, 'Proxies borrow the exact resources without moving the live mesh')
check(cache.takeNew(scene).children.length === 0, 'An unchanged scan schedules no compilation')
instanced.setColorAt(0, new T.Color('red'))
check(cache.takeNew(scene).children.length === 1, 'Late instance colours are a distinct variant')
const fresh = new T.Mesh(geometry, new T.MeshBasicMaterial()); hidden.add(fresh)
batch = cache.takeNew(scene)
check(batch.children.length === 1 && !hidden.visible, 'A newly mounted hidden material is warmed without showing it')
check(cache.takeNew(scene).children.length === 0, 'Late materials are remembered after one batch')
let disposed = false; material.addEventListener('dispose', () => { disposed = true }); batch.clear()
check(!disposed && geometry.attributes.position.count > 0, 'Releasing a warm-up batch does not dispose live shared assets')

const ground = new T.Mesh(new T.PlaneGeometry(100 / LUNAR_RADIUS_M, 100 / LUNAR_RADIUS_M).rotateX(-Math.PI / 2), material)
const model = new T.Group(); model.scale.setScalar(1 / LUNAR_RADIUS_M)
let pointerRaycasts = 0; ground.raycast = () => { pointerRaycasts++ }
const contact = groundContacts(ground, model, [[1, 0], [200, 0]], LUNAR_RADIUS_M)
check(contact[0] !== null && Math.abs(contact[0].position[1]) < 1e-7, 'Equipment contacts still hit exact terrain when automatic picking is disabled')
check(contact[1] === null && pointerRaycasts === 0, 'Contact measurements preserve missing terrain and leave automatic pointer picking disabled')
ground.geometry.dispose()

// Compare every generated boot matrix and line vertex to the original complete-rebuild algorithm, including
// trail trimming and a different site/origin. These values, opacity and geometry determine the visible trail.
const writer = new TrailGeometryWriter(), positions = new T.BufferAttribute(new Float32Array(240 * 3), 3)
const boots = new T.InstancedMesh(geometry, material, 240)
const origin = new T.Vector3(.2, -.97, .1), inverse = new T.Quaternion().setFromEuler(new T.Euler(.3, .9, -.2))
let points: TrailPoint[] = []
const reference = (list: TrailPoint[], at: T.Vector3, inv: T.Quaternion) => {
  const vertices = new Float32Array(list.length * 3), matrices: number[] = [], object = new T.Object3D()
  list.forEach((p, i) => {
    const normal = new T.Vector3(...p.normal).applyQuaternion(inv).normalize()
    const position = new T.Vector3(...p.point).sub(at).multiplyScalar(LUNAR_RADIUS_M).applyQuaternion(inv).addScaledVector(normal, .025)
    vertices.set(position.toArray(), i * 3)
    if (!p.step) return
    object.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), normal).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), -p.heading * Math.PI / 180))
    object.position.copy(position).add(new T.Vector3(p.step % 2 ? -.095 : .095, 0, 0).applyQuaternion(object.quaternion)); object.updateMatrix()
    matrices.push(...object.matrix.elements)
  })
  return { vertices, matrices: new Float32Array(matrices) }
}
function equivalent(label: string) {
  const expected = reference(points, origin, inverse)
  assert.deepEqual(positions.array.slice(0, points.length * 3), expected.vertices, `${label}: line vertices`)
  assert.deepEqual(boots.instanceMatrix.array.slice(0, boots.count * 16), expected.matrices, `${label}: boot matrices`)
  check(boots.count * 16 === expected.matrices.length, `${label}: same visible boot count`)
}
for (let step = 0; step < 270; step++) {
  const p: TrailPoint = { step, heading: step * 19 % 360, eastM: step * .6, northM: step * .4,
    point: [.2 + step * 1e-7, -.97 + Math.sin(step) * 1e-8, .1 + step * 2e-7], normal: [.2 + Math.sin(step) * .01, -.97, .1] }
  points = [...points, p].slice(-240)
  const update = writer.update(points, origin, inverse, positions, boots)
  if (step > 0 && step < 240) check(update.start === points.length - 1, 'Appending one step rewrites only its new vertex and matrix')
  equivalent(`step ${step}`)
  positions.clearUpdateRanges(); boots.instanceMatrix.clearUpdateRanges()
}
origin.addScalar(.002); inverse.setFromEuler(new T.Euler(.7, -.2, .1))
check(writer.update(points, origin, inverse, positions, boots).start === 0, 'A changed site frame rebuilds all entries')
equivalent('changed origin and frame')
points = []; writer.update(points, origin, inverse, positions, boots)
check(boots.count === 0, 'Returning to the landing point clears old visible boot instances')
check(writer.update(points, origin, inverse, positions, boots).start === 0, 'An empty retained trail is valid')
console.log(`Frame-spike regression checks passed: ${checks}`)
