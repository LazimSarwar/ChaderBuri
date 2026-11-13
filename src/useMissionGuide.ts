import { useEffect, useRef } from 'react'
import type { Ephemeris, Horizon, Site } from './data'
import type { MissionSummary } from './lib/missionSummary'
import type { GuideAction } from './lib/guideAction'
import { siteSeries } from './lib/seriesCache'
import { missionBrief, planEdit, scenarioKey, undoReport, type FocusTarget, type MissionState } from './lib/guideBriefs'
import { guideChange, onAsk, pointAt, postBrief, recordChange, useGuideChange } from './lib/guideDesk'
import type { FairSeed } from './MissionCompare'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HIGHLIGHT_LABEL: Record<string, string> = { verdict: 'the verdict', battery: 'the lowest battery point', reserve: 'where the battery drops below the reserve', dark: 'the longest darkness', gap: 'the longest time without Earth', lit: 'the sunlight check', link: 'the Earth-in-view check', thermal: 'the night-survival check' }

type Args = {
  sites: Site[]; eph: Record<string, Record<'sun' | 'earth', Ephemeris>>; horizons: Record<string, Horizon>; startMs: number
  mission: MissionSummary | null
  /** Make this the selected mission in the plan. */
  apply: (s: MissionState) => void
  compare: (seed: Omit<FairSeed, 'key'>) => void
  openPlan: () => void
  /** The dashboard page on screen, so pointing at evidence never moves the visitor elsewhere. */
  screen: string | null
}

/** Plan evidence → the matching rows of the Compare page's table. */
const COMPARE_ROWS: Record<string, string[]> = { battery: ['battery', 'unmet'], reserve: ['battery'], dark: ['dark'], gap: ['gap'], lit: ['lit'], link: ['link'], thermal: ['cold'] }

/**
 * Chader Buri's mission jobs on the dashboard: explain (authored, from the planner's numbers), locate
 * (point at evidence), compare (open the fair comparison) and act (change the selected mission, report
 * the recalculated result, keep it undoable). Returns `run`, which handles mission actions and returns
 * null for anything else.
 */
export function useMissionGuide(a: Args) {
  const latest = useRef(a); latest.current = a
  // Read through the ref: the "Why?" listener is registered once, before the data (and its start time) has loaded.
  const fmt = (row: number) => { const d = new Date(latest.current.startMs + row * 3_600_000); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC` }
  const series = (slug: string) => { const x = latest.current; return x.sites.some(s => s.slug === slug) && x.eph[slug] && x.horizons[slug] ? siteSeries(slug, x.eph[slug].sun, x.eph[slug].earth, x.horizons[slug]) : undefined }
  const name = (slug: string) => latest.current.sites.find(s => s.slug === slug)?.name ?? slug
  const state: MissionState | null = a.mission ? { slug: a.mission.slug, row: a.mission.row, c: a.mission.constraints } : null
  const stateRef = useRef(state); stateRef.current = state

  // "Why?" and "Explain" buttons beside dashboard results: an authored explanation, no AI request.
  useEffect(() => onAsk(({ topic, hour }) => {
    const s = stateRef.current, x = latest.current, ser = s && series(s.slug)
    if (topic === 'compare' || !s || !ser) return
    postBrief(missionBrief(topic, { ...s, siteName: name(s.slug), series: ser, sunRows: x.eph[s.slug].sun.rows, earthRows: x.eph[s.slug].earth.rows, horizon: x.horizons[s.slug], fmt }, hour))
  }), [])

  const change = useGuideChange()
  const canUndo = !!change && !!state && scenarioKey(state) === change.afterKey
  const undo = (): string => {
    const ch = guideChange(), s = stateRef.current
    if (!ch) return 'There is no change of mine to undo.'
    if (!s || scenarioKey(s) !== ch.afterKey) return 'The mission has changed since my last change, so I won’t undo it. You can edit it in Mission settings.'
    const ser = series(ch.before.slug)
    if (!ser) return 'That site’s data isn’t available right now.'
    latest.current.apply(ch.before); recordChange(null)
    return undoReport(ch.before, ser, name(ch.before.slug), fmt)
  }

  const run = (action: GuideAction): string | null => {
    const s = stateRef.current, x = latest.current
    const needPlan = 'Open the mission plan first, so I know which mission you mean.'
    switch (action.kind) {
      case 'highlight':
        // On Compare, point at the comparison's own rows and stay there.
        if (x.screen === 'compare') {
          if (action.value === 'verdict') { pointAt({ target: 'verdict' }); return 'Highlighted the comparison result.' }
          pointAt({ target: 'metrics', metrics: COMPARE_ROWS[action.value] ?? [] })
          return `Highlighted ${HIGHLIGHT_LABEL[action.value] ?? action.value} in the comparison.`
        }
        if (!s) { x.openPlan(); return needPlan }
        if (x.screen !== 'plan') x.openPlan()
        pointAt({ target: action.value as FocusTarget })
        return `Highlighted ${HIGHLIGHT_LABEL[action.value] ?? action.value} on the mission plan.`
      case 'compareDates': {
        if (!s) { x.openPlan(); return needPlan }
        const n = Number(action.value)
        x.compare({ mode: 'dates', slug: s.slug, row: s.row, rowB: s.row + n * 24 })
        return `Comparing your landing with one ${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'later' : 'earlier'}: same site, lander and mission length.`
      }
      case 'compareSites':
        if (!s) { x.openPlan(); return needPlan }
        x.compare({ mode: 'sites', slug: s.slug, row: s.row, ...(action.value && action.value !== s.slug ? { slugB: action.value } : {}) })
        return action.value && action.value !== s.slug ? `Comparing ${name(s.slug)} with ${name(action.value)} on the same dates.` : `Comparing ${name(s.slug)} with another site on the same dates.`
      case 'setLanding': case 'setSite': case 'setEquipment': {
        if (!s) { x.openPlan(); return needPlan }
        const r = planEdit(action, s, { series, name, fmt })
        if ('error' in r) return r.error
        x.apply(r.next); x.openPlan()
        recordChange({ report: r.report, before: s, after: r.next, afterKey: scenarioKey(r.next), at: Date.now() })
        return r.report + ' You can undo this.'
      }
      case 'undo': return undo()
      default: return null
    }
  }
  return { run, undo, canUndo, change }
}
