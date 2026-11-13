/**
 * Mission Architect solver.
 *
 * Pure, dependency-free functions that slide a mission-length window across the
 * cached hourly Sun/Earth series of every landing site and test it against
 * user-set constraints.
 *
 * Nothing here computes astronomy. It only READS the already-computed ephemeris
 * and LOLA horizon masks, and classifies each hour exactly the way
 * scripts/compute_duty_cycle.py and the app do:
 *
 *   LIT(t)  = sun_el(t)   > horizon_el(sun_az(t))
 *   LINK(t) = earth_el(t) > horizon_el(earth_az(t))
 *
 * Geometry and energy modules are dependency-free and also run in Node.
 */
import type { EphRow, Horizon } from '../data'
import { sunlightFraction, solarFluxScale, centerVisible, horizonElevation } from '../lib/science.ts'
import { generationFor, simulatePower, type PowerConfig, type PowerSummary, type SolarSeries } from './power.ts'
import { simulateThermal, type ThermalConfig, type ThermalSummary } from './thermal.ts'

/** Half-open [start, end) range of hour-rows where a condition holds. */
export type Run = [number, number]

export type SiteSeries = {
  slug: string
  solar: SolarSeries
  hours: number
  litPrefix: Int32Array
  linkPrefix: Int32Array
  litRuns: Run[]
  darkRuns: Run[]
  linkRuns: Run[]
  gapRuns: Run[]
}

function prefixSums(flags: Uint8Array): Int32Array {
  const out = new Int32Array(flags.length + 1)
  for (let i = 0; i < flags.length; i++) out[i + 1] = out[i] + flags[i]
  return out
}

function runsOf(flags: Uint8Array, value: 0 | 1): Run[] {
  const runs: Run[] = []
  let start = -1
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === value) {
      if (start < 0) start = i
    } else if (start >= 0) {
      runs.push([start, i])
      start = -1
    }
  }
  if (start >= 0) runs.push([start, flags.length])
  return runs
}

export function buildSeries(
  slug: string,
  sun: EphRow[],
  earth: EphRow[],
  horizon: Horizon,
): SiteSeries {
  if (sun.length !== earth.length || sun.length < 2 || horizon.profile.length !== 360) throw new Error('Incomplete site data')
  const n = sun.length - 1 // final sample is the end boundary, not another hour
  const solar: SolarSeries = { azimuth: new Float64Array(n), elevation: new Float64Array(n), fraction: new Float64Array(n), fluxScale: new Float64Array(n) }
  const lit = new Uint8Array(n)
  const link = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (sun[i].t !== earth[i].t) throw new Error('Sun/Earth epochs do not align')
    const hz = horizonElevation(horizon.profile, sun[i].az)
    lit[i] = centerVisible(sun[i].el, hz) ? 1 : 0
    link[i] = centerVisible(earth[i].el, horizonElevation(horizon.profile, earth[i].az)) ? 1 : 0
    solar.azimuth[i] = sun[i].az
    solar.elevation[i] = sun[i].el
    solar.fraction[i] = sunlightFraction(sun[i], earth[i], hz)
    solar.fluxScale![i] = solarFluxScale(sun[i])
  }
  return {
    slug,
    solar,
    hours: n,
    litPrefix: prefixSums(lit),
    linkPrefix: prefixSums(link),
    litRuns: runsOf(lit, 1),
    darkRuns: runsOf(lit, 0),
    linkRuns: runsOf(link, 1),
    gapRuns: runsOf(link, 0),
  }
}

/** Longest stretch of a run list that lies inside [s, e), clipped to the window. */
function longestClipped(runs: Run[], s: number, e: number): number {
  let lo = 0
  let hi = runs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (runs[mid][1] > s) hi = mid
    else lo = mid + 1
  }
  let best = 0
  for (let i = lo; i < runs.length && runs[i][0] < e; i++) {
    const len = Math.min(runs[i][1], e) - Math.max(runs[i][0], s)
    if (len > best) best = len
  }
  return best
}

export type WindowStats = {
  startRow: number
  /** Exclusive end row. */
  endRow: number
  hours: number
  litHours: number
  linkHours: number
  litPct: number
  linkPct: number
  longestLitH: number
  longestDarkH: number
  longestLinkH: number
  longestGapH: number
}

/** Metrics for the hour-rows [s, e) of one site. */
export function windowStats(series: SiteSeries, s: number, e: number): WindowStats {
  if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e <= s || e > series.hours) throw new Error('Invalid mission window')
  const hours = e - s
  const litHours = series.litPrefix[e] - series.litPrefix[s]
  const linkHours = series.linkPrefix[e] - series.linkPrefix[s]
  return {
    startRow: s,
    endRow: e,
    hours,
    litHours,
    linkHours,
    litPct: (100 * litHours) / hours,
    linkPct: (100 * linkHours) / hours,
    longestLitH: longestClipped(series.litRuns, s, e),
    longestDarkH: longestClipped(series.darkRuns, s, e),
    longestLinkH: longestClipped(series.linkRuns, s, e),
    longestGapH: longestClipped(series.gapRuns, s, e),
  }
}

/** User-set mission requirements. These are NOT NASA requirements. */
export type Constraints = {
  missionDays: number
  power?: PowerConfig
  /** Survival-heating model. Only active alongside `power` (heaters draw the battery). */
  thermal?: ThermalConfig
  minLitPct: number
  maxDarkH: number
  minLinkPct: number
  maxGapH: number
}

export type Binding = 'lit' | 'dark' | 'link' | 'gap'

export type Evaluated = WindowStats & {
  power?: PowerSummary
  thermal?: ThermalSummary
  limiting: Binding | 'battery' | 'thermal'
  /**
   * Normalised slack per constraint, as a fraction of the whole mission:
   * percentage points / 100 for the two "at least" limits, hours / mission hours
   * for the two "at most" limits. Negative means the constraint is violated.
   */
  slack: Record<Binding, number>
  /** Pass/fail per constraint, from exact comparisons (no float edge cases). */
  ok: Record<Binding, boolean>
  /** Smallest slack: how close the tightest constraint is. >= 0 when passing. */
  margin: number
  /** The most limiting constraint. */
  binding: Binding
  pass: boolean
}

/** Windows failing by less than this much of the mission count as "near misses". */
export const NEAR_MISS = 0.1

export function evaluate(stats: WindowStats, c: Constraints, power?: PowerSummary, thermal?: ThermalSummary): Evaluated {
  const slack: Record<Binding, number> = {
    lit: (stats.litPct - c.minLitPct) / 100,
    dark: (c.maxDarkH - stats.longestDarkH) / stats.hours,
    link: (stats.linkPct - c.minLinkPct) / 100,
    gap: (c.maxGapH - stats.longestGapH) / stats.hours,
  }
  const ok: Record<Binding, boolean> = {
    lit: stats.litHours * 100 >= c.minLitPct * stats.hours,
    dark: stats.longestDarkH <= c.maxDarkH,
    link: stats.linkHours * 100 >= c.minLinkPct * stats.hours,
    gap: stats.longestGapH <= c.maxGapH,
  }
  const pass = ok.lit && ok.dark && ok.link && ok.gap && (!power || power.pass) && (!thermal || thermal.pass)
  let binding: Binding = 'lit'
  let margin = slack.lit
  for (const k of ['dark', 'link', 'gap'] as const) {
    if (slack[k] < margin) {
      margin = slack[k]
      binding = k
    }
  }
  // The visibility binding, battery reserve and thermal survival share one
  // normalized-slack ranking; the smallest is the limiting constraint.
  let limiting: Binding | 'battery' | 'thermal' = binding
  if (power && power.margin < margin) { margin = power.margin; limiting = 'battery' }
  if (thermal && thermal.margin < margin) { margin = thermal.margin; limiting = 'thermal' }
  if (pass && margin < 0) margin = 0 // float fuzz at an exact boundary
  return { ...stats, slack, ok, margin, binding, limiting, power, thermal, pass }
}

/** Shared evaluation for search, inspection, and sensitivity checks. */
export function evaluateWindow(series: SiteSeries, start: number, end: number, c: Constraints): Evaluated {
  const thermal = c.thermal && c.power ? simulateThermal(series.solar, start, end, c.thermal, c.power.loadW) : undefined
  const power = c.power ? simulatePower(generationFor(series.solar, c.power), start, end, c.power, false, thermal?.heaterW) : undefined
  return evaluate(windowStats(series, start, end), c, power, thermal)
}

export type SearchRange = {
  /** First landing row to try. */
  firstStart: number
  /** Last landing row to try (clamped so the whole mission fits in the data). */
  lastStart: number
  /** Step between candidate landing times, in hours. */
  stepH: number
}

/** Strip cell states. */
export const CELL_FAIL = 0
export const CELL_NEAR = 1
export const CELL_PASS = 2

export type Opportunity = {
  slug: string
  /** First and last landing row of a contiguous run of passing landings. */
  firstStartRow: number
  lastStartRow: number
  /** How many candidate landings in the run pass. */
  startCount: number
  /** The passing landing with the largest margin (earliest on ties). */
  best: Evaluated
}

export type Closest = { slug: string; best: Evaluated }

export type SolveResult = {
  constraints: Constraints
  range: SearchRange
  missionHours: number
  /** Candidate landing rows, in order. strips[slug][i] belongs to starts[i]. */
  starts: number[]
  strips: Record<string, Uint8Array>
  /** Contiguous passing runs across all sites, best margin first. */
  opportunities: Opportunity[]
  /** Per site: the single best-margin window, whether or not it passes. Best first. */
  closest: Closest[]
  /** Number of passing (site, landing) pairs. */
  passCount: number
  ms: number
}

export function maxLastStart(series: SiteSeries[], missionHours: number): number {
  const n = Math.min(...series.map((s) => s.hours))
  return n - missionHours
}

export function solve(series: SiteSeries[], c: Constraints, range: SearchRange): SolveResult {
  if (!series.length || !Number.isFinite(c.missionDays) || c.missionDays <= 0 || Math.round(c.missionDays * 24) < 1 ||
      !Number.isInteger(range.firstStart) || !Number.isInteger(range.lastStart) || !Number.isInteger(range.stepH) || range.stepH < 1) {
    throw new Error('Invalid mission search range')
  }
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const missionHours = Math.round(c.missionDays * 24)
  const last = Math.min(range.lastStart, maxLastStart(series, missionHours))
  const first = Math.max(0, range.firstStart)
  const step = Math.max(1, range.stepH)

  const starts: number[] = []
  for (let r = first; r <= last; r += step) starts.push(r)

  const strips: Record<string, Uint8Array> = {}
  const opportunities: Opportunity[] = []
  const closest: Closest[] = []
  let passCount = 0

  for (const s of series) {
    const strip = new Uint8Array(starts.length)
    let bestAny: Evaluated | null = null
    let run: { first: number; last: number; count: number; best: Evaluated } | null = null

    const flush = () => {
      if (run) {
        opportunities.push({
          slug: s.slug,
          firstStartRow: run.first,
          lastStartRow: run.last,
          startCount: run.count,
          best: run.best,
        })
        run = null
      }
    }

    for (let i = 0; i < starts.length; i++) {
      const ev = evaluateWindow(s, starts[i], starts[i] + missionHours, c)
      if (bestAny === null || (ev.pass && !bestAny.pass) || (ev.pass === bestAny.pass && ev.margin > bestAny.margin)) bestAny = ev
      if (ev.pass) {
        strip[i] = CELL_PASS
        passCount++
        if (run === null) run = { first: starts[i], last: starts[i], count: 1, best: ev }
        else {
          run.last = starts[i]
          run.count++
          if (ev.margin > run.best.margin) run.best = ev
        }
      } else {
        strip[i] = ev.margin >= -NEAR_MISS ? CELL_NEAR : CELL_FAIL
        flush()
      }
    }
    flush()
    strips[s.slug] = strip
    if (bestAny) closest.push({ slug: s.slug, best: bestAny })
  }

  opportunities.sort(
    (a, b) =>
      b.best.margin - a.best.margin ||
      b.startCount - a.startCount ||
      a.firstStartRow - b.firstStartRow ||
      a.slug.localeCompare(b.slug),
  )
  closest.sort((a, b) => Number(b.best.pass) - Number(a.best.pass) || b.best.margin - a.best.margin || a.slug.localeCompare(b.slug))

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  return {
    constraints: c,
    range: { firstStart: first, lastStart: last, stepH: step },
    missionHours,
    starts,
    strips,
    opportunities,
    closest,
    passCount,
    ms: t1 - t0,
  }
}

export type Relaxation = {
  binding: Binding
  /** the site where the relaxed window lives */
  slug: string
  /** the user's requested value */
  requested: number
  /** smallest (for "at least") / largest (for "at most") value of THIS
   *  constraint alone — every other constraint intact — that opens a window */
  relaxedTo: number
  /** a window that becomes feasible under relaxedTo (best margin) */
  window: Evaluated
  unit: '%' | 'h'
  direction: 'at least' | 'at most'
}

function anyPass(
  series: SiteSeries[],
  c: Constraints,
  range: SearchRange,
): { ev: Evaluated; slug: string } | null {
  const missionHours = Math.round(c.missionDays * 24)
  const last = Math.min(range.lastStart, maxLastStart(series, missionHours))
  const first = Math.max(0, range.firstStart)
  const step = Math.max(1, range.stepH)
  let best: { ev: Evaluated; slug: string } | null = null
  for (const s of series) {
    for (let r = first; r <= last; r += step) {
      const ev = evaluateWindow(s, r, r + missionHours, c)
      if (ev.pass && (best === null || ev.margin > best.ev.margin)) best = { ev, slug: s.slug }
    }
  }
  return best
}

const round1 = (v: number) => Math.round(v * 10) / 10

/**
 * When the solve finds nothing: for each constraint, the smallest single
 * change that opens a window, with every OTHER constraint left intact.
 * Binary search on the threshold — O(log range) solve passes each.
 *
 * Relaxing a constraint makes the REQUIREMENTS feasible, not the mission
 * safe — the operator decides whether the trade is acceptable.
 */
export function minimalRelaxations(
  series: SiteSeries[],
  c: Constraints,
  range: SearchRange,
): Relaxation[] {
  const missionHours = Math.round(c.missionDays * 24)
  const maxSpan = Math.min(...series.map((s) => s.hours))

  /**
   * Binary search the threshold. `bad` (the user's request) is assumed
   * infeasible, `good` (max relaxation) feasible. For "at least" constraints
   * smaller values are easier — we want the LARGEST still-feasible value;
   * for "at most", larger are easier — the SMALLEST still-feasible one.
   */
  const search = (
    probe: (v: number) => Constraints,
    bad: number,
    good: number,
    decimals: 0 | 1,
  ): { value: number; window: Evaluated; slug: string } | null => {
    const mid = (lo: number, hi: number) =>
      decimals === 0 ? Math.round((lo + hi) / 2) : round1((lo + hi) / 2)
    const goodWin = anyPass(series, probe(good), range)
    if (!goodWin) return null
    const badWin = anyPass(series, probe(bad), range)
    if (badWin) return { value: bad, window: badWin.ev, slug: badWin.slug }
    let lo = bad // infeasible
    let hi = good // feasible
    for (let i = 0; i < 20; i++) {
      const m = mid(lo, hi)
      if (m === lo || m === hi) break
      const w = anyPass(series, probe(m), range)
      if (w) hi = m
      else lo = m
    }
    const win = anyPass(series, probe(hi), range)
    return win ? { value: hi, window: win.ev, slug: win.slug } : null
  }

  const out: Relaxation[] = []

  // lit: "at least this much sunlight" — relax downward
  const lit = search((v) => ({ ...c, minLitPct: v }), Math.floor(c.minLitPct), 0, 0)
  if (lit)
    out.push({ binding: 'lit', slug: lit.slug, requested: c.minLitPct, relaxedTo: lit.value, window: lit.window, unit: '%', direction: 'at least' })

  // dark: "at most this much darkness" — relax upward (cap: half the mission)
  const darkCap = Math.min(maxSpan, Math.ceil(missionHours / 2))
  if (c.maxDarkH < darkCap) {
    const dark = search((v) => ({ ...c, maxDarkH: v }), c.maxDarkH, darkCap, 0)
    if (dark)
      out.push({ binding: 'dark', slug: dark.slug, requested: c.maxDarkH, relaxedTo: dark.value, window: dark.window, unit: 'h', direction: 'at most' })
  }

  // link: "at least this much Earth link" — relax downward
  const link = search((v) => ({ ...c, minLinkPct: v }), Math.floor(c.minLinkPct), 0, 0)
  if (link)
    out.push({ binding: 'link', slug: link.slug, requested: c.minLinkPct, relaxedTo: link.value, window: link.window, unit: '%', direction: 'at least' })

  // gap: "at most this comm gap" — relax upward
  const gapCap = Math.min(maxSpan, Math.ceil(missionHours / 2))
  if (c.maxGapH < gapCap) {
    const gap = search((v) => ({ ...c, maxGapH: v }), c.maxGapH, gapCap, 0)
    if (gap)
      out.push({ binding: 'gap', slug: gap.slug, requested: c.maxGapH, relaxedTo: gap.value, window: gap.window, unit: 'h', direction: 'at most' })
  }

  return out.sort((a, b) => {
    const fa = a.unit === '%' ? Math.abs(a.relaxedTo - a.requested) / Math.max(1, a.requested) : Math.abs(a.relaxedTo - a.requested) / missionHours
    const fb = b.unit === '%' ? Math.abs(b.relaxedTo - b.requested) / Math.max(1, b.requested) : Math.abs(b.relaxedTo - b.requested) / missionHours
    return fa - fb // smallest relative sacrifice first
  })
}
