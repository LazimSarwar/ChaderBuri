import { SOLAR_IRRADIANCE } from '../lib/science.ts'

export type PowerConfig = {
  panelAreaM2: number
  efficiencyPct: number
  orientation: 'tracking' | 'horizontal' | 'fixed'
  tiltDeg: number
  azimuthDeg: number
  loadW: number
  capacityWh: number
  initialPct: number
  reservePct: number
  chargeEfficiencyPct: number
  dischargeEfficiencyPct: number
}

/** Illustrative hardware assumptions, editable; not specifications for a flown lander. */
export const DEFAULT_POWER: PowerConfig = {
  panelAreaM2: 2, efficiencyPct: 28, orientation: 'tracking', tiltDeg: 90, azimuthDeg: 0,
  loadW: 100, capacityWh: 10000, initialPct: 90, reservePct: 20,
  chargeEfficiencyPct: 95, dischargeEfficiencyPct: 95,
}

export type SolarSeries = { azimuth: Float64Array; elevation: Float64Array; fraction: Float64Array; fluxScale?: Float64Array }
export type PowerSummary = {
  minPct: number
  endPct: number
  generatedWh: number
  demandWh: number
  unmetWh: number
  curtailedWh: number
  lossesWh: number
  /** Mission-relative hours, linearly located within the hourly energy step. */
  firstReserveH: number | null
  firstUnmetH: number | null
  pass: boolean
  margin: number
}
export type PowerPoint = { hour: number; socPct: number; generationW: number }
export type PowerRun = PowerSummary & { points: PowerPoint[] }

export function validatePower(c: PowerConfig): void {
  const required = ['panelAreaM2', 'efficiencyPct', 'tiltDeg', 'azimuthDeg', 'loadW', 'capacityWh', 'initialPct', 'reservePct', 'chargeEfficiencyPct', 'dischargeEfficiencyPct'] as const
  if (required.some(key => !Number.isFinite(c[key]))) throw new Error('Missing or nonfinite power assumption')
  for (const [key, value] of Object.entries(c)) {
    if (key !== 'orientation' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`Invalid ${key}`)
  }
  if (c.panelAreaM2 < 0 || c.loadW < 0 || c.capacityWh <= 0 ||
      c.efficiencyPct < 0 || c.efficiencyPct > 100 || c.initialPct < 0 || c.initialPct > 100 ||
      c.reservePct < 0 || c.reservePct > 100 || c.chargeEfficiencyPct <= 0 || c.chargeEfficiencyPct > 100 ||
      c.dischargeEfficiencyPct <= 0 || c.dischargeEfficiencyPct > 100 || c.tiltDeg < 0 || c.tiltDeg > 180 ||
      c.azimuthDeg < 0 || c.azimuthDeg >= 360 || !['tracking', 'horizontal', 'fixed'].includes(c.orientation)) throw new Error('Power assumptions outside supported range')
}

const cache = new WeakMap<SolarSeries, { key: string; watts: Float64Array }>()
export function generationFor(solar: SolarSeries, c: PowerConfig): Float64Array {
  validatePower(c)
  const key = JSON.stringify([c.panelAreaM2, c.efficiencyPct, c.orientation, c.tiltDeg, c.azimuthDeg])
  const hit = cache.get(solar)
  if (hit?.key === key) return hit.watts
  const watts = new Float64Array(solar.fraction.length)
  const rad = Math.PI / 180
  const tilt = c.tiltDeg * rad
  for (let i = 0; i < watts.length; i++) {
    const el = solar.elevation[i] * rad
    const incidence = c.orientation === 'tracking' ? 1 : c.orientation === 'horizontal' ? Math.sin(el) :
      Math.sin(el) * Math.cos(tilt) + Math.cos(el) * Math.sin(tilt) * Math.cos((solar.azimuth[i] - c.azimuthDeg) * rad)
    watts[i] = SOLAR_IRRADIANCE * (solar.fluxScale?.[i] ?? 1) * c.panelAreaM2 * c.efficiencyPct / 100 * Math.max(0, incidence) * solar.fraction[i]
  }
  cache.set(solar, { key, watts })
  return watts
}

/** Hourly, constant-within-step energy balance. Solar supplies the load first;
 * surplus charges through etaC, deficit draws through etaD. Excess is curtailed.
 * At depletion we continue the requested load to quantify unmet energy; this
 * is not a prediction of autonomous recovery.
 *
 * `heaterW` (window-relative, from the thermal model) is added to the constant
 * demand each hour, so survival heating draws from the same battery. Without it
 * the balance is exactly the constant-load case. */
export function simulatePower(watts: Float64Array, start: number, end: number, c: PowerConfig, trace = false, heaterW?: Float64Array): PowerRun {
  validatePower(c)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > watts.length) {
    throw new Error('Power window must contain complete supported hourly intervals')
  }
  if (heaterW && heaterW.length < end - start) throw new Error('Heater series shorter than the power window')
  let energy = c.capacityWh * c.initialPct / 100
  const reserve = c.capacityWh * c.reservePct / 100
  const etaC = c.chargeEfficiencyPct / 100
  const etaD = c.dischargeEfficiencyPct / 100
  let minEnergy = energy
  let generatedWh = 0
  let demandWh = 0
  let unmetWh = 0
  let curtailedWh = 0
  let lossesWh = 0
  let firstReserveH: number | null = energy < reserve - 1e-8 ? 0 : null
  let firstUnmetH: number | null = null
  const points: PowerPoint[] = trace ? [{ hour: 0, socPct: c.initialPct, generationW: watts[start] }] : []
  for (let i = start; i < end; i++) {
    const generation = watts[i]
    if (!Number.isFinite(generation) || generation < 0) throw new Error('Invalid solar generation')
    const load = c.loadW + (heaterW ? heaterW[i - start] : 0)
    const before = energy
    generatedWh += generation
    demandWh += load
    const net = generation - load
    if (net >= 0) {
      const accepted = Math.min(net, Math.max(0, c.capacityWh - energy) / etaC)
      energy += accepted * etaC
      curtailedWh += net - accepted
      lossesWh += accepted * (1 - etaC)
    } else {
      const requested = -net / etaD
      const drawn = Math.min(energy, requested)
      energy -= drawn
      lossesWh += drawn * (1 - etaD)
      const unmet = -net - drawn * etaD
      unmetWh += Math.max(0, unmet)
      if (unmet > 1e-8 && firstUnmetH === null) firstUnmetH = i - start + before / requested
      if (energy < reserve - 1e-8 && firstReserveH === null) firstReserveH = i - start + Math.max(0, (before - reserve) / requested)
    }
    minEnergy = Math.min(minEnergy, energy)
    if (trace) points.push({ hour: i - start + 1, socPct: 100 * energy / c.capacityWh, generationW: generation })
  }
  const minPct = 100 * minEnergy / c.capacityWh
  const pass = firstReserveH === null && unmetWh <= 1e-8
  const margin = unmetWh > 1e-8 ? Math.min(-unmetWh / c.capacityWh, (minPct - c.reservePct) / 100) :
    (pass ? Math.max(0, (minPct - c.reservePct) / 100) : (minPct - c.reservePct) / 100)
  return { minPct, endPct: 100 * energy / c.capacityWh, generatedWh, demandWh,
    unmetWh, curtailedWh, lossesWh, firstReserveH, firstUnmetH, pass, margin, points }
}
