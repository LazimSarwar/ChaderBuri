import { indexedOptions } from '../lib/predictionIndex'
import { requestJson } from '../lib/request'
import { loadEphemeris, loadHorizon } from '../data'
import { buildSeries, evaluateWindow, type SiteSeries, type Constraints, type Evaluated } from '../architect/solver'
import { verifiedRepairs } from '../architect/comparison'
import { nextPassingArrival } from '../lib/arrivalSearch'
import type { PredictionIndex } from '../lib/predictionIndex'
import { loadDsnGeometry } from '../lib/dsn'
import { missionEvents, missionComms, type MissionEvent, type MissionComms } from './missionEvents'
import { calendarDays, rankSites, type ArrivalDay, type RankedSite } from './siteRanking'
export type ConsoleRequest = { id: number; index: PredictionIndex; slugs: string[]; slug: string; row: number; c: Constraints; calendar: boolean }
export type ConsoleReply = { id: number; current?: Evaluated; nextRow?: number | null; validationNote?: string; events?: MissionEvent[]; battery?: { row: number; pct: number }[]; failure?: { title: string; explanation: string } | null; repairs?: { label: string; c: Constraints }[]; ranks?: RankedSite[]; loaded?: number; total?: number; days?: ArrivalDay[]; calendarComplete?: boolean; comms?: MissionComms; slips?: { row: number; offsetH: number; pass: boolean | null }[]; unavailable?: string[]; error?: string }
type Product = { series: SiteSeries; startMs: number; heightM: number }
const cache = new Map<string, Promise<Product>>()
let latest = 0
async function product(slug: string, index: PredictionIndex): Promise<Product> {
  const key = index.datasetId + '/' + slug
  let pending = cache.get(key)
  if (!pending) {
    pending = Promise.all([loadEphemeris(slug, { index }), loadHorizon(slug, { index })]).then(([e, h]) => {
      if (e.sun.stepHours !== 1 || e.earth.stepHours !== 1) throw Error('Hourly site data required')
      // Ephemeris object rows are deliberately not retained in this worker cache.
      return { series: buildSeries(slug, e.sun.rows, e.earth.rows, h), startMs: Date.parse(e.sun.start), heightM: h.observerHeightAboveGroundM ?? index.analysisObserverHeightM }
    }).catch(error => { cache.delete(key); throw error })
    cache.set(key, pending)
  }
  return pending
}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 0))
self.onmessage = async ({ data: q }: MessageEvent<ConsoleRequest>) => {
  latest = q.id
  const send = (reply: Omit<ConsoleReply, 'id'>) => { if (q.id === latest) self.postMessage({ id: q.id, ...reply }) }
  try {
    const p = await product(q.slug, q.index), end = q.row + q.c.missionDays * 24
    if (q.id !== latest) return
    if (!Number.isInteger(q.row) || q.row < 0 || end > p.series.hours || !Number.isInteger(end)) throw Error('Choose an arrival with complete mission coverage')
    const current = evaluateWindow(p.series, q.row, end, q.c), events = missionEvents(p.series, q.row, q.c)
    const repairs = current.pass ? [] : verifiedRepairs(p.series, { id: 0, slug: q.slug, row: q.row, c: q.c }).map(r => ({ label: `${r.label}: ${r.value} ${r.unit}`, c: r.c }))
    const slips = Array.from({ length: 13 }, (_, i) => { const offsetH = (i - 6) * 12, row = q.row + offsetH; return { row, offsetH, pass: row >= 0 && row + q.c.missionDays * 24 <= p.series.hours ? evaluateWindow(p.series, row, row + q.c.missionDays * 24, q.c).pass : null } })
    // Every hourly arrival for up to 90 days (the calendar's granularity), so no eligible hour is skipped.
    send({ current, ...events, repairs, slips, nextRow: current.pass ? q.row : nextPassingArrival(p.series, q.row, q.c).row })
    const path='/data/benchmark/barker2021-roi4-ensemble.json'
    void requestJson(path,indexedOptions(q.index,path)).then(raw=>{const report=raw as {cloneCount?:number;rows?:{mastHeightM:number;ensemblePercentile:{meanPct:number};published:{meanPct:number};difference:{meanPct:number}}[]};const reference=report.rows?.find(r=>r.mastHeightM===1);if(reference&&Number.isFinite(reference.difference.meanPct))send({validationNote: 'ROI4 reference ensemble, 1 m mast, '+report.cloneCount+' clones: mean illumination '+reference.ensemblePercentile.meanPct.toFixed(2)+'% versus published '+reference.published.meanPct.toFixed(2)+'% ('+(reference.difference.meanPct>=0?'+':'')+reference.difference.meanPct.toFixed(2)+' percentage points). This specific comparison is not a general uncertainty or a bound for this site/date.'})}).catch(()=>{})
    void loadDsnGeometry().then(geo => send({ comms: missionComms(p.series, q.row, end - q.row, p.startMs, geo) })).catch(() => {})
    const all: Product[] = [], unavailable: string[] = []
    for (const slug of q.slugs) {
      if (q.id !== latest) return
      try { const next = await product(slug, q.index); if (next.startMs !== p.startMs || next.heightM !== p.heightM || next.series.hours !== p.series.hours) throw Error('Coverage/height mismatch'); all.push(next) } catch { unavailable.push(slug) }
      send({ ranks: rankSites(all.map(v => v.series), q.row, q.c), loaded: all.length, total: q.slugs.length, unavailable })
      await pause()
    }
    if (q.calendar) {
      const last = Math.floor((p.series.hours - q.c.missionDays * 24) / 24), days: ArrivalDay[] = []
      for (let lo = 0; lo <= last; lo += 28) {
        if (q.id !== latest) return
        days.push(...calendarDays(p.series, q.c, lo, Math.min(last, lo + 27)))
        send({ days, calendarComplete: lo + 28 > last }); await pause()
      }
    }
  } catch (error) { send({ error: error instanceof Error ? error.message : 'Mission console data unavailable' }) }
}
