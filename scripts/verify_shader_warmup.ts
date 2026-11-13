import assert from 'node:assert/strict'
import * as T from 'three'
import { startShaderWarmup } from '../src/space/shaderWarmup.ts'

let checks = 0
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++ }
type Timer = ReturnType<typeof setTimeout>
class Clock {
  now = 0
  next = 0
  tasks = new Map<number, { at: number; run: () => void }>()
  set = (run: () => void, ms: number) => { const id = ++this.next; this.tasks.set(id, { at: this.now + ms, run }); return id as unknown as Timer }
  clear = (timer: Timer) => { this.tasks.delete(timer as unknown as number) }
  advance(ms: number) {
    const end = this.now + ms
    while (true) {
      const next = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
      if (!next) break
      this.now = next[1].at; this.tasks.delete(next[0]); next[1].run()
    }
    this.now = end
  }
}
function fixture(parallel = true) {
  const material = new T.MeshBasicMaterial(), canvas = new EventTarget(), clock = new Clock()
  const records = new Map<unknown, unknown>(), root = new T.Group(), camera = new T.PerspectiveCamera(), target = new T.Scene()
  const listeners = new Set<unknown>(), canvasListeners = new Set<unknown>()
  const add = material.addEventListener.bind(material), remove = material.removeEventListener.bind(material)
  material.addEventListener = (...args) => { listeners.add(args[1]); add(...args) }
  material.removeEventListener = (...args) => { listeners.delete(args[1]); remove(...args) }
  const addCanvas = canvas.addEventListener.bind(canvas), removeCanvas = canvas.removeEventListener.bind(canvas)
  canvas.addEventListener = (...args) => { canvasListeners.add(args[1]); addCanvas(...args) }
  canvas.removeEventListener = (...args) => { canvasListeners.delete(args[1]); removeCanvas(...args) }
  let ready = false, calls = 0, reads = 0, lost = false, prepared: unknown[] = []
  records.set(material, { currentProgram: { isReady: () => { calls++; return ready } } })
  const renderer = {
    compile: (...args: unknown[]) => { prepared = args; return new Set([material]) },
    properties: { has: (m: unknown) => records.has(m), get: (m: unknown) => { reads++; return records.get(m) }, remove() {}, update() {}, dispose() {} },
    extensions: { get: () => parallel ? {} : null },
    getContext: () => ({ isContextLost: () => lost }),
    domElement: canvas,
  } as unknown as Parameters<typeof startShaderWarmup>[0]
  const start = (limitMs = 100) => startShaderWarmup(renderer, root, camera, { targetScene: target, limitMs, scheduler: clock })
  return { material, canvas, clock, records, listeners, canvasListeners, root, camera, target, renderer, start, setReady: () => { ready = true }, lose: () => { lost = true; canvas.dispatchEvent(new Event('webglcontextlost')) }, get calls() { return calls }, get reads() { return reads }, get prepared() { return prepared } }
}

{
  const f = fixture(), job = f.start()
  check(f.prepared[0] === f.root && f.prepared[1] === f.camera && f.prepared[2] === f.target, 'Preparation keeps the exact root, camera and target scene')
  check(f.calls === 1 && f.clock.tasks.size === 2, 'Parallel compilation polls immediately, then schedules 10 ms and the bound')
  f.clock.advance(9); check(f.calls === 1, 'No busy loop before the next 10 ms check')
  f.setReady(); f.clock.advance(1); await job.ready
  check(f.clock.tasks.size === 0 && f.listeners.size === 0 && f.canvasListeners.size === 0, 'Ready programs release every timer and listener')
}
{
  const f = fixture(), job = f.start(), reads = f.reads
  // Three's own disposal listener removes its record before the warm-up's listener runs.
  f.records.delete(f.material); f.material.dispose(); await job.ready; f.clock.advance(1000)
  check(f.reads === reads, 'A disposed material is never looked up again')
  check(f.clock.tasks.size === 0 && f.listeners.size === 0 && f.canvasListeners.size === 0, 'Disposal releases polling and the deadline')
}
{
  const f = fixture(), job = f.start()
  f.records.set(f.material, {}); f.clock.advance(10); await job.ready
  check(f.clock.tasks.size === 0 && f.calls === 1, 'A missing currentProgram cannot throw from a later timer')
}
{
  const f = fixture(), job = f.start(), reads = f.reads
  f.records.delete(f.material); f.clock.advance(10); await job.ready
  check(f.reads === reads, 'A removed property record is not recreated during polling')
}
{
  const f = fixture(), job = f.start(), calls = f.calls
  job.cancel(); job.cancel(); await job.ready; f.clock.advance(1000)
  check(f.calls === calls && f.clock.tasks.size === 0, 'Cancellation is idempotent and leaves no polling callbacks')
  check(f.listeners.size === 0 && f.canvasListeners.size === 0 && f.records.has(f.material), 'Cancellation removes listeners without disposing or changing materials')
}
{
  const f = fixture(), job = f.start()
  f.lose(); await job.ready; f.clock.advance(1000)
  check(f.clock.tasks.size === 0 && f.listeners.size === 0 && f.canvasListeners.size === 0, 'Context loss cancels timers and listeners')
}
{
  const f = fixture(), job = f.start(20)
  f.clock.advance(20); await job.ready
  check(f.clock.tasks.size === 0 && f.listeners.size === 0 && f.canvasListeners.size === 0, 'The existing time bound settles a stuck compilation and cleans up')
}
{
  const f = fixture(false); f.setReady(); const job = f.start()
  check(f.calls === 0, 'Without parallel-shader support the first check waits 10 ms, matching Three')
  f.clock.advance(10); await job.ready
  check(f.calls === 1 && f.clock.tasks.size === 0, 'The fallback check completes without altering shader preparation')
}
{
  const f = fixture()
  f.renderer.compile = () => { throw new Error('compile failed') }
  assert.throws(() => f.start(), /compile failed/); checks++
  check(f.clock.tasks.size === 0 && f.listeners.size === 0 && f.canvasListeners.size === 0, 'A preparation exception cannot leave timers or listeners behind')
}
console.log(`Shader warm-up lifecycle: ${checks} checks passed`)
