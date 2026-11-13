import assert from 'node:assert/strict'
import { landingAt, phaseAt, LANDING, LANDING_DURATION, T_CONTACT, T_LANDED, LEG_BLEND_S, PHASES } from '../src/lib/landingProfile.ts'

let checks = 0
const check = (v: unknown, m: string) => { assert.ok(v, m); checks++ }
const samples = Array.from({ length: Math.round(LANDING_DURATION / .05) + 1 }, (_, i) => landingAt(i * .05))

check(landingAt(0).altM === LANDING.startAltM && Math.abs(landingAt(0).rangeM - LANDING.approachRangeM) < 1e-9, 'Starts at powered-descent altitude and range')
// Altitude never rises and range never grows: the lander only comes down and in.
let up = 0, back = 0
for (let i = 1; i < samples.length; i++) { if (samples[i].altM > samples[i - 1].altM + 1e-9) up++; if (samples[i].rangeM > samples[i - 1].rangeM + 1e-9) back++ }
check(up === 0, 'Altitude decreases monotonically')
check(back === 0, 'Range to the pad decreases monotonically')
// Contact: soft, vertical, on the pad.
const contact = landingAt(T_CONTACT - .001)
check(contact.altM < .01 && Math.abs(contact.vVertMps) <= 1.0, `Touchdown is soft (${contact.vVertMps.toFixed(2)} m/s)`)
check(landingAt(T_CONTACT - 1).vHorizMps === 0 && landingAt(T_CONTACT - 1).rangeM === 0, 'No horizontal motion in terminal descent')
check(landingAt(T_CONTACT - 1).pitchDeg === 0, 'Upright for terminal descent')
check(landingAt(LANDING.tApproach - .5).altM >= LANDING.scanAltM && landingAt(LANDING.tApproach + LANDING.tScan / 2).altM <= LANDING.scanAltM, 'Hazard scan happens around the hover height')
// Speeds agree with the motion (finite differences of the same profile).
const mid = landingAt(4), before = landingAt(3.95), after = landingAt(4.05)
check(Math.abs(mid.vVertMps - (after.altM - before.altM) / .1) < .5, 'Vertical speed agrees with altitude change')
check(Math.abs(mid.vHorizMps + (after.rangeM - before.rangeM) / .1) < .5, 'Ground speed agrees with range change')
check(Math.max(...samples.map(s => Math.abs(s.vVertMps))) < 40 && Math.max(...samples.map(s => s.vHorizMps)) < 60, 'Speeds stay within a sane envelope')
// Engine and propellant.
check(samples.every((s, i) => i === 0 || s.propellantPct <= samples[i - 1].propellantPct + 1e-9), 'Propellant only decreases')
check(landingAt(LANDING_DURATION).propellantPct > 5 && landingAt(LANDING_DURATION).propellantPct < 15, 'Lands with a propellant margin')
check(landingAt(T_CONTACT + .3).throttlePct === 0 && landingAt(T_CONTACT + .3).plume === 0, 'Engine cuts off just after contact')
check(samples.filter(s => s.t < T_CONTACT).every(s => s.plume > .25), 'Plume burns throughout the descent')
// Legs: fixed until contact, then a smooth blend to the measured stance.
check(landingAt(T_CONTACT - .01).legStance === 0 && landingAt(T_CONTACT + LEG_BLEND_S + .01).legStance === 1, 'Legs blend from descent stance to ground stance')
let jumps = 0
for (let i = 1; i < samples.length; i++) if (Math.abs(samples[i].legStance - samples[i - 1].legStance) > .2) jumps++
check(jumps === 0, 'Leg blend has no visible jump between frames')
// Phases run in order and end landed.
const order = samples.map(s => PHASES.indexOf(s.phase))
check(order.every((v, i) => i === 0 || v >= order[i - 1]), 'Phases advance in order')
check(phaseAt(T_LANDED + .1) === 'landed' && landingAt(LANDING_DURATION + 50).phase === 'landed', 'Ends landed and stays landed')
check(LANDING_DURATION > 18 && LANDING_DURATION < 30, `Whole sequence stays watchable (${LANDING_DURATION.toFixed(1)} s)`)

console.log(`Landing simulation checks passed: ${checks}`)
