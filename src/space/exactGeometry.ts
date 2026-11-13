import * as T from 'three'

/** Index a newly baked static mesh without welding or rounding any attribute. Mutates only this owned geometry. */
export function indexExactGeometry(geometry: T.BufferGeometry) {
  if (geometry.index || !geometry.attributes.position || Object.keys(geometry.morphAttributes).length) return geometry
  const attributes = Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b))
  const count = geometry.attributes.position.count
  if (!count || attributes.some(([, a]) => a instanceof T.InterleavedBufferAttribute || !(a.array instanceof Float32Array) || a.count !== count)) return geometry
  const columns = attributes.map(([name, a]) => {
    const attribute = a as T.BufferAttribute, array = attribute.array as Float32Array
    return { name, attribute, words: new Uint32Array(array.buffer, array.byteOffset, array.length) }
  })
  let capacity = 1
  while (capacity < count * 2) capacity *= 2
  const buckets = new Int32Array(capacity).fill(-1), indices = new Uint32Array(count), representatives: number[] = []
  const equal = (a: number, b: number) => columns.every(({ attribute, words }) => {
    const size = attribute.itemSize
    for (let c = 0; c < size; c++) if (words[a * size + c] !== words[b * size + c]) return false
    return true
  })
  for (let v = 0; v < count; v++) {
    let hash = 2166136261
    for (const { attribute, words } of columns) for (let c = 0; c < attribute.itemSize; c++) hash = Math.imul(hash ^ words[v * attribute.itemSize + c], 16777619)
    let slot = hash & (capacity - 1)
    while (buckets[slot] !== -1 && !equal(v, buckets[slot])) slot = (slot + 1) & (capacity - 1)
    if (buckets[slot] === -1) { buckets[slot] = v; indices[v] = representatives.length; representatives.push(v) }
    else indices[v] = indices[buckets[slot]]
  }
  if (representatives.length === count) return geometry
  for (const { name, attribute, words } of columns) {
    const compact = new Float32Array(representatives.length * attribute.itemSize), bits = new Uint32Array(compact.buffer)
    representatives.forEach((v, i) => { for (let c = 0; c < attribute.itemSize; c++) bits[i * attribute.itemSize + c] = words[v * attribute.itemSize + c] })
    geometry.setAttribute(name, new T.BufferAttribute(compact, attribute.itemSize, attribute.normalized).setUsage(attribute.usage))
  }
  geometry.setIndex(new T.BufferAttribute(representatives.length <= 65536 ? new Uint16Array(indices) : indices, 1))
  return geometry
}

