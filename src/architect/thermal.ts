import { SOLAR_IRRADIANCE } from '../lib/science.ts'
import type { SolarSeries } from './power.ts'

/** Stefan–Boltzmann constant (W·m⁻²·K⁻⁴). */
const SIGMA = 5.670374419e-8

/**
 * Single-node lumped-capacitance survival thermal model.
 *
 * One warm electronics/battery box with a thermostatic heater. Each hour the
 * node gains internal dissipation plus absorbed sunlight and loses heat by
 * radiation to a cold environment; the heater supplies whatever is needed to
 * hold the setpoint, up to its limit. It is a screening abstraction — no
 * spatial gradients, no transient duty cycling, no contact (regolith) coupling
 * beyond the single radiative sink. See docs/SCIENCE.md.
 */
export type ThermalConfig = {
  /** Thermal capacitance C = m·cp (J/K). */
  thermalMassJK: number
  /** Effective emissivity × radiating area, ε·A (m²). MLI + small radiator. */
  radiativeCoeffM2: number
  /** Solar absorptance × illuminated area, α·A (m²). */
  absorptivityAreaM2: number
  /** Percentage of electrical demand dissipated inside the controlled zone. */
  internalHeatFraction: number
  /** Heater power ceiling (W). */
  heaterMaxW: number
  /** Heater hold temperature (K). */
  setpointK: number
  /** Survival floor; the node must stay above this (K). */
  survivalK: number
  /** Radiative sink temperature of the environment (K). */
  sinkK: number
}

/** Illustrative hardware assumptions, editable; not a flown vehicle's thermal design. */
export const DEFAULT_THERMAL: ThermalConfig = {
  thermalMassJK: 100000, radiativeCoeffM2: 0.1, absorptivityAreaM2: 0.2,
  internalHeatFraction: 70, heaterMaxW: 80, setpointK: 273, survivalK: 233, sinkK: 70,
}

export type ThermalSummary = {
  minTempK: number
  heaterEnergyWh: number
  /** Mission-relative hour the node first drops below survival, or null. */
  firstFreezeH: number | null
  /** Hours the heater saturated while the node still fell. */
  saturatedHours: number
  pass: boolean
  margin: number
}
export type ThermalPoint = { hour: number; tempK: number; heaterW: number }
export type ThermalRun = ThermalSummary & {
  points: ThermalPoint[]
  /** Per-hour heater draw (W), window-relative; feeds the battery demand. */
  heaterW: Float64Array
}

export function validateThermal(c: ThermalConfig): void {
  const nums = ['thermalMassJK', 'radiativeCoeffM2', 'absorptivityAreaM2', 'internalHeatFraction', 'heaterMaxW', 'setpointK', 'survivalK', 'sinkK'] as const
  if (nums.some((k) => typeof c[k] !== 'number' || !Number.isFinite(c[k]))) throw new Error('Missing or nonfinite thermal assumption')
  if (c.thermalMassJK <= 0 || c.radiativeCoeffM2 < 0 || c.absorptivityAreaM2 < 0 ||
      c.internalHeatFraction < 0 || c.internalHeatFraction > 100 || c.heaterMaxW < 0 ||
      c.setpointK <= 0 || c.survivalK <= 0 || c.sinkK < 0 ||
      c.setpointK < c.survivalK || c.setpointK <= c.sinkK) throw new Error('Thermal assumptions outside supported range')
}

/**
 * Integrate the node temperature hour by hour across [start, end).
 *
 * Semi-implicit (radiation linearized around the current temperature), so the
 * step is unconditionally stable for any configuration. The thermostat solves
 * for the heater power that lands the step exactly on the setpoint, clamped to
 * [0, heaterMaxW]; above the setpoint the heater stays off and the node cools.
 */
export function simulateThermal(solar: SolarSeries, start: number, end: number, c: ThermalConfig, baseLoadW: number, trace = false): ThermalRun {
  validateThermal(c)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > solar.elevation.length) {
    throw new Error('Thermal window must contain complete supported hourly intervals')
  }
  if (!Number.isFinite(baseLoadW) || baseLoadW < 0) throw new Error('Invalid base load for thermal internal heat')
  const C = c.thermalMassJK
  const dt = 3600
  const sink4 = c.sinkK ** 4
  const internal = (c.internalHeatFraction / 100) * baseLoadW
  const rad = Math.PI / 180
  let T = c.setpointK
  let minTempK = T
  let heaterEnergyWh = 0
  let saturatedHours = 0
  let firstFreezeH: number | null = null
  const heaterW = new Float64Array(end - start)
  const points: ThermalPoint[] = trace ? [{ hour: 0, tempK: T, heaterW: 0 }] : []
  for (let i = start; i < end; i++) {
    const el = solar.elevation[i] * rad
    const solarGain = c.absorptivityAreaM2 * SOLAR_IRRADIANCE * (solar.fluxScale?.[i] ?? 1) * Math.max(0, Math.sin(el)) * solar.fraction[i]
    const qIn = internal + solarGain
    const qRad = c.radiativeCoeffM2 * SIGMA * (T ** 4 - sink4)
    const gRad = 4 * c.radiativeCoeffM2 * SIGMA * T ** 3
    const denom = C + dt * gRad
    const passiveT = T + (dt * (qIn - qRad)) / denom
    let heat = 0
    if (passiveT < c.setpointK) {
      const needed = ((c.setpointK - T) * denom) / dt - (qIn - qRad)
      heat = Math.max(0, Math.min(c.heaterMaxW, needed))
    }
    const next = T + (dt * (qIn + heat - qRad)) / denom
    heaterW[i - start] = heat
    heaterEnergyWh += heat // dt = 1 h, so W == Wh for this step
    if (heat >= c.heaterMaxW - 1e-9 && next < c.setpointK - 1e-9) saturatedHours++
    T = next
    minTempK = Math.min(minTempK, T)
    if (T < c.survivalK && firstFreezeH === null) firstFreezeH = i - start + 1
    if (trace) points.push({ hour: i - start + 1, tempK: T, heaterW: heat })
  }
  const pass = minTempK >= c.survivalK - 1e-9
  const margin = (minTempK - c.survivalK) / 100
  return { minTempK, heaterEnergyWh, firstFreezeH, saturatedHours, pass, margin, heaterW, points }
}
