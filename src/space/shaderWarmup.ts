import * as T from 'three'

type WarmupRenderer = Pick<T.WebGLRenderer, 'compile' | 'properties' | 'extensions' | 'getContext' | 'domElement'>
type Timer = ReturnType<typeof setTimeout>
type WarmupScheduler = { set: (run: () => void, ms: number) => Timer; clear: (timer: Timer) => void }
export type ShaderWarmup = { ready: Promise<void>; cancel: () => void }

/**
 * Three r180's compileAsync polls a material's currentProgram after preparation. Material disposal removes that
 * record; its next timer then throws outside the promise. Keep the identical compile preparation and parallel
 * readiness check, but retire disposed materials and own every timer/listener so a visit can cancel its warm-up.
 */
export function startShaderWarmup(renderer: WarmupRenderer, root: T.Object3D, camera: T.Camera, options: { targetScene?: T.Scene; limitMs: number; scheduler?: WarmupScheduler }): ShaderWarmup {
  const scheduler = options.scheduler ?? { set: setTimeout, clear: clearTimeout }
  const materials = new Set(renderer.compile(root, camera, options.targetScene))
  const watched = new Set(materials)
  let poll: Timer | undefined, deadline: Timer | undefined, finished = false
  let resolve!: () => void, reject!: (reason: unknown) => void
  const ready = new Promise<void>((ok, fail) => { resolve = ok; reject = fail })
  const finish = (error?: unknown) => {
    if (finished) return
    finished = true
    if (poll !== undefined) scheduler.clear(poll)
    if (deadline !== undefined) scheduler.clear(deadline)
    renderer.domElement.removeEventListener('webglcontextlost', lost)
    for (const material of watched) material.removeEventListener('dispose', disposed)
    watched.clear(); materials.clear()
    if (error === undefined) resolve(); else reject(error)
  }
  const lost = () => finish()
  const disposed = (event: { target?: unknown }) => {
    const material = event.target as T.Material
    materials.delete(material); watched.delete(material)
    material.removeEventListener('dispose', disposed)
    if (!materials.size) finish()
  }
  const check = () => {
    poll = undefined
    if (finished) return
    try {
      if (renderer.getContext().isContextLost()) { finish(); return }
      for (const material of materials) {
        // has() avoids recreating the empty record that caused compileAsync's uncaught timer exception.
        const properties = renderer.properties.has(material) ? renderer.properties.get(material) as { currentProgram?: { isReady: () => boolean } } : null
        const program = properties?.currentProgram
        if (!program || program.isReady()) materials.delete(material)
      }
      if (!materials.size) finish()
      else poll = scheduler.set(check, 10)
    } catch (error) { finish(error) }
  }
  for (const material of watched) material.addEventListener('dispose', disposed)
  renderer.domElement.addEventListener('webglcontextlost', lost)
  deadline = scheduler.set(() => finish(), options.limitMs)
  if (renderer.extensions.get('KHR_parallel_shader_compile') !== null) check()
  else poll = scheduler.set(check, 10)
  return { ready, cancel: () => finish() }
}

type Drawable = T.Mesh & { isPoints?: boolean; isSprite?: boolean; isSkinnedMesh?: boolean; isBatchedMesh?: boolean; instanceColor?: unknown; morphTexture?: unknown; _colorsTexture?: unknown }

// Object-dependent shader inputs in Three r180's WebGLPrograms.getParameters. Geometry UUID and instance
// count are deliberately absent: a new focus overlay or footprint does not introduce a new shader variant.
function variant(o: Drawable) {
  const g = o.geometry, a = g?.attributes, m = g?.morphAttributes
  return `${o.type}/${!!(o as T.InstancedMesh).isInstancedMesh}/${!!o.instanceColor}/${!!o.morphTexture}/${!!o.isBatchedMesh}/${!!o._colorsTexture}/${!!o.isSkinnedMesh}/${!!a?.tangent}/${a?.color?.itemSize ?? 0}/${!!o.isPoints && !!a?.uv}/${m?.position?.length ?? '-'}/${m?.normal?.length ?? '-'}/${m?.color?.length ?? '-'}`
}

/** Visit-local cache, with weak material ownership. Does not change visibility, parents or shared resources. */
export class WarmMaterialCache {
  private seen = new WeakMap<T.Material, Set<string>>()

  private visit(root: T.Object3D, take: boolean) {
    const batch = new T.Group()
    root.traverse(node => {
      const o = node as Drawable
      if (!o.isMesh && !o.isPoints && !o.isSprite && !(o as unknown as T.Line).isLine) return
      if (!o.material) return
      const key = variant(o), materials = Array.isArray(o.material) ? o.material : [o.material]
      const fresh: T.Material[] = []
      for (const material of materials) {
        let keys = this.seen.get(material)
        if (!keys) this.seen.set(material, keys = new Set())
        if (!keys.has(key)) { keys.add(key); fresh.push(material) }
      }
      if (take && fresh.length) {
        // Compile a detached shallow clone with the real geometry and material. Never reparent live meshes or
        // dispose the borrowed geometry/material; this group is never rendered or attached to the real scene.
        const proxy = o.clone(false) as Drawable
        proxy.material = Array.isArray(o.material) ? fresh : fresh[0]
        batch.add(proxy)
      }
    })
    return batch
  }

  remember(root: T.Object3D) { this.visit(root, false) }
  takeNew(root: T.Object3D) { return this.visit(root, true) }
}
