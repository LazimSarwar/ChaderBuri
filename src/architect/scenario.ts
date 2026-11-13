import type { Constraints } from './solver.ts'
import { validatePower } from './power.ts'
import { validateThermal } from './thermal.ts'

export type Scenario = { v: 1; constraints: Constraints; loDay: number; hiDay: number; selection?: { slug: string; row: number } }
const STORAGE = 'landsight-scenario-v1'

/** Explicit schema; reject untrusted links instead of allowing NaN, huge loops,
 * or unsupported hardware to reach the solver. */
export function parseScenario(text: string | null): Scenario | null {
  if (!text || text.length > 4096) return null
  try {
    const s = JSON.parse(text) as Scenario
    const c = s.constraints
    const range = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi
    if (s.v !== 1 || !c || !Number.isInteger(c.missionDays) || !range(c.missionDays, 3, 30) ||
      !range(c.minLitPct, 0, 100) || !range(c.minLinkPct, 0, 100) || !range(c.maxDarkH, 0, 720) || !range(c.maxGapH, 0, 720) ||
      !Number.isInteger(s.loDay) || !Number.isInteger(s.hiDay) || !range(s.loDay, 0, 10000) || !range(s.hiDay, s.loDay, 10000)) return null
    if (c.power) {
      const keys = ['panelAreaM2', 'efficiencyPct', 'tiltDeg', 'azimuthDeg', 'loadW', 'capacityWh', 'initialPct', 'reservePct', 'chargeEfficiencyPct', 'dischargeEfficiencyPct'] as const
      if (keys.some((k) => !Number.isFinite(c.power![k]))) return null
      validatePower(c.power)
      if (c.power.panelAreaM2 > 100 || c.power.loadW > 10000 || c.power.capacityWh > 1000000) return null
    }
    if (c.thermal) {
      if (!c.power) return null // survival heating draws the battery; never without it
      const tkeys = ['thermalMassJK', 'radiativeCoeffM2', 'absorptivityAreaM2', 'internalHeatFraction', 'heaterMaxW', 'setpointK', 'survivalK', 'sinkK'] as const
      if (tkeys.some((k) => !Number.isFinite(c.thermal![k]))) return null
      validateThermal(c.thermal)
      if (c.thermal.thermalMassJK > 1e9 || c.thermal.heaterMaxW > 5000 || c.thermal.setpointK > 400) return null
    }
    if (s.selection && (!/^[a-z0-9-]{1,80}$/.test(s.selection.slug) || !Number.isInteger(s.selection.row) || !range(s.selection.row, 0, 100000))) return null
    return s
  } catch { return null }
}

export function loadScenario(): Scenario | null {
  const linked = new URLSearchParams(window.location.search).get('plan')
  if (linked !== null) return parseScenario(linked)
  try { return parseScenario(localStorage.getItem(STORAGE)) } catch { return null }
}

export function saveScenario(s: Scenario) {
  try { localStorage.setItem(STORAGE, JSON.stringify(s)) } catch { /* private browsing / quota */ }
}

export function scenarioURL(s: Scenario,identity?:{datasetId:string;modelVersion:string}): string {
  const url = new URL(window.location.href)
  url.searchParams.delete('compare')
  url.searchParams.set('plan', JSON.stringify(s))
  url.searchParams.set('view', 'plan')
  if(identity){url.searchParams.set('dataset',identity.datasetId);url.searchParams.set('model',identity.modelVersion)}
  return url.toString()
}
