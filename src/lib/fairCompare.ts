import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from '../architect/solver.ts'
import { generationDifference } from '../architect/comparisonContext.ts'
import { centerVisible, horizonElevation } from './science.ts'
import { dayOf, deg, missionTimeline, type MissionTimeline } from './missionMoment.ts'

/**
 * Fair comparisons: two options that differ in exactly one thing. "Two sites" keeps the landing
 * time; "two dates" keeps the site. The lander, mission length and requirements are the same for
 * both, so every difference below comes from that one change. Pure, so the wording can be checked
 * against the numbers.
 */
type SkyRow = { az: number; el: number }
export type FairMode = 'sites' | 'dates'
/** label heads a line ("7 Nov landing"); ref is how a sentence names it ("the 7 Nov landing"), defaulting to label. */
export type FairSide = { label: string; ref?: string; site: string; slug: string; row: number; series: SiteSeries; sunRows: SkyRow[]; earthRows: SkyRow[]; horizon: { profile: number[] } }
export type Change = 'better' | 'worse' | 'same'
export type MetricChange = { id: string; label: string; a: string; b: string; change: Change; diff: string }
export type FairResult = {
  mode: FairMode
  evA: Evaluated | null; evB: Evaluated | null
  tlA: MissionTimeline | null; tlB: MissionTimeline | null
  same: string[]; differs: string
  metrics: MetricChange[]
  verdict: string; summary: string; why: string[]
}

const ref = (s: FairSide) => s.ref ?? s.label
const Ref = (s: FairSide) => ref(s).charAt(0).toUpperCase() + ref(s).slice(1)
const fits = (s: FairSide, c: Constraints) => Number.isInteger(s.row) && s.row >= 0 && s.row + c.missionDays * 24 <= s.series.hours
const kwh = (wh: number) => `${(wh / 1000).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kWh`

type Metric = { id: string; label: string; value: (e: Evaluated) => number | null; higherIsBetter: boolean; tol: number; show: (v: number) => string; words: [string, string]; unit: string; digits: number }
const METRICS: Metric[] = [
  { id: 'battery', label: 'Lowest battery charge', value: e => e.power?.minPct ?? null, higherIsBetter: true, tol: 0.5, show: v => `${v.toFixed(0)}%`, words: ['higher', 'lower'], unit: 'points', digits: 0 },
  { id: 'unmet', label: 'Demand the battery could not cover', value: e => e.power ? e.power.unmetWh : null, higherIsBetter: false, tol: 50, show: kwh, words: ['more', 'less'], unit: 'kWh', digits: 1 },
  { id: 'energy', label: 'Solar energy collected', value: e => e.power ? e.power.generatedWh : null, higherIsBetter: true, tol: 50, show: kwh, words: ['more', 'less'], unit: 'kWh', digits: 1 },
  { id: 'lit', label: 'Sunlight', value: e => e.litPct, higherIsBetter: true, tol: 0.5, show: v => `${v.toFixed(0)}% of the time`, words: ['more', 'less'], unit: 'points', digits: 0 },
  { id: 'dark', label: 'Longest darkness', value: e => e.longestDarkH, higherIsBetter: false, tol: 0.5, show: v => `${v.toFixed(0)} h`, words: ['longer', 'shorter'], unit: 'h', digits: 0 },
  { id: 'link', label: 'Earth in view', value: e => e.linkPct, higherIsBetter: true, tol: 0.5, show: v => `${v.toFixed(0)}% of the time`, words: ['more', 'less'], unit: 'points', digits: 0 },
  { id: 'gap', label: 'Longest time without Earth', value: e => e.longestGapH, higherIsBetter: false, tol: 0.5, show: v => `${v.toFixed(0)} h`, words: ['longer', 'shorter'], unit: 'h', digits: 0 },
  { id: 'cold', label: 'Coldest electronics', value: e => e.thermal ? e.thermal.minTempK - 273.15 : null, higherIsBetter: true, tol: 0.5, show: v => `${v.toFixed(0)} °C`, words: ['warmer', 'colder'], unit: '°C', digits: 0 },
]

/** Same lander, same mission, one change. `fmt` formats an absolute row as a UTC time; `equipment` describes the lander. */
export function compareFairly(mode: FairMode, A: FairSide, B: FairSide, c: Constraints, fmt: (row: number) => string, equipment: string): FairResult {
  const evA = fits(A, c) ? evaluateWindow(A.series, A.row, A.row + c.missionDays * 24, c) : null
  const evB = fits(B, c) ? evaluateWindow(B.series, B.row, B.row + c.missionDays * 24, c) : null
  const tlA = evA ? missionTimeline(A.series, A.row, c) : null, tlB = evB ? missionTimeline(B.series, B.row, c) : null
  const apart = Math.round((B.row - A.row) / 24 * 10) / 10
  const same = mode === 'sites'
    ? [`Landing ${fmt(A.row)}`, `${c.missionDays}-day mission`, equipment, 'Your requirements']
    : [`Site: ${A.site}`, `${c.missionDays}-day mission`, equipment, 'Your requirements']
  const differs = mode === 'sites' ? `Site: ${A.label} → ${B.label}`
    : `Landing: ${fmt(A.row)} → ${fmt(B.row)}${apart ? ` (${Math.abs(apart)} day${Math.abs(apart) === 1 ? '' : 's'} ${apart > 0 ? 'later' : 'earlier'})` : ''}`

  const metrics: MetricChange[] = !evA || !evB ? [] : METRICS.flatMap(m => {
    const a = m.value(evA), b = m.value(evB)
    if (a === null || b === null) return []
    const d = b - a, scale = m.unit === 'kWh' ? 1000 : 1
    const change: Change = Math.abs(d) < m.tol ? 'same' : (d > 0) === m.higherIsBetter ? 'better' : 'worse'
    const size = Math.abs(d) / scale
    const diff = change === 'same' ? 'about the same' : `${size.toLocaleString('en-US', { minimumFractionDigits: m.digits, maximumFractionDigits: m.digits })} ${m.unit} ${d > 0 ? m.words[0] : m.words[1]}`
    return [{ id: m.id, label: m.label, a: m.show(a), b: m.show(b), change, diff }]
  })

  const verdict = !evA || !evB
    ? `${Ref(!evA ? A : B)} cannot be checked: the mission runs past the cached data.`
    : evA.pass && evB.pass ? 'Both meet your selected requirements.'
    : !evA.pass && !evB.pass ? 'Neither meets your selected requirements.'
    : `Only ${ref(evA.pass ? A : B)} meets your selected requirements.`
  const count = (k: Change) => metrics.filter(x => x.change === k).length
  const better = count('better'), worse = count('worse'), even = count('same')
  const summary = !metrics.length ? '' : better + worse === 0 ? `${Ref(B)} and ${ref(A)} come out the same on every measure.`
    : `Compared with ${ref(A)}, ${ref(B)} is ${listing([better ? `better on ${plural(better, 'measure')}` : '', worse ? `worse on ${plural(worse, 'measure')}` : '', even ? `about the same on ${plural(even, 'measure')}` : ''])}.`

  return { mode, evA, evB, tlA, tlB, same, differs, metrics, verdict, summary, why: evA && evB && tlA && tlB ? reasons(mode, A, B, c, evA, evB, tlA, tlB, fmt) : [] }
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
/** 'a', 'a and b', 'a, b and c' (empty parts dropped). */
const listing = (parts: string[]) => { const p = parts.filter(Boolean); return p.length < 2 ? p.join('') : `${p.slice(0, -1).join(', ')} and ${p.at(-1)}` }

/** Why the two differ, using only computed facts: the skyline where the Sun or Earth disappears, the energy attribution and battery timing. */
function reasons(mode: FairMode, A: FairSide, B: FairSide, c: Constraints, evA: Evaluated, evB: Evaluated, tlA: MissionTimeline, tlB: MissionTimeline, fmt: (row: number) => string) {
  const out: string[] = [mode === 'sites'
    ? 'Both missions run over the same dates, so every difference comes from where each site is and the hills around it (its skyline).'
    : 'Same site, so the hills around it are the same. Every difference comes from where the Sun and Earth are in the sky during each mission.']
  const day = (s: FairSide, r: number) => dayOf(r - s.row, c.missionDays)
  const block = (s: FairSide, run: [number, number] | null, rows: SkyRow[], body: 'Sun' | 'Earth', what: string, hours: number) => {
    if (!run || hours === 0) return `${s.label}: ${body === 'Sun' ? 'the Sun' : 'Earth'} never goes below the skyline during the mission.`
    const r = run[0], b = rows[r], sky = horizonElevation(s.horizon.profile, b.az)
    const at = r === s.row ? 'is already under way at landing' : `begins on day ${day(s, r)} (${fmt(r)})`
    const fine = Math.abs(b.el - sky) < 0.1, level = deg(b.el, fine) === deg(sky, fine)
    return `${s.label}: the ${what}, ${hours} h, ${at}. ${body === 'Sun' ? 'The Sun' : 'Earth'} is ${deg(b.el, fine)} high at bearing ${b.az.toFixed(0)}°, ${level ? 'just' : ''}${centerVisible(b.el, sky) ? (level ? ' above' : 'above') : (level ? ' below' : 'below')} the skyline there (${deg(sky, fine)}).`
  }
  if (evA.longestDarkH === evB.longestDarkH) out.push(`Both have the same longest darkness: ${evA.longestDarkH} h.`)
  else {
    // The battery note belongs to the side with the longer darkness: that is the stretch it must bridge.
    const bridge = c.power ? ' The battery has to carry the lander through it.' : ''
    out.push(block(A, tlA.dark, A.sunRows, 'Sun', 'longest darkness', evA.longestDarkH) + (evA.longestDarkH > evB.longestDarkH ? bridge : ''))
    out.push(block(B, tlB.dark, B.sunRows, 'Sun', 'longest darkness', evB.longestDarkH) + (evB.longestDarkH > evA.longestDarkH ? bridge : ''))
  }
  if (evA.longestGapH === evB.longestGapH) out.push(`Both have the same longest time without Earth: ${evA.longestGapH} h.`)
  else {
    out.push(block(A, tlA.gap, A.earthRows, 'Earth', 'longest time without Earth', evA.longestGapH))
    out.push(block(B, tlB.gap, B.earthRows, 'Earth', 'longest time without Earth', evB.longestGapH))
  }
  if (c.power && evA.power && evB.power) {
    const energy = generationDifference({ id: 0, slug: A.slug, row: A.row, c }, { id: 1, slug: B.slug, row: B.row, c }, A.series, B.series)
    if (energy && Math.abs(energy.totalWh) >= 50) {
      const NAMES: Record<string, string> = { 'Sun distance': 'the Sun’s distance', 'Panel incidence': 'the angle of sunlight on the panel', 'Terrain / eclipse exposure': 'hills and eclipses blocking the Sun' }
      const parts = [...energy.contributions].sort((x, y) => Math.abs(y.wh) - Math.abs(x.wh))
      const signed = (wh: number) => `${wh >= 0 ? '+' : '−'}${kwh(Math.abs(wh))}`
      const rest = parts.slice(1).filter(x => Math.abs(x.wh) >= 50)
      out.push(`${Ref(B)} collects ${kwh(Math.abs(energy.totalWh))} ${energy.totalWh > 0 ? 'more' : 'less'} solar energy. ${rest.length ? `Most of the difference comes from ${NAMES[parts[0].label] ?? parts[0].label} (${signed(parts[0].wh)}); ${rest.map(x => `${NAMES[x.label] ?? x.label} ${signed(x.wh)}`).join(', ')}.` : `Practically all of it comes from ${NAMES[parts[0].label] ?? parts[0].label}.`} This splits the model’s result by cause; it is not a measurement.`)
    }
    const low = (s: FairSide, t: MissionTimeline, e: Evaluated) => {
      const r = t.lowest?.row ?? s.row, inDark = !!t.dark && r >= t.dark[0] && r <= t.dark[1]
      return `${s.label} ${e.power!.minPct.toFixed(0)}% on day ${day(s, r)}${inDark ? (r === t.dark![1] ? ', at the end of its longest darkness' : ', during its longest darkness') : ''}`
    }
    out.push(`Lowest battery: ${low(A, tlA, evA)}; ${low(B, tlB, evB)}.`)
  }
  return out
}

/** The best other site for the same landing: one that meets the requirements first, then the largest margin. */
export function bestOtherSite(all: SiteSeries[], exclude: string, row: number, c: Constraints): string | null {
  let best: { slug: string; pass: boolean; margin: number } | null = null
  for (const s of all) {
    if (s.slug === exclude || row < 0 || row + c.missionDays * 24 > s.hours) continue
    const e = evaluateWindow(s, row, row + c.missionDays * 24, c)
    if (!best || Number(e.pass) > Number(best.pass) || (e.pass === best.pass && e.margin > best.margin)) best = { slug: s.slug, pass: e.pass, margin: e.margin }
  }
  return best?.slug ?? all.find(s => s.slug !== exclude)?.slug ?? null
}
