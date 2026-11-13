import assert from 'node:assert/strict'
import * as T from 'three'
import { indexExactGeometry } from '../src/space/exactGeometry.ts'
import { updateLiveInstances } from '../src/space/instanceUpdates.ts'

let checks = 0
const check = (condition: unknown, label: string) => { assert.ok(condition, label); checks++ }
function expanded(geometry: T.BufferGeometry, name: string) {
  const a = geometry.getAttribute(name) as T.BufferAttribute, words = new Uint32Array(a.array.buffer, a.array.byteOffset, a.array.length)
  const count = geometry.index?.count ?? a.count, result = new Uint32Array(count * a.itemSize)
  for (let i = 0; i < count; i++) {
    const at = geometry.index ? geometry.index.getX(i) : i
    result.set(words.subarray(at * a.itemSize, (at + 1) * a.itemSize), i * a.itemSize)
  }
  return result
}
const bytes = (g: T.BufferGeometry) => Object.values(g.attributes).reduce((sum, a) => sum + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0)

// These shapes exercise curved surfaces, hard-normal edges and UV seams used by the baked gloves.
for (const indexed of [new T.BoxGeometry(), new T.SphereGeometry(1, 36, 24), new T.CapsuleGeometry(.2, 1, 6, 18), new T.TorusGeometry(1, .1, 10, 44)]) {
  const original = indexed.toNonIndexed(), names = Object.keys(original.attributes), before = names.map(name => expanded(original, name)), size = bytes(original)
  const groups = JSON.stringify(original.groups); original.setDrawRange(3, original.getAttribute('position').count - 6)
  const range = { ...original.drawRange }; original.computeBoundingSphere(); const sphere = original.boundingSphere!.clone()
  check(indexExactGeometry(original) === original, 'The owned geometry and its identity are retained')
  names.forEach((name, i) => { assert.deepEqual(expanded(original, name), before[i], `Every ${name} bit in triangle order is preserved`); checks++ })
  check(bytes(original) < size, 'Exact indexing reduces the stored buffers')
  check(JSON.stringify(original.groups) === groups && original.drawRange.start === range.start && original.drawRange.count === range.count, 'Material groups and draw range are unchanged')
  check(original.boundingSphere!.equals(sphere), 'Existing bounds are unchanged')
  original.dispose(); indexed.dispose()
}

// A UV or normal seam at an identical position must remain split; even signed zero is not rounded away.
const seam = new T.BufferGeometry()
seam.setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, -0, 0, 0, 0, 0, 0], 3))
seam.setAttribute('normal', new T.Float32BufferAttribute([0, 1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3))
seam.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 0, 0], 2))
const seamBits = Object.keys(seam.attributes).map(name => expanded(seam, name))
indexExactGeometry(seam)
check(seam.getAttribute('position').count === 4, 'Only the fully identical tuple merges; seams and signed zero remain distinct')
Object.keys(seam.attributes).forEach((name, i) => { assert.deepEqual(expanded(seam, name), seamBits[i]); checks++ })

// More than 65,536 unique tuples needs a 32-bit index, with all expanded components preserved.
const large = new T.BufferGeometry(), positions = new Float32Array(70000 * 2 * 3)
for (let v = 0; v < 70000; v++) for (let repeat = 0; repeat < 2; repeat++) positions.set([v, v * .125, -v], (v * 2 + repeat) * 3)
large.setAttribute('position', new T.BufferAttribute(positions, 3))
const largeBits = expanded(large, 'position'); indexExactGeometry(large)
check(large.index!.array instanceof Uint32Array && large.getAttribute('position').count === 70000, 'Large exact meshes use a valid 32-bit index')
assert.deepEqual(expanded(large, 'position'), largeBits); checks++
check(indexExactGeometry(large) === large, 'Already indexed meshes are left alone')
const unique = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3))
indexExactGeometry(unique); check(unique.index === null, 'An index is not added when it would only increase storage')
const morph = unique.clone(); morph.morphAttributes.position = [unique.getAttribute('position').clone() as T.BufferAttribute]
indexExactGeometry(morph); check(morph.index === null, 'Morph meshes are excluded from this static-mesh optimization')

// Emulate the renderer's range uploads through empty, full, shrinking and reactivated particle sets.
const instances = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), 720), gpu = new Float32Array(720 * 16)
const matrix = new T.Matrix4()
for (const count of [0, 1, 720, 63, 0, 24, 360, 0]) {
  for (let i = 0; i < count; i++) { matrix.makeTranslation(i * .125, count * .01, -i); instances.setMatrixAt(i, matrix) }
  const before = instances.instanceMatrix.array.slice(), version = instances.instanceMatrix.version
  updateLiveInstances(instances, count)
  assert.deepEqual(instances.instanceMatrix.array, before); checks++
  check(instances.count === count && instances.visible === (count > 0), 'Exactly the live grains remain drawable')
  if (!count) check(instances.instanceMatrix.version === version, 'Empty dust never requests an upload')
  else {
    check(instances.instanceMatrix.version === version + 1, 'A live update is submitted')
    assert.deepEqual(instances.instanceMatrix.updateRanges, [{ start: 0, count: count * 16 }]); checks++
    for (const range of instances.instanceMatrix.updateRanges) gpu.set(instances.instanceMatrix.array.subarray(range.start, range.start + range.count), range.start)
    assert.deepEqual(gpu.subarray(0, count * 16), instances.instanceMatrix.array.subarray(0, count * 16)); checks++
    instances.instanceMatrix.clearUpdateRanges()
  }
}
instances.geometry.dispose(); (instances.material as T.Material).dispose(); instances.dispose()
for (const geometry of [seam, large, unique, morph]) geometry.dispose()
console.log(`Surface buffer regression checks passed: ${checks}`)
