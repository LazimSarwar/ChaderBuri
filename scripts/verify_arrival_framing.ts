import assert from 'node:assert/strict'
import { landingFraming } from '../src/space/arrivalFraming.ts'
const rad = Math.PI / 180
let checks = 0
for (const pad of [-15, -5, 0, 5, 15]) for (const lander of [0, 10, 30, 45, 60]) {
  const view = landingFraming(pad * rad, lander * rad)
  assert.ok(Number.isFinite(view.pitch) && view.fov >= 42 && view.fov <= 100); checks++
  assert.ok(Math.abs(pad * rad - view.pitch) < view.fov * rad / 2, 'Ground remains inside the vertical view'); checks++
  assert.ok(Math.abs(lander * rad - view.pitch) < view.fov * rad / 2, 'Lander remains inside the vertical view'); checks++
}
console.log(`Arrival framing: ${checks} checks passed`)
