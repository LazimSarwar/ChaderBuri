// Time-compressed landing simulation. Illustrative guidance profile, not flight telemetry:
// one kinematic description from which position, speeds, attitude, throttle and propellant
// are all derived, so the numbers on screen always agree with the motion you see.
import type { LanderPhase } from './contracts.ts'

export const LANDING = {
  approachRangeM: 220,   // horizontal distance from the pad at powered-descent start
  startAltM: 160,
  scanAltM: 26,          // hover height for the hazard scan
  scanEndAltM: 22,
  tApproach: 9,
  tScan: 2.5,
  tTerminal: 7.5,
  contactMps: .8,        // touchdown speed
  tShutdown: 2.4,        // engine cutoff + dust settling
  tStepOut: 2.6,         // camera walks to the astronaut's eye point
  maxPitchDeg: 38,
  startPropellantPct: 46,
}
export const T_CONTACT = LANDING.tApproach + LANDING.tScan + LANDING.tTerminal
export const T_LANDED = T_CONTACT + LANDING.tShutdown
export const LANDING_DURATION = T_LANDED + LANDING.tStepOut
export const LEG_BLEND_S = .6

export type LandingPoint = {
  t: number
  phase: LanderPhase
  rangeM: number
  altM: number
  /** Positive up. */
  vVertMps: number
  /** Ground speed toward the pad. */
  vHorizMps: number
  pitchDeg: number
  throttlePct: number
  propellantPct: number
  plume: number
  legStance: number
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))
const smooth = (x: number) => { const t = clamp01(x); return t * t * (3 - 2 * t) }

/** Altitude above the pad's ground, metres. */
function altitude(t: number): number {
  const { tApproach: tA, tScan: tS, tTerminal: tT, startAltM: a0, scanAltM: a1, scanEndAltM: a2, contactMps } = LANDING
  if (t <= 0) return a0
  if (t < tA) { const s = t / tA; return a1 + (a0 - a1) * (1 - s) ** 2 }           // braking: constant deceleration
  if (t < tA + tS) { const u = (t - tA) / tS; return a1 - (a1 - a2) * u * u }        // ease into the scan descent
  if (t < T_CONTACT) {                                                                 // cubic Hermite to contact
    const T = tT, u = (t - tA - tS) / T, v0 = -2 * (a1 - a2) / tS, v1 = -contactMps
    const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2
    return h00 * a2 + h10 * T * v0 + h01 * 0 + h11 * T * v1
  }
  return 0
}
function range(t: number): number {
  const s = clamp01(t / LANDING.tApproach)
  return LANDING.approachRangeM * (1 - s) ** 2
}
function throttle(t: number): number {
  const { tApproach: tA, tScan: tS } = LANDING
  if (t < 0) return 0
  if (t < tA) return 88 - 28 * (t / tA)
  if (t < tA + tS) return 56
  if (t < T_CONTACT) return 52 + 8 * Math.sin(Math.PI * (t - tA - tS) / LANDING.tTerminal)
  if (t < T_CONTACT + .2) return 30 * (1 - (t - T_CONTACT) / .2)
  return 0
}

// Propellant integrates throttle so it falls faster under heavy braking.
const STEP = .05
const PROPELLANT: number[] = (() => {
  const n = Math.ceil(LANDING_DURATION / STEP) + 2, total = Array.from({ length: n }, (_, i) => throttle(i * STEP)).reduce((a, b) => a + b, 0) * STEP
  const k = (LANDING.startPropellantPct - 9) / total
  let left = LANDING.startPropellantPct
  return Array.from({ length: n }, (_, i) => { const v = left; left -= throttle(i * STEP) * STEP * k; return v })
})()

export function phaseAt(t: number): LanderPhase {
  if (t < LANDING.tApproach) return 'approach'
  if (t < LANDING.tApproach + LANDING.tScan) return 'hazard-scan'
  if (t < T_CONTACT) return 'terminal'
  if (t < T_CONTACT + .25) return 'contact'
  if (t < T_LANDED) return 'shutdown'
  return 'landed'
}

export function landingAt(time: number): LandingPoint {
  const t = Math.max(0, Math.min(time, LANDING_DURATION)), dt = .02
  const alt = Math.max(0, altitude(t)), r = range(t)
  const vVert = t >= T_CONTACT ? 0 : (altitude(t + dt) - altitude(Math.max(0, t - dt))) / (t + dt - Math.max(0, t - dt))
  const vHoriz = t >= LANDING.tApproach ? 0 : -(range(t + dt) - range(Math.max(0, t - dt))) / (t + dt - Math.max(0, t - dt))
  const thr = throttle(t), i = Math.min(PROPELLANT.length - 1, Math.floor(t / STEP))
  return {
    t, phase: phaseAt(t), rangeM: r, altM: alt, vVertMps: vVert, vHorizMps: vHoriz,
    pitchDeg: t < LANDING.tApproach ? LANDING.maxPitchDeg * (1 - t / LANDING.tApproach) : 0,
    throttlePct: thr, propellantPct: PROPELLANT[i], plume: thr / 100,
    legStance: t < T_CONTACT ? 0 : smooth((t - T_CONTACT) / LEG_BLEND_S),
  }
}

/** Telemetry labels for the landing overlay. */
export const PHASE_LABEL: Record<LanderPhase, string> = {
  approach: 'Braking & approach', 'hazard-scan': 'Hazard scan', terminal: 'Terminal descent',
  contact: 'Contact', shutdown: 'Engine cutoff', landed: 'Lander safe',
}
export const PHASES: LanderPhase[] = ['approach', 'hazard-scan', 'terminal', 'contact', 'shutdown', 'landed']
