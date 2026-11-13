import type { Constraints, Evaluated } from './solver.ts'

/**
 * Plain-language verdict for one landing: why it passes or fails, the smallest remaining margin,
 * and what the result does not cover. Pure, so the wording can be checked against the numbers.
 * A pass only ever means "meets the requirements you selected", never "the mission works".
 * The limits are the visitor's own selections, not NASA requirements or safety limits.
 */
export type VerdictText = { headline: string; why: string; marginLabel: string; margin: string; assessed: string[]; notAssessed: string[] }

const c1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Fewest decimals (0–2) at which a value and its limit no longer look equal, so a failing 19.6% is
 * never shown as "20%, below your 20% reserve". Exactly equal values keep whole numbers.
 */
export function placesFor(value: number, limit: number): number {
  if (value === limit) return 0
  for (let d = 0; d < 2; d++) if (value.toFixed(d) !== limit.toFixed(d)) return d
  return 2
}
const show = (value: number, limit: number) => value.toFixed(placesFor(value, limit))

/**
 * How a value stands against one of the visitor's requirements, in the right direction:
 * a minimum (reserve, sunlight, Earth in view, survival temperature) is met from above,
 * a maximum (darkness, time without Earth) from below. The gap uses the displayed precision.
 */
export function against(value: number, limit: number, kind: 'min' | 'max', unit: string, limitName: string): string {
  const d = placesFor(value, limit), gap = Math.abs(Number(value.toFixed(d)) - Number(limit.toFixed(d)))
  const ok = kind === 'min' ? value >= limit : value <= limit
  const size = gap.toFixed(d)
  if (Number(size) === 0) return ok ? `exactly at ${limitName}` : `just ${kind === 'min' ? 'below' : 'over'} ${limitName}`
  if (kind === 'min') return `${size} ${unit} ${ok ? 'above' : 'below'} ${limitName}`
  return `${size} ${unit} ${ok ? 'under' : 'over'} ${limitName}`
}

export function verdictText(ev: Evaluated, c: Constraints): VerdictText {
  // Mission-relative hour → "day N" (hour 0–23.99 is day 1; the end boundary is still the last day).
  const day = (h: number) => `day ${Math.min(c.missionDays, Math.floor(Math.max(0, h) / 24) + 1)}`
  const degC = (k: number) => k - 273.15
  const failures: string[] = []
  if (ev.power && c.power && !ev.power.pass) failures.push(`the battery falls to ${show(ev.power.minPct, c.power.reservePct)}%, below your ${c.power.reservePct}% reserve${ev.power.firstReserveH !== null ? `, first on ${day(ev.power.firstReserveH)}` : ''}${ev.power.unmetWh > 1e-8 ? `, and ${ev.power.unmetWh >= 1000 ? `${(ev.power.unmetWh / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kWh` : `${ev.power.unmetWh.toFixed(0)} Wh`} of demand goes unmet` : ''}`)
  if (ev.thermal && c.thermal && !ev.thermal.pass) failures.push(`the electronics cool to ${show(degC(ev.thermal.minTempK), degC(c.thermal.survivalK))} °C, below the ${Math.round(degC(c.thermal.survivalK))} °C survival temperature${ev.thermal.firstFreezeH !== null ? ` on ${day(ev.thermal.firstFreezeH)}` : ''}`)
  if (!ev.ok.dark) failures.push(`the longest darkness lasts ${ev.longestDarkH} h, over your ${c.maxDarkH} h limit`)
  if (!ev.ok.lit) failures.push(`the Sun is up for ${show(ev.litPct, c.minLitPct)}% of the mission, below your ${c.minLitPct}% minimum`)
  if (!ev.ok.gap) failures.push(`Earth is hidden for up to ${ev.longestGapH} h at a time, over your ${c.maxGapH} h limit`)
  if (!ev.ok.link) failures.push(`Earth is in view for ${show(ev.linkPct, c.minLinkPct)}% of the mission, below your ${c.minLinkPct}% minimum`)

  const why = failures.length
    ? `${c1(failures.join('; '))}.`
    : `Every check you turned on passes for the whole ${c.missionDays}-day mission.`

  // The tightest check: how far it is from the visitor's limit, in the direction that matters.
  const margin = (() => {
    switch (ev.limiting) {
      case 'battery': return ev.power && c.power ? `Battery: lowest charge ${show(ev.power.minPct, c.power.reservePct)}% against your ${c.power.reservePct}% reserve (${against(ev.power.minPct, c.power.reservePct, 'min', 'percentage points', 'your reserve')}).` : 'Battery not assessed.'
      case 'thermal': return ev.thermal && c.thermal ? `Night survival: coldest ${show(degC(ev.thermal.minTempK), degC(c.thermal.survivalK))} °C against a ${Math.round(degC(c.thermal.survivalK))} °C survival temperature (${against(ev.thermal.minTempK, c.thermal.survivalK, 'min', 'K', 'the survival temperature')}).` : 'Night survival not assessed.'
      case 'dark': return `Darkness: longest ${ev.longestDarkH} h against your ${c.maxDarkH} h limit (${against(ev.longestDarkH, c.maxDarkH, 'max', 'h', 'your limit')}).`
      case 'gap': return `Earth gap: longest ${ev.longestGapH} h against your ${c.maxGapH} h limit (${against(ev.longestGapH, c.maxGapH, 'max', 'h', 'your limit')}).`
      case 'lit': return `Sunlight: ${show(ev.litPct, c.minLitPct)}% against your ${c.minLitPct}% minimum (${against(ev.litPct, c.minLitPct, 'min', 'percentage points', 'your minimum')}).`
      case 'link': return `Earth in view: ${show(ev.linkPct, c.minLinkPct)}% against your ${c.minLinkPct}% minimum (${against(ev.linkPct, c.minLinkPct, 'min', 'percentage points', 'your minimum')}).`
    }
  })()

  const assessed = ['Sunlight', 'Earth visibility', ...(c.power ? ['Battery'] : []), ...(c.thermal ? ['Night survival'] : [])]
  const notAssessed = [
    ...(c.power ? [] : ['Battery (turned off)']),
    ...(c.thermal ? [] : ['Night survival (turned off)']),
    'Radio link budget (shown separately, not in the verdict)',
    'Landing hazards, slope and roughness',
  ]
  return { headline: failures.length ? 'Misses your selected requirements' : 'Meets your selected requirements', why, marginLabel: failures.length ? 'Biggest shortfall' : 'Smallest margin', margin, assessed, notAssessed }
}
