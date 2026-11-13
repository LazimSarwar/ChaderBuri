import { generationFor, simulatePower, type PowerConfig, type SolarSeries } from './power.ts'
import { simulateThermal, type ThermalConfig } from './thermal.ts'

export type Tradeoff = {
  key: 'capacityWh' | 'loadW' | 'panelAreaM2'
  label: string
  value: number | null
  unit: string
  bound: number
  note: string
}

/** One-dimensional, bounded monotone searches. Every returned value is rounded
 * toward the feasible side and re-simulated. These satisfy only the electrical
 * requirement at this site/date; visibility constraints are separate.
 *
 * When thermal survival is active the heater draw is recomputed for each trial
 * and folded into battery demand — exactly as the mission verdict does — so a
 * change in demand also changes internal heat and heater consumption, and a
 * suggested repair actually passes the same model the verdict applies. */
export function powerTradeoffs(solar: SolarSeries, start: number, end: number, config: PowerConfig, thermal?: ThermalConfig): Tradeoff[] {
  const passes = (key: Tradeoff['key'], value: number) => {
    const c = { ...config, [key]: value }
    const heaterW = thermal ? simulateThermal(solar, start, end, thermal, c.loadW).heaterW : undefined
    return simulatePower(generationFor(solar, c), start, end, c, false, heaterW).pass
  }
  const specs: { key: Tradeoff['key']; label: string; unit: string; lower: number; upper: number; precision: number; increasing: boolean }[] = [
    { key: 'capacityWh', label: 'Minimum battery', unit: 'Wh', lower: 1, upper: 1_000_000, precision: 1, increasing: true },
    { key: 'loadW', label: 'Maximum constant demand', unit: 'W', lower: 0, upper: 10_000, precision: 0.1, increasing: false },
    { key: 'panelAreaM2', label: 'Minimum panel area', unit: 'm²', lower: 0, upper: 100, precision: 0.01, increasing: true },
  ]
  return specs.map((s) => {
    const feasibleBound = s.increasing ? s.upper : s.lower
    if (!passes(s.key, feasibleBound)) return { key: s.key, label: s.label, value: null, unit: s.unit, bound: s.upper,
      note: config.initialPct < config.reservePct ? 'Initial charge is below reserve. Fix that first.' : `No electrical solution within ${s.upper.toLocaleString()} ${s.unit}; this change alone cannot fix the window.` }
    const oppositeBound = s.increasing ? s.lower : s.upper
    if (passes(s.key, oppositeBound)) return { key: s.key, label: s.label, value: oppositeBound, unit: s.unit, bound: s.upper,
      note: 'Search bound reached. The hourly model requires no additional margin; hardware limits are not modeled.' }
    let lo = s.lower, hi = s.upper
    for (let i = 0; i < 45; i++) {
      const mid = (lo + hi) / 2
      if (passes(s.key, mid) === s.increasing) hi = mid
      else lo = mid
    }
    let value = s.increasing ? Math.ceil(hi / s.precision) * s.precision : Math.floor(lo / s.precision) * s.precision
    value = Math.max(s.lower, Math.min(s.upper, Number(value.toFixed(2))))
    return { key: s.key, label: s.label, value: passes(s.key, value) ? value : null, unit: s.unit, bound: s.upper,
      note: 'One setting changes; all other electrical assumptions stay fixed. No engineering margin added.' }
  })
}
