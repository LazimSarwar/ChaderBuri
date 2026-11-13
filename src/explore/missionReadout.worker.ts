import { loadEphemeris, loadHorizon, type Ephemeris, type Horizon } from '../data'
import { buildSeries, type Constraints, type SiteSeries } from '../architect/solver'
import type { PredictionIndex } from '../lib/predictionIndex'
import { arrivalRows, missionReading, type MissionReading } from './missionReadout'
import { assessRobustness, loadRobustnessProducts, type RobustnessAssessment, type RobustnessProducts } from '../architect/robustness'
import { linkGroup, type VisorGroup } from '../lib/visorData'
import { sampleSky } from '../lib/science'

export type ReadoutRequest = { id: number; index: PredictionIndex; slug: string; alternative: string | null; row: number; constraints: Constraints; dates: boolean }
export type ReadoutDetails = { link: VisorGroup; robustness: RobustnessAssessment }
export type ReadoutResponse = { id: number; current?: MissionReading; alternative?: MissionReading; dates?: MissionReading[]; details?: ReadoutDetails; alternativeDetails?: ReadoutDetails; detailsError?: string; error?: string }
type Product = { series: SiteSeries; startMs: number; height: number; sun: Ephemeris; earth: Ephemeris; horizon: Horizon; diagnostics?: Promise<RobustnessProducts> }
// Two products at most. This worker is lazy and is terminated when its surface visit unmounts.
const cache = new Map<string, Promise<Product>>()
async function product(slug: string, index: PredictionIndex): Promise<Product> {
  const key = index.datasetId + '/' + slug
  let pending = cache.get(key)
  if (!pending) {
    if (cache.size >= 2) cache.delete(cache.keys().next().value!)
    pending = Promise.all([loadEphemeris(slug, { index }), loadHorizon(slug, { index })]).then(([e, h]) => {
      if (e.sun.stepHours !== 1 || e.earth.stepHours !== 1) throw new Error('Hourly site data is required')
      return { series: buildSeries(slug, e.sun.rows, e.earth.rows, h), startMs: Date.parse(e.sun.start), height: h.observerHeightAboveGroundM ?? index.analysisObserverHeightM, sun: e.sun, earth: e.earth, horizon: h }
    }).catch(error => { cache.delete(key); throw error })
    cache.set(key, pending)
  }
  return pending
}
let latest = 0
async function details(p: Product, q: ReadoutRequest): Promise<ReadoutDetails> {
  const epoch = new Date(p.startMs + q.row * 3600000)
  const link = linkGroup({ slug: p.series.slug, row: q.row, touchdownRow: q.row, series: p.series, constraints: q.constraints, sun: sampleSky(p.sun.rows, q.row), earth: sampleSky(p.earth.rows, q.row), horizon: p.horizon, sunRows: p.sun.rows, earthRows: p.earth.rows, epoch })
  const products = await (p.diagnostics ??= loadRobustnessProducts(q.index, p.series.slug))
  return { link, robustness: assessRobustness(products, p.sun, p.earth, p.horizon, q.row, q.constraints) }
}
self.onmessage = async ({ data: q }: MessageEvent<ReadoutRequest>) => {
  latest = q.id
  try {
    const a = await product(q.slug, q.index)
    if (q.id !== latest) return
    const current = missionReading(a.series, a.startMs, q.row, q.constraints, a.height)
    const reply: ReadoutResponse = { id: q.id, current }
    if (q.alternative) {
      const b = await product(q.alternative, q.index)
      if (q.id !== latest) return
      if (a.startMs !== b.startMs || a.height !== b.height) throw new Error('Site coverage or observer heights differ; a fair comparison is unavailable')
      reply.alternative = missionReading(b.series, b.startMs, q.row, q.constraints, b.height)
    }
    if (q.dates) reply.dates = arrivalRows(q.row, a.series.hours, q.constraints.missionDays * 24).map(row => missionReading(a.series, a.startMs, row, q.constraints, a.height))
    if (q.id === latest) self.postMessage(reply)
    if (!q.dates) {
      // The verdict above is already shown; a failure here only affects the separate diagnostics section.
      try {
        const [aDetails, bDetails] = await Promise.all([details(a, q), q.alternative ? product(q.alternative, q.index).then(b => details(b, q)) : undefined])
        if (q.id === latest) self.postMessage({ ...reply, details: aDetails, alternativeDetails: bDetails } satisfies ReadoutResponse)
      } catch (error) {
        if (q.id === latest) self.postMessage({ ...reply, detailsError: error instanceof Error ? error.message : 'Communications and sensitivity checks could not be loaded' } satisfies ReadoutResponse)
      }
    }
  } catch (error) { if (q.id === latest) self.postMessage({ id: q.id, error: error instanceof Error ? error.message : 'Mission data could not be loaded' } satisfies ReadoutResponse) }
}
