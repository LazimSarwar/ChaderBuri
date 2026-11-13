import { evaluateWindow, type Constraints, type Evaluated, type SiteSeries } from '../architect/solver.ts'
import { verdictText } from '../architect/verdictText.ts'
import { verifiedRepairs } from '../architect/comparison.ts'
import { EQUIPMENT_LIMITS, type GuideAction } from './guideAction.ts'
import { clearanceGap, dayOf, missionTimeline, momentAt, skylineSentence, type MissionTimeline } from './missionMoment.ts'
import type { FairResult } from './fairCompare.ts'

/**
 * Chader Buri's authored explanations: written from the same deterministic calculations as the
 * dashboard, no AI involved, so they work offline and cost no quota. Each one joins a cause, the
 * piece of evidence it highlights and a possible next step. Mission edits are calculated here too,
 * so what she reports after a change is the planner's own result.
 */
type SkyRow = { az: number; el: number }
export type MissionState = { slug: string; row: number; c: Constraints }
export type BriefTopic = 'verdict' | 'battery' | 'dark' | 'earth' | 'moment'
export type FocusTarget = 'verdict' | 'battery' | 'reserve' | 'dark' | 'gap' | 'lit' | 'link' | 'thermal' | 'moment' | 'metrics'
/** What to point at: a timeline interval or moment (mission hours), a requirement row, or comparison rows. */
export type GuideFocus = { target: FocusTarget; hour?: number; metrics?: string[] }
export type BriefOffer = { label: string; action: GuideAction }
export type GuideBrief = { question: string; answer: string; shown: string; next: string; focus: GuideFocus | null; offers: BriefOffer[]; scenario: string }
export type BriefInput = MissionState & { siteName: string; series: SiteSeries; sunRows: SkyRow[]; earthRows: SkyRow[]; horizon: { profile: number[] }; fmt: (row: number) => string }

const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v
/** Identity of a mission scenario: anything tied to an older key is retired. */
export const scenarioKey = (s: MissionState) => JSON.stringify(canonical({ slug: s.slug, row: s.row, c: s.c }))
const energy = (wh: number) => wh >= 1000 ? `${(wh / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })} kWh` : `${wh.toFixed(0)} Wh`
const watts = (w: number) => `${Math.round(w).toLocaleString('en-US')} W`
const hoursText = (h: number) => h >= 48 ? `${h} h (about ${(h / 24).toFixed(1)} days)` : `${h} h`
const shift = (n: number) => `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'later' : 'earlier'}`
const fits = (series: SiteSeries, row: number, c: Constraints) => Number.isInteger(row) && row >= 0 && row + c.missionDays * 24 <= series.hours
const evalAt = (series: SiteSeries, row: number, c: Constraints) => evaluateWindow(series, row, row + c.missionDays * 24, c)
/** The first failing check in a few words. */
export function shortfall(e: Evaluated) {
  return e.power && !e.power.pass ? `the battery falls to ${e.power.minPct.toFixed(0)}%` : !e.ok.dark ? `${e.longestDarkH} h of darkness` : !e.ok.gap ? `${e.longestGapH} h without Earth` : !e.ok.lit ? `only ${e.litPct.toFixed(0)}% sunlight` : !e.ok.link ? `Earth in view only ${e.linkPct.toFixed(0)}%` : e.thermal && !e.thermal.pass ? 'the electronics get too cold' : 'every check passes'
}
const result = (e: Evaluated) => e.power ? `lowest battery ${e.power.minPct.toFixed(0)}%` : `longest darkness ${e.longestDarkH} h, longest time without Earth ${e.longestGapH} h`

/** The nearest landing date at the same site that meets the requirements (within two weeks), if any. */
export function nearestPassingDate(series: SiteSeries, row: number, c: Constraints) {
  for (const n of [1, -1, 2, -2, 3, -3, 5, -5, 7, -7, 10, -10, 14, -14]) {
    const r = row + n * 24
    if (!fits(series, r, c)) continue
    const e = evalAt(series, r, c)
    if (e.pass) return { days: n, row: r, ev: e }
  }
  return null
}

/** What to try next for a mission that misses: a nearby date first, then one verified equipment change. */
function nextStep(p: BriefInput, ev: Evaluated): { next: string; offers: BriefOffer[] } {
  if (ev.pass) return { next: 'Would you like to see whether another site does better on the same dates?', offers: [{ label: 'Compare with another site', action: { kind: 'compareSites', value: '' } }] }
  const alt = nearestPassingDate(p.series, p.row, p.c)
  if (alt) return {
    next: `Landing ${shift(alt.days)} (${p.fmt(alt.row)}) would meet your requirements: ${result(alt.ev)}. Shall we compare the two dates?`,
    offers: [{ label: `Compare with the landing ${shift(alt.days)}`, action: { kind: 'compareDates', value: String(alt.days) } }, { label: `Use the landing ${shift(alt.days)}`, action: { kind: 'setLanding', value: String(alt.days) } }],
  }
  const repair = p.c.power ? verifiedRepairs(p.series, { id: 0, slug: p.slug, row: p.row, c: p.c })[0] : undefined
  if (repair && repair.value !== null) {
    const lim = EQUIPMENT_LIMITS[repair.key]
    if (lim && repair.value >= lim[0] && repair.value <= lim[1]) {
      const v = repair.key === 'panelAreaM2' ? Number(repair.value.toFixed(2)) : Math.round(repair.value)
      return { next: `No landing within two weeks of this one meets your requirements, but changing ${repair.label.toLowerCase()} to ${v.toLocaleString('en-US')} ${repair.unit} would. Shall I try it?`, offers: [{ label: `Try ${repair.label.toLowerCase()} ${v.toLocaleString('en-US')} ${repair.unit}`, action: { kind: 'setEquipment', value: `${repair.key}=${v}` } }] }
    }
  }
  return { next: 'No landing within two weeks of this one meets your requirements at this site. Shall we compare another site on the same dates?', offers: [{ label: 'Compare with another site', action: { kind: 'compareSites', value: '' } }] }
}

const darkCause = (p: BriefInput, tl: MissionTimeline) => {
  if (!tl.dark) return 'The Sun stays above the skyline for the whole mission.'
  const h = tl.dark[1] - tl.dark[0], sun = momentAt(tl, p.sunRows, p.earthRows, p.horizon, tl.dark[0] - p.row).sun
  return `The longest darkness lasts ${hoursText(h)}, from ${p.fmt(tl.dark[0])} to ${p.fmt(tl.dark[1])}. ${tl.dark[0] === p.row ? 'It is already under way at landing: ' : 'When it begins, '}${skylineSentence('The Sun', sun).replace(/^The Sun/, 'the Sun')}`
}
const earthCause = (p: BriefInput, tl: MissionTimeline) => {
  if (!tl.gap) return 'Earth stays above the skyline for the whole mission, so a direct radio path is never blocked by terrain.'
  const h = tl.gap[1] - tl.gap[0], earth = momentAt(tl, p.sunRows, p.earthRows, p.horizon, tl.gap[0] - p.row).earth
  return `The longest time without Earth is ${hoursText(h)}, from ${p.fmt(tl.gap[0])} to ${p.fmt(tl.gap[1])}. ${tl.gap[0] === p.row ? 'It is already under way at landing: ' : 'When it begins, '}${skylineSentence('Earth', earth)}`
}

/** Why does the battery go the way it does at this hour? */
function momentCause(p: BriefInput, tl: MissionTimeline, hour: number) {
  const m = momentAt(tl, p.sunRows, p.earthRows, p.horizon, hour), at = p.fmt(m.row)
  if (m.batteryPct === null) return { text: `At ${at} the Sun is ${m.sun.visible ? 'up' : 'hidden'} and Earth is ${m.earth.visible ? 'in view' : 'hidden'}. The battery check is off, so I can’t say how the charge changes; turn on “Require battery reserve” in Mission settings.`, m }
  if (m.solarW === null || m.demandW === null) return { text: `${at} is the end of the mission. The battery finishes at ${m.batteryPct.toFixed(0)}%.`, m }
  const heat = m.heaterW && m.heaterW > 0.5 ? `, including ${watts(m.heaterW)} to keep the electronics warm` : ''
  const sun = m.sun.visible ? (m.solarW < m.demandW ? ` The Sun is only ${clearanceGap(m.sun)} above the skyline, so little light reaches the panel.` : '') : ` The Sun is hidden ${clearanceGap(m.sun)} below the skyline.`
  const inDark = !!tl.dark && m.row >= tl.dark[0] && m.row < tl.dark[1]
  const text = m.solarW < m.demandW
    ? `At ${at} the panel makes ${watts(m.solarW)} but the lander uses ${watts(m.demandW)}${heat}, so the battery supplies the missing ${watts(m.demandW - m.solarW)}. It is at ${m.batteryPct.toFixed(0)}%.${sun}${inDark ? ` This is inside the longest darkness, so the charge keeps falling until the Sun returns around ${p.fmt(tl.dark![1])}.` : ''}`
    : `At ${at} the panel makes ${watts(m.solarW)}, more than the ${watts(m.demandW)} the lander uses, so the battery ${m.batteryPct >= 99.95 ? 'is full' : `is charging (now ${m.batteryPct.toFixed(0)}%)`}.`
  return { text, m, inDark }
}

/** An authored explanation of the selected mission. `hour` is the time cursor (mission hours) for battery/moment questions. */
export function missionBrief(topic: BriefTopic, p: BriefInput, hour?: number): GuideBrief {
  const ev = evalAt(p.series, p.row, p.c), tl = missionTimeline(p.series, p.row, p.c), scenario = scenarioKey(p)
  const step = nextStep(p, ev)
  if (topic === 'dark') return { question: 'How long will darkness last, and why?', answer: darkCause(p, tl) + (p.c.power && tl.dark ? ' Through that stretch the lander runs only on its battery.' : ''), shown: tl.dark ? 'I’ve highlighted the darkness on the timeline and moved the time cursor to its start, so the skyline shows where the Sun is.' : '', focus: tl.dark ? { target: 'dark', hour: tl.dark[0] - p.row } : null, ...step, scenario }
  if (topic === 'earth') return { question: 'When can Earth be seen, and why not always?', answer: earthCause(p, tl) + ' Seeing Earth is needed for direct radio contact; it doesn’t guarantee a link on its own.', shown: tl.gap ? 'I’ve highlighted that gap on the timeline and moved the time cursor to its start.' : '', focus: tl.gap ? { target: 'gap', hour: tl.gap[0] - p.row } : null, ...step, scenario }
  if (topic === 'battery' || topic === 'moment') {
    // Without a cursor, explain where the battery drains: the reserve crossing, else the start of the longest darkness.
    const h = hour ?? (tl.reserveRow !== null ? Math.floor(tl.reserveRow - p.row) : tl.dark ? tl.dark[0] - p.row : tl.lowest ? Math.min(tl.span - 1, tl.lowest.row - p.row) : 0)
    const c = momentCause(p, tl, h)
    const story = topic === 'battery' && hour === undefined && ev.power && tl.lowest
      ? `The battery’s lowest point is ${ev.power.minPct.toFixed(0)}% on day ${dayOf(tl.lowest.row - p.row, p.c.missionDays)}, ${ev.power.pass ? 'above' : 'below'} your ${p.c.power!.reservePct}% reserve. Here is where it drains: ` : ''
    const extra = topic === 'moment' ? ` ${skylineSentence('Earth', c.m.earth)}` : ''
    return { question: topic === 'battery' ? (hour === undefined ? 'Can the lander keep running, and why?' : 'Why does the battery change here?') : 'What is happening at this moment?', answer: story + c.text + extra, shown: c.inDark ? 'I’ve highlighted the darkness on the timeline; the time cursor marks this moment.' : 'The time cursor on the timeline marks this moment.', focus: { target: c.inDark ? 'dark' : 'moment', hour: c.m.hour }, ...step, scenario }
  }
  // verdict
  const v = verdictText(ev, p.c)
  if (ev.pass) {
    const target: FocusTarget = ev.limiting === 'battery' ? 'battery' : ev.limiting
    return { question: 'Why does this mission pass?', answer: `${p.siteName} meets your selected requirements for the whole ${p.c.missionDays}-day mission. The tightest check: ${v.margin.charAt(0).toLowerCase() + v.margin.slice(1)}`, shown: 'I’ve highlighted that check in the requirement list.', focus: { target }, ...step, scenario }
  }
  let answer: string, focus: GuideFocus
  if (ev.limiting === 'battery' && ev.power) {
    const breach = tl.reserveRow, inDark = breach !== null && !!tl.dark && breach >= tl.dark[0] && breach <= tl.dark[1]
    answer = `The battery falls below your ${p.c.power!.reservePct}% reserve on day ${dayOf((breach ?? p.row) - p.row, p.c.missionDays)}${inDark ? `, during the longest darkness (${hoursText(tl.dark![1] - tl.dark![0])}, ${p.fmt(tl.dark![0])} to ${p.fmt(tl.dark![1])})` : ''}. ${inDark ? 'With no sunlight on the panel the lander lives on stored energy' : 'The panel can’t keep up with the lander’s demand'}, and ${ev.power.unmetWh > 1e-8 ? `the battery runs out: ${energy(ev.power.unmetWh)} of demand goes unmet` : `the charge reaches ${ev.power.minPct.toFixed(0)}%`}.`
    const first = breach !== null ? Math.min(tl.span, Math.floor(breach - p.row) + 1) : 0 // first whole hour below the reserve
    focus = { target: inDark ? 'dark' : 'reserve', hour: first }
  } else if (ev.limiting === 'dark') { answer = `${darkCause(p, tl)} Your limit is ${p.c.maxDarkH} h.`; focus = { target: 'dark', hour: tl.dark ? tl.dark[0] - p.row : 0 } }
  else if (ev.limiting === 'gap') { answer = `${earthCause(p, tl)} Your limit is ${p.c.maxGapH} h.`; focus = { target: 'gap', hour: tl.gap ? tl.gap[0] - p.row : 0 } }
  else if (ev.limiting === 'thermal' && ev.thermal) { answer = `The electronics cool to ${Math.round(ev.thermal.minTempK - 273.15)} °C, below the ${Math.round(p.c.thermal!.survivalK - 273.15)} °C survival limit, because the heaters can’t replace the heat lost in the dark. ${darkCause(p, tl)}`; focus = { target: 'thermal' } }
  else { answer = v.why; focus = { target: ev.limiting === 'link' ? 'link' : 'lit' } }
  return { question: 'Why does this mission miss?', answer, shown: focus.target === 'dark' || focus.target === 'gap' || focus.target === 'reserve' ? 'I’ve highlighted it on the timeline.' : 'I’ve highlighted the failing check in the requirement list.', focus, ...step, scenario }
}

/** The trade-off on the fair comparison page, from its own calculated result. */
export function compareBrief(r: FairResult, a: string, b: string, scenario: string): GuideBrief {
  const better = r.metrics.filter(m => m.change === 'better'), worse = r.metrics.filter(m => m.change === 'worse')
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)
  const gains = better.slice(0, 2).map(m => `${lower(m.label)} (${m.diff})`), losses = worse.slice(0, 2).map(m => `${lower(m.label)} (${m.diff})`)
  const trade = !better.length && !worse.length ? `${b.charAt(0).toUpperCase() + b.slice(1)} and ${a} come out the same on every measure.`
    : `Compared with ${a}, ${b} ${gains.length ? `does better on ${gains.join(' and ')}` : ''}${gains.length && losses.length ? ', but ' : ''}${losses.length ? `does worse on ${losses.join(' and ')}` : ''}.`
  // The cause that matches what changed: energy and battery timing for power differences, else the darkness or Earth gap.
  const changedIds = [...better, ...worse].map(m => m.id)
  const power = changedIds.some(id => id === 'battery' || id === 'energy' || id === 'unmet')
  const cause = power ? r.why.filter(l => /solar energy\.|^Lowest battery/.test(l)).join(' ') || '' : r.why.find((l, i) => i > 0 && !/^Both have/.test(l) && !/never goes below/.test(l)) ?? ''
  const winner = r.evA && r.evB && r.evA.pass !== r.evB.pass ? (r.evB.pass ? b : a) : null
  return {
    question: 'What is the trade-off here?', answer: `${r.verdict} ${trade} ${cause}`.trim(),
    shown: better.length || worse.length ? 'I’ve highlighted the rows that changed in the table.' : '',
    next: winner ? `Press “Use in my plan” on ${winner} to make it your mission.` : 'Would you like to try a different date or site here?',
    focus: { target: 'metrics', metrics: [...better, ...worse].map(m => m.id) }, offers: [], scenario,
  }
}

/** Apply one requested mission change and report the planner's recalculated result. */
export function planEdit(action: GuideAction, s: MissionState, env: { series: (slug: string) => SiteSeries | undefined; name: (slug: string) => string; fmt: (row: number) => string }): { next: MissionState; report: string } | { error: string } {
  const now = env.series(s.slug)
  if (!now) return { error: 'Your mission’s site data is still loading.' }
  let next: MissionState, what: string
  if (action.kind === 'setLanding') {
    const n = Number(action.value)
    next = { ...s, row: s.row + n * 24 }
    if (!fits(now, next.row, s.c)) return { error: `A landing ${shift(n)} would run past the cached data, so I left the mission as it was.` }
    what = `I moved the landing ${shift(n)}, to ${env.fmt(next.row)}`
  } else if (action.kind === 'setSite') {
    const series = env.series(action.value)
    if (!series) return { error: 'That site’s data isn’t available, so I left the mission as it was.' }
    if (action.value === s.slug) return { error: `Your mission is already at ${env.name(s.slug)}.` }
    if (!fits(series, s.row, s.c)) return { error: 'That site’s data doesn’t cover this landing, so I left the mission as it was.' }
    next = { ...s, slug: action.value }
    what = `I moved the mission to ${env.name(action.value)}, keeping the landing at ${env.fmt(s.row)}`
  } else if (action.kind === 'setEquipment') {
    const [key, raw] = action.value.split('='), value = Number(raw)
    if (key === 'missionDays') {
      next = { ...s, c: { ...s.c, missionDays: value } }
      if (!fits(now, s.row, next.c)) return { error: `A ${value}-day mission would run past the cached data, so I left it as it was.` }
      what = `I changed the mission length to ${value} days`
    } else {
      if (!s.c.power) return { error: 'The battery check is off, so there is no equipment to change. Turn on “Require battery reserve” first.' }
      next = { ...s, c: { ...s.c, power: { ...s.c.power, [key]: value } } }
      const label: Record<string, string> = { capacityWh: `the battery to ${energy(value)}`, loadW: `the lander’s demand to ${watts(value)}`, panelAreaM2: `the panel to ${value} m²`, reservePct: `the reserve to ${value}%` }
      what = `I changed ${label[key] ?? key}`
    }
  } else return { error: 'That is not a mission change.' }
  const before = evalAt(now, s.row, s.c), after = evalAt(env.series(next.slug)!, next.row, next.c)
  const verdict = after.pass ? (before.pass ? 'it still meets your selected requirements' : 'it now meets your selected requirements') : (before.pass ? `it no longer meets your selected requirements: ${shortfall(after)}` : `it still misses your selected requirements: ${shortfall(after)}`)
  const delta = after.power && before.power ? ` Lowest battery ${after.power.minPct.toFixed(0)}% (was ${before.power.minPct.toFixed(0)}%).` : ` Longest darkness ${after.longestDarkH} h (was ${before.longestDarkH} h).`
  return { next, report: `${what}. Recalculated: ${verdict}.${delta}` }
}

/** Report for undoing a change, from a fresh calculation of the restored mission. */
export function undoReport(s: MissionState, series: SiteSeries, name: string, fmt: (row: number) => string) {
  const e = evalAt(series, s.row, s.c)
  return `Undone: back to ${name}, landing ${fmt(s.row)}, ${s.c.missionDays} days. It ${e.pass ? 'meets' : 'misses'} your selected requirements (${result(e)}).`
}
