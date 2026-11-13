import { useSyncExternalStore } from 'react'
import type { Constraints } from '../architect/solver.ts'

/**
 * The mission the visitor is planning, as one line every dashboard page can show:
 * site, landing time (UTC), duration, equipment and the current verdict. The mission plan
 * publishes it; the summary bar reads it. Separate from the 3D scene time on purpose.
 */
export type MissionSummary = {
  slug: string; siteName: string
  /** Landing hour index in the cached data, and the settings used, so other pages compare like with like. */
  row: number; constraints: Constraints
  landingUTC: string; endUTC: string; missionDays: number
  equipment: string
  verdict: 'meets' | 'misses'
  selectedByUser: boolean
  /** Nearby-touchdown and height checks still computing. */
  updating: boolean
}
let current: MissionSummary | null = null
const listeners = new Set<() => void>()
export function publishMission(next: MissionSummary | null) {
  if (JSON.stringify(next) === JSON.stringify(current)) return
  current = next; listeners.forEach(l => l())
}
export function useMissionSummary() {
  return useSyncExternalStore(l => { listeners.add(l); return () => { listeners.delete(l) } }, () => current)
}
const ORIENTATION: Record<string, string> = { tracking: 'ideal Sun tracking', horizontal: 'flat on the ground', fixed: 'fixed angle' }
export function equipmentLine(c: { power?: { panelAreaM2: number; capacityWh: number; loadW: number; reservePct: number; orientation: string; tiltDeg: number; azimuthDeg: number }; thermal?: unknown }) {
  if (!c.power) return 'Visibility only · battery not assessed'
  const p = c.power, panel = p.orientation === 'fixed' ? `fixed ${p.tiltDeg.toFixed(0)}° tilt, ${p.azimuthDeg.toFixed(0)}° facing` : ORIENTATION[p.orientation] ?? p.orientation
  return `${p.panelAreaM2} m² panel (${panel}) · ${(p.capacityWh / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kWh battery · ${p.loadW} W load · ${p.reservePct}% reserve${c.thermal ? ' · night survival on' : ''}`
}
