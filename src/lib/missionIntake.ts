import { DEFAULT_POWER } from '../architect/power.ts'
import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from '../architect/solver.ts'
import { placesFor } from '../architect/verdictText.ts'

const HOUR = 3_600_000
export const INTAKE_STORAGE = 'chader-buri.mission-setup.v1'
export type IntakePurpose = 'balanced' | 'sunlight' | 'earth'
export type IntakeDraft = {
  landingUTC: string
  missionDays: number
  purpose: IntakePurpose
  equipment: 'example' | 'custom'
  panelAreaM2: number
  capacityKWh: number
  loadW: number
  reservePct: number
  minLitPct: number
  maxDarkH: number
  minLinkPct: number
  maxGapH: number
}
export const INTAKE_PURPOSES: Record<IntakePurpose, { label: string; description: string; limits: Pick<Constraints, 'minLitPct' | 'maxDarkH' | 'minLinkPct' | 'maxGapH'> }> = {
  balanced: { label: 'Balance sunlight and Earth visibility', description: 'An introduction to the trade-offs between energy and seeing Earth.', limits: { minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72 } },
  sunlight: { label: 'Favor sunlight', description: 'Ask for more sunlit time and shorter periods of darkness.', limits: { minLitPct: 80, maxDarkH: 24, minLinkPct: 40, maxGapH: 120 } },
  earth: { label: 'Favor Earth visibility', description: 'Ask for more time with Earth above the skyline and shorter gaps.', limits: { minLitPct: 40, maxDarkH: 120, minLinkPct: 80, maxGapH: 24 } },
}
export type IntakeMission = { row: number; c: Constraints }
export type IntakeValidation = { ok: true; mission: IntakeMission } | { ok: false; errors: string[] }
export type IntakeRanked = { slug: string; result: Evaluated }
export type IntakeAssessment = { ranked: IntakeRanked[]; unavailable: string[]; passing: number }

/** An explanation context only. Returning it does not apply a mission to the dashboard. */
export function intakeMissionForGuide(validation: IntakeValidation, slug?: string): ({ slug: string } & IntakeMission) | null {
  if (!validation.ok || !slug || !/^[a-z0-9-]{1,80}$/.test(slug)) return null
  const c = validation.mission.c
  return { slug, row: validation.mission.row, c: { ...c, ...(c.power ? { power: { ...c.power } } : {}), ...(c.thermal ? { thermal: { ...c.thermal } } : {}) } }
}

export const intakeDateInput = (ms: number) => new Date(ms).toISOString().slice(0, 16)
export const intakeDateLabel = (ms: number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC', hour12: false }).format(ms) + ' UTC'

/** The last ephemeris sample closes the final interval; it is not another mission hour. */
export function intakeCoverageHours(limit: number, sampleCounts: number[]): number {
  const intervals = sampleCounts.filter(n => Number.isInteger(n) && n >= 2).map(n => n - 1)
  return Number.isFinite(limit) && limit > 0 && intervals.length ? Math.min(Math.floor(limit), ...intervals) : 0
}

/** Only the initial suggestion is bounded; a visitor's chosen date is never moved. */
export function initialIntake(startMs: number, totalHours: number, initialRow?: number, now = Date.now()): IntakeDraft {
  const latest = Math.max(0, totalHours - 14 * 24)
  const suggested = Number.isFinite(initialRow) ? Math.floor(initialRow!) : Math.ceil((now - startMs) / HOUR)
  const row = Math.min(latest, Math.max(0, suggested))
  return { landingUTC: intakeDateInput(startMs + row * HOUR), missionDays: 14, purpose: 'balanced', equipment: 'example', panelAreaM2: DEFAULT_POWER.panelAreaM2, capacityKWh: DEFAULT_POWER.capacityWh / 1000, loadW: DEFAULT_POWER.loadW, reservePct: DEFAULT_POWER.reservePct, ...INTAKE_PURPOSES.balanced.limits }
}

/** Strict UTC parsing also rejects rolled-over dates such as 30 February. */
export function intakeUTC(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(value)) return null
  const ms = Date.parse(value + ':00Z')
  return Number.isFinite(ms) && intakeDateInput(ms) === value ? ms : null
}

export function validateIntake(d: IntakeDraft, startMs: number, totalHours: number): IntakeValidation {
  const errors: string[] = []
  const inRange = (v: number, low: number, high: number) => Number.isFinite(v) && v >= low && v <= high
  const ms = intakeUTC(d.landingUTC)
  if (ms === null) errors.push('Choose a valid arrival date at a whole UTC hour, such as 14:00.')
  if (!Number.isInteger(d.missionDays) || !inRange(d.missionDays, 3, 30)) errors.push('Choose a mission length from 3 to 30 whole days.')
  if (!Object.hasOwn(INTAKE_PURPOSES, d.purpose)) errors.push('Choose what matters most for this visit.')
  if (!['example', 'custom'].includes(d.equipment)) errors.push('Choose the example lander or enter your own assumptions.')
  if (!inRange(d.minLitPct, 0, 100) || !inRange(d.minLinkPct, 0, 100)) errors.push('Sunlight and Earth visibility requirements must be between 0% and 100%.')
  if (!inRange(d.maxDarkH, 0, 400) || !inRange(d.maxGapH, 0, 400)) errors.push('The longest darkness and Earth gaps must be between 0 and 400 hours.')
  if (d.equipment === 'custom') {
    if (!inRange(d.panelAreaM2, 0.1, 100)) errors.push('Panel area must be between 0.1 and 100 m².')
    if (!inRange(d.capacityKWh, 0.1, 200)) errors.push('Battery storage must be between 0.1 and 200 kWh.')
    if (!inRange(d.loadW, 0, 10000)) errors.push('Power demand must be between 0 and 10,000 W.')
    if (!inRange(d.reservePct, 0, 90)) errors.push('Battery reserve must be between 0% and 90%.')
  }
  const row = ms === null ? -1 : (ms - startMs) / HOUR
  if (ms !== null && (!Number.isInteger(row) || row < 0 || row + d.missionDays * 24 > totalHours)) errors.push('The whole mission must fit inside the available prediction dates. Choose another arrival or a shorter stay.')
  if (errors.length) return { ok: false, errors }
  const power = d.equipment === 'example' ? { ...DEFAULT_POWER } : { ...DEFAULT_POWER, panelAreaM2: d.panelAreaM2, capacityWh: d.capacityKWh * 1000, loadW: d.loadW, reservePct: d.reservePct }
  return { ok: true, mission: { row, c: { missionDays: d.missionDays, minLitPct: d.minLitPct, maxDarkH: d.maxDarkH, minLinkPct: d.minLinkPct, maxGapH: d.maxGapH, power } } }
}

/** Same fixed-date evaluation and default ordering as the mission dashboard. */
export function assessIntake(series: SiteSeries[], mission: IntakeMission): IntakeAssessment {
  const ranked: IntakeRanked[] = [], unavailable: string[] = []
  const end = mission.row + mission.c.missionDays * 24
  for (const s of series) {
    if (!Number.isInteger(mission.row) || mission.row < 0 || end > s.hours) { unavailable.push(s.slug); continue }
    ranked.push({ slug: s.slug, result: evaluateWindow(s, mission.row, end, mission.c) })
  }
  ranked.sort((a, b) => Number(b.result.pass) - Number(a.result.pass) || b.result.margin - a.result.margin || a.slug.localeCompare(b.slug))
  return { ranked, unavailable, passing: ranked.filter(r => r.result.pass).length }
}

/** Tie evidence only; this does not change the dashboard's deterministic ordering. */
export function intakeRankingTie(ranked: IntakeRanked[]): number {
  const first = ranked[0]?.result
  if (!first || !Number.isFinite(first.margin)) return 0
  return ranked.filter(r => r.result.pass === first.pass && Math.abs(r.result.margin - first.margin) <= 1e-9).length
}

/** Name the actual tightest check without presenting normalized margin as a probability. */
export function intakeMarginExplanation(r: Evaluated, c: Constraints): string | null {
  const comparison = (value: number, limit: number, label: string, unit: string, target: string) => Number.isFinite(value) && Number.isFinite(limit)
    ? `The tightest check is ${label}: ${value.toFixed(placesFor(value, limit))}${unit} against your ${target} of ${limit}${unit}.`
    : null
  switch (r.limiting) {
    case 'battery': return r.power && c.power ? comparison(r.power.minPct, c.power.reservePct, 'battery reserve', '%', 'reserve') : null
    case 'lit': return comparison(r.litPct, c.minLitPct, 'sunlight', '%', 'minimum')
    case 'dark': return comparison(r.longestDarkH, c.maxDarkH, 'continuous darkness', ' h', 'maximum')
    case 'link': return comparison(r.linkPct, c.minLinkPct, 'Earth visibility', '%', 'minimum')
    case 'gap': return comparison(r.longestGapH, c.maxGapH, 'time without Earth', ' h', 'maximum')
    case 'thermal': return r.thermal && c.thermal ? comparison(r.thermal.minTempK - 273.15, c.thermal.survivalK - 273.15, 'temperature', ' °C', 'minimum') : null
  }
}

export function readIntakeDraft(text: string | null): IntakeDraft | null {
  if (!text || text.length > 4096) return null
  try {
    const doc = JSON.parse(text) as { v: number; draft: IntakeDraft }
    const d = doc.draft
    if (doc.v !== 1 || !d || typeof d.landingUTC !== 'string' || intakeUTC(d.landingUTC) === null || !Object.hasOwn(INTAKE_PURPOSES, d.purpose) || !['example', 'custom'].includes(d.equipment)) return null
    const numeric = ['missionDays', 'panelAreaM2', 'capacityKWh', 'loadW', 'reservePct', 'minLitPct', 'maxDarkH', 'minLinkPct', 'maxGapH'] as const
    if (numeric.some(key => typeof d[key] !== 'number' || !Number.isFinite(d[key]))) return null
    // Coverage belongs to the current dataset, not to a remembered browser draft.
    const span = 100000
    if (!validateIntake(d, intakeUTC(d.landingUTC)!, span).ok) return null
    return { landingUTC: d.landingUTC, purpose: d.purpose, equipment: d.equipment, ...Object.fromEntries(numeric.map(key => [key, d[key]])) } as IntakeDraft
  } catch { return null }
}

export function intakeLimitingReason(r: Evaluated, c: Constraints): string {
  if (r.pass) return 'Every enabled requirement is met for this date, duration and lander.'
  switch (r.limiting) {
    case 'battery': return `Battery reaches ${r.power?.minPct.toFixed(1) ?? 'unknown'}%; your reserve is ${c.power?.reservePct ?? 0}%.`
    case 'lit': return `Sunlight covers ${r.litPct.toFixed(1)}% of the mission; you asked for at least ${c.minLitPct}%.`
    case 'dark': return `The longest darkness is ${r.longestDarkH} h; your limit is ${c.maxDarkH} h.`
    case 'link': return `Earth is in view for ${r.linkPct.toFixed(1)}% of the mission; you asked for at least ${c.minLinkPct}%.`
    case 'gap': return `The longest time without Earth is ${r.longestGapH} h; your limit is ${c.maxGapH} h.`
    case 'thermal': return 'The enabled thermal requirement is not met.'
  }
}
