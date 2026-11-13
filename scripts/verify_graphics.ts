// Graphics start-up and failure-state checks: renderer classification, conservative starting quality, evidence-based
// failure classification, plain-language copy and bounded retries. Run: npm run verify:graphics
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { classifyRenderer, startQuality } from '../src/space/graphicsProbe.ts'
import { classifyFailure, errorText, failureCopy, MAX_SCENE_RETRIES } from '../src/lib/graphicsFailure.ts'

let checks = 0
const check = (ok: unknown, label: string) => { assert.ok(ok, label); checks++ }

// Renderer classes (strings as browsers report them).
check(classifyRenderer('ANGLE (Intel, Intel(R) UHD Graphics 630 (0x00009BC8) Direct3D11 vs_5_0 ps_5_0, D3D11)') === 'integrated', 'Intel UHD 630 is integrated')
check(classifyRenderer('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)') === 'software', 'SwiftShader is software')
check(classifyRenderer('ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0, D3D11)') === 'software', 'Microsoft Basic Render Driver is software')
check(classifyRenderer('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)') === 'discrete-or-unknown', 'A discrete GPU is not downgraded')
check(classifyRenderer('Apple M2') === 'discrete-or-unknown' && classifyRenderer(null) === 'discrete-or-unknown', 'Apple silicon and unknown renderers are left to the frame-time controller')

// Conservative start.
check(startQuality('software', 12, 8, false) === 'low', 'Software rendering starts at low')
check(startQuality('integrated', 12, 8, false) === 'balanced', 'Integrated GPUs start at balanced (measured: high needs 34–43 ms GPU on a UHD 630)')
check(startQuality('discrete-or-unknown', 12, 8, false) === 'high', 'Capable desktops still start at high')
check(startQuality('discrete-or-unknown', 4, 8, false) === 'balanced' && startQuality('discrete-or-unknown', 12, 8, true) === 'balanced', 'Low-spec devices and phones start at balanced')

// Failure classification uses evidence: the live probe decides "unavailable".
const ok = { webgl2: true, renderer: 'ANGLE (Intel…)' }, none = { webgl2: false, renderer: null }
check(classifyFailure(new Error('Error creating WebGL context.'), none).kind === 'webgl-unavailable', 'No WebGL 2 in the probe → unavailable')
check(classifyFailure(new Error('Error creating WebGL context.'), ok).kind === 'exception', 'A creation error while the probe works is not called "unavailable"')
check(classifyFailure(new Error('WebGL context lost and not restored within 5 s (CONTEXT_LOST_WEBGL)'), ok).kind === 'context-lost', 'Context lost and not restored → context-lost')
check(classifyFailure(new TypeError('Failed to fetch'), ok).kind === 'asset' && classifyFailure(new Error('Could not load /textures/moon.jpg'), ok).kind === 'asset', 'Loading failures → asset')
check(classifyFailure(new TypeError("Cannot read properties of undefined (reading 'image')"), ok).kind === 'exception', 'A code error mentioning "image" is not mistaken for a loading failure')
const f = classifyFailure(new RangeError('Injected'), ok, new Date('2026-11-11T00:00:00Z'))
check(f.error === 'RangeError: Injected' && f.at === '2026-11-11T00:00:00.000Z' && f.renderer === 'ANGLE (Intel…)', 'The original error, time and renderer are kept for the technical details')
check(errorText('plain') === 'plain' && errorText({ a: 1 }) === '{"a":1}', 'Non-Error values are kept as text')

// Copy: retry only where it can help, never promised for a browser with WebGL off; bounded.
const unavailable = failureCopy('webgl-unavailable', MAX_SCENE_RETRIES)
check(!unavailable.retry && unavailable.restartBrowser && /restart the browser/i.test(unavailable.explain) && /any quality/i.test(unavailable.explain), 'WebGL off: no retry offered, restart explained, and no claim that lower quality helps')
for (const kind of ['context-lost', 'asset', 'exception'] as const) {
  check(failureCopy(kind, 2).retry && failureCopy(kind, 1).retry && !failureCopy(kind, 0).retry, `${kind}: retry offered only while retries remain`)
  check(/mission plan and all calculations|technical details/i.test(failureCopy(kind, 0).explain), `${kind}: says what still works or how to diagnose`)
}
check(MAX_SCENE_RETRIES === 2, 'At most two retries per session (no loops)')

// Wiring: one released probe; the boundary only reports; the app owns the failure state above the 3D controls.
const probe = readFileSync('src/space/graphicsProbe.ts', 'utf8')
check(/loseContext\(\)/.test(probe) && /if \(cached && !fresh\) return cached/.test(probe), 'The probe releases its context and is cached (no context accumulation)')
const boundary = readFileSync('src/SceneBoundary.tsx', 'utf8')
check(/console\.error\('3D view failed:'/.test(boundary) && /onFailure\(error/.test(boundary) && !/getContext/.test(boundary), 'The boundary logs and forwards the original error and creates no WebGL context')
const app = readFileSync('src/App.tsx', 'utf8')
check(/\{!graphicsFailure&&<SceneBoundary key=\{sceneAttempt\}/.test(app), 'A failed scene is unmounted; a retry mounts a fresh one')
check(/\{!graphicsFailure&&!drawerOpen&&!visitLook&&!visitPending&&<Suspense fallback=\{null\}><SpaceNavigator/.test(app), 'The 3D navigator controls are hidden while the failure state shows')
check(/sceneRetries>0\?\{quality:'low' as const\}/.test(app), 'Retries run in low quality')
const scene = readFileSync('src/space/SpaceScene.tsx', 'utf8')
check(/const \[antialias\]=useState\(\(\)=>level!=='low'\)/.test(scene), 'Multisampling is off when the scene starts at low')
check(/\{surfaceWanted&&<>/.test(scene) && /if\(!terrainStore\|\|!surfaceWanted\)return/.test(scene), 'Surface assets and their shader warm-up wait for a visit request')

console.log(`Graphics start-up and failure-state checks passed: ${checks}`)
