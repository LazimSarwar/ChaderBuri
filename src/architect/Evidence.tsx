import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Info, X } from 'lucide-react'
import { EVIDENCE, dataSnapshot, type EvidenceId } from '../lib/evidence'
import type { Constraints, Evaluated, SiteSeries } from './solver'
import type { RobustnessAssessment } from './robustness'
import type { MissionTimeline } from '../lib/missionMoment'

/** A small "evidence" button beside a number: meaning, unit, method, source, resolution, limits and data snapshot. */
export function EvidenceButton({ id, period, label }: { id: EvidenceId; period?: string; label?: string }) {
  const [open, setOpen] = useState(false), btn = useRef<HTMLButtonElement>(null)
  const e = EVIDENCE[id]
  return <>
    <button ref={btn} type="button" className="ev-btn" aria-label={`Evidence: ${label ?? e.title}`} aria-haspopup="dialog" title={`Evidence: ${label ?? e.title}`} onClick={() => setOpen(true)}><Info size={14} aria-hidden="true" /></button>
    {open && createPortal(<EvidenceSheet id={id} period={period} onClose={() => { setOpen(false); requestAnimationFrame(() => btn.current?.focus()) }} />, document.body)}
  </>
}

function EvidenceSheet({ id, period, onClose }: { id: EvidenceId; period?: string; onClose: () => void }) {
  const e = EVIDENCE[id], title = useId(), close = useRef<HTMLButtonElement>(null), sheet = useRef<HTMLElement>(null), snap = dataSnapshot()
  useEffect(() => {
    close.current?.focus()
    const focusables = () => [...(sheet.current?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])]
    const key = (ev: KeyboardEvent) => {
      // Capture Escape first, so it closes this sheet rather than the whole dashboard.
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); onClose(); return }
      // Keep Tab and Shift+Tab inside the sheet until it is dismissed.
      if (ev.key !== 'Tab') return
      const items = focusables(), first = items[0], last = items.at(-1)
      if (!first || !last) return
      const inside = !!sheet.current?.contains(document.activeElement)
      if (ev.shiftKey && (!inside || document.activeElement === first)) { ev.preventDefault(); last.focus() }
      else if (!ev.shiftKey && (!inside || document.activeElement === last)) { ev.preventDefault(); first.focus() }
    }
    // If focus lands behind the sheet some other way (a click, a screen reader), bring it back.
    const pull = (ev: FocusEvent) => { if (sheet.current && ev.target instanceof Node && !sheet.current.contains(ev.target)) close.current?.focus() }
    window.addEventListener('keydown', key, true)
    document.addEventListener('focusin', pull)
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('focusin', pull) }
  }, [])
  const rows: [string, string][] = [['What it means', e.meaning], ['Unit', e.unit], ...(period ? [['Period', period] as [string, string]] : []), ['How it is calculated', e.method], ['Data source', e.source], ['Resolution', e.resolution], ['Limitations', e.limits]]
  return <div className="ev-backdrop" onMouseDown={ev => { if (ev.target === ev.currentTarget) onClose() }}>
    <section ref={sheet} className="ev-sheet" role="dialog" aria-modal="true" aria-labelledby={title}>
      <header><p>Evidence</p><h3 id={title}>{e.title}</h3><button ref={close} type="button" aria-label="Close" onClick={onClose}><X size={16} /></button></header>
      <dl>{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {snap && <p className="ev-snapshot">Data snapshot: dataset <code>{snap.datasetId.slice(0, 12)}…</code> · model <code>{snap.model}</code> · cached data {snap.coverageStart.slice(0, 10)} to {snap.coverageEnd.slice(0, 10)} UTC · analysis observer {snap.observerHeightM} m above the ground</p>}
      <div className="ev-actions"><button type="button" className="dash-btn" onClick={onClose}>Close</button></div>
    </section>
  </div>
}

type Status = 'assessed' | 'off' | 'separate' | 'none'
const STATUS: Record<Status, [string, string]> = { assessed: ['✓', 'Assessed'], off: ['–', 'Turned off'], separate: ['◐', 'Separate check'], none: ['✕', 'Not assessed'] }

/** What this result covers: every part of a landing decision, with what was calculated and what was not. */
export function CoverageMatrix({ c, ev, robustness, period }: { c: Constraints; ev: Evaluated; robustness: RobustnessAssessment; period: string }) {
  const fp = robustness.footprint, h = robustness.height
  const heightText = h.status === 'ready' ? (() => { const changed = h.data.filter(r => r.result.pass !== ev.pass); return changed.length ? `Verdict changes at ${changed.map(r => r.height + ' m').join(', ')}` : `Same verdict at 0, 1, 3 and 5 m` })() : h.status === 'loading' ? 'Checking…' : 'Unavailable for this site'
  const rows: { id: EvidenceId; name: string; status: Status; detail: string }[] = [
    { id: 'lit', name: 'Sunlight', status: 'assessed', detail: `${ev.litPct.toFixed(0)}% (needs at least ${c.minLitPct}%) · longest darkness ${ev.longestDarkH} h (limit ${c.maxDarkH} h)` },
    { id: 'link', name: 'Earth in view', status: 'assessed', detail: `${ev.linkPct.toFixed(0)}% (needs at least ${c.minLinkPct}%) · longest gap ${ev.longestGapH} h (limit ${c.maxGapH} h)` },
    { id: 'battery', name: 'Battery reserve', status: c.power ? 'assessed' : 'off', detail: ev.power && c.power ? `Lowest ${ev.power.minPct.toFixed(0)}% against a ${c.power.reservePct}% reserve` : 'Turn on “Require battery reserve” in Mission settings' },
    { id: 'thermal', name: 'Night survival', status: c.thermal ? 'assessed' : 'off', detail: ev.thermal ? `Coldest ${Math.round(ev.thermal.minTempK - 273.15)} °C` : 'Turn on night survival in Mission settings' },
    { id: 'footprint', name: 'Nearby touchdown points', status: fp.status === 'ready' ? 'separate' : 'none', detail: fp.status === 'ready' ? `${fp.data.passing} of ${fp.data.samples.length} points within 250 m meet the same requirements` : fp.status === 'loading' ? 'Checking…' : 'Unavailable for this site' },
    { id: 'height', name: 'Observer height', status: h.status === 'ready' ? 'separate' : 'none', detail: heightText },
    { id: 'radio', name: 'Radio link', status: 'separate', detail: 'Shown separately under Energy & footprint; not part of the verdict' },
    { id: 'terrain', name: 'Slope, roughness and hazards', status: 'none', detail: 'Not calculated in this project' },
  ]
  return <section className="mp-card" aria-label="What this result covers">
    <h4 className="mp-card-title">What this result covers <span className="mp-title-note">{period}</span></h4>
    <table className="mp-cover"><tbody>{rows.map(r => <tr key={r.id} data-status={r.status}>
      <th scope="row">{r.name}</th>
      <td><span className="mp-cover-status"><span aria-hidden="true">{STATUS[r.status][0]}</span>{STATUS[r.status][1]}</span></td>
      <td>{r.detail}</td>
      <td><EvidenceButton id={r.id} label={r.name} period={period} /></td>
    </tr>)}</tbody></table>
  </section>
}

/** The timeline as a table, one row per mission day: the same numbers as the chart, readable without it. */
export function DayTable({ tl, series, days }: { tl: MissionTimeline; series: SiteSeries; days: number }) {
  const rows = []
  for (let d = 1; d <= days; d++) {
    const a = tl.row + (d - 1) * 24, b = Math.min(tl.end, tl.row + d * 24)
    if (b <= a) break
    const sun = series.litPrefix[b] - series.litPrefix[a], earth = series.linkPrefix[b] - series.linkPrefix[a]
    const bat = tl.run ? tl.run.points[b - tl.row].socPct : null
    const cold = tl.thermal ? Math.min(...tl.thermal.points.slice(a - tl.row, b - tl.row + 1).map(p => p.tempK)) - 273.15 : null
    rows.push({ d, sun, earth, hours: b - a, bat, cold })
  }
  return <details className="mp-daytable"><summary>View the timeline as a table</summary>
    <table><thead><tr><th scope="col">Day</th><th scope="col">Sun up</th><th scope="col">Earth in view</th><th scope="col">Battery at end of day</th>{tl.thermal && <th scope="col">Coldest</th>}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.d}><th scope="row">{r.d}</th><td>{r.sun} of {r.hours} h</td><td>{r.earth} of {r.hours} h</td><td>{r.bat === null ? '—' : `${r.bat.toFixed(0)}%`}</td>{tl.thermal && <td>{r.cold === null ? '—' : `${r.cold.toFixed(0)} °C`}</td>}</tr>)}</tbody></table>
  </details>
}
