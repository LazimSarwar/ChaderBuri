import { clearanceGap, type Moment } from '../lib/missionMoment'
import { EvidenceButton } from './Evidence'
import type { EvidenceId } from '../lib/evidence'

const ROW_EVIDENCE: Record<string, EvidenceId> = { battery: 'battery', solar: 'solar', demand: 'demand', temp: 'thermal', sun: 'sun', earth: 'earth' }

/**
 * The table that matches the time cursor: what the battery, panel, electronics, Sun and Earth
 * are doing at one moment. One column for a single mission, two when comparing.
 */
export type MomentColumn = { label: string; when: string; m: Moment }
type Cell = { v: string; note?: string; ok?: boolean }
const pct = (v: number) => `${v.toFixed(0)}%`
const watts = (v: number) => `${Math.round(v).toLocaleString('en-US')} W`

const ROWS: { id: string; label: string; show?: (cols: MomentColumn[]) => boolean; cell: (m: Moment, col: MomentColumn) => Cell }[] = [
  { id: 'when', label: 'Time (UTC)', cell: (m, col) => ({ v: col.when, note: m.ended ? 'the mission ends' : `day ${m.day} · ${m.hour} h after landing` }) },
  {
    id: 'battery', label: 'Battery charge', cell: m => m.batteryPct === null ? { v: 'Not assessed', note: 'the battery check is off' }
      : { v: pct(m.batteryPct), note: `${m.belowReserve ? 'below' : 'above'} the ${m.reservePct}% reserve`, ok: !m.belowReserve },
  },
  {
    id: 'solar', label: 'Solar power', cell: m => m.reservePct === null ? { v: 'Not assessed' } : m.solarW === null ? { v: '—', note: 'the mission has ended' }
      : { v: watts(m.solarW), note: m.solarW > 0.5 ? 'from sunlight on the panel' : 'no sunlight on the panel' },
  },
  {
    id: 'demand', label: 'Power used', cell: m => {
      if (m.reservePct === null) return { v: 'Not assessed' }
      if (m.demandW === null || m.solarW === null) return { v: '—', note: 'the mission has ended' }
      const heat = m.heaterW && m.heaterW > 0.5 ? `includes ${watts(m.heaterW)} of heating · ` : ''
      const flow = m.solarW >= m.demandW ? 'solar covers it' : (m.batteryPct ?? 0) > 0.01 ? 'the battery covers the rest' : 'not met: the battery is empty'
      return { v: watts(m.demandW), note: heat + flow, ok: m.solarW >= m.demandW || (m.batteryPct ?? 0) > 0.01 }
    },
  },
  {
    id: 'temp', label: 'Electronics', show: cols => cols.some(c => c.m.tempC !== null),
    cell: m => m.tempC === null || m.survivalC === null ? { v: 'Not assessed', note: 'night survival is off' }
      : { v: `${m.tempC.toFixed(0)} °C`, note: `${m.tempC >= m.survivalC ? 'above' : 'below'} the ${m.survivalC.toFixed(0)} °C survival limit`, ok: m.tempC >= m.survivalC },
  },
  { id: 'sun', label: 'Sun', cell: m => ({ v: m.sun.visible ? 'Up' : 'Hidden', note: `${clearanceGap(m.sun)} ${m.sun.visible ? 'above' : 'below'} the skyline`, ok: m.sun.visible }) },
  { id: 'earth', label: 'Earth', cell: m => ({ v: m.earth.visible ? 'In view' : 'Hidden', note: `${clearanceGap(m.earth)} ${m.earth.visible ? 'above' : 'below'} the skyline`, ok: m.earth.visible }) },
]

/** A small "ask Chader Buri" entry point beside a result: opens her calculated explanation (no AI request). */
export function BuriWhy({ label, onClick }: { label: string; onClick: () => void }) {
  return <button type="button" className="buri-why" aria-label={`Ask Chader Buri: ${label}`} onClick={onClick}><img src="/chader-buri-guide.webp" alt="" /><span>{label}</span></button>
}

/** Jump to a key moment, or step the shared time cursor by an hour or a day. */
export function TimeSteps({ moments, hour, span, onHour }: { moments: { id: string; label: string; hour: number }[]; hour: number; span: number; onHour: (h: number) => void }) {
  const go = (h: number) => onHour(Math.max(0, Math.min(span, h)))
  const active = moments.find(x => x.hour === hour)?.id
  return <div className="mp-cursor-bar">
    <div className="mp-chips" role="group" aria-label="Jump to a moment">{moments.map(x => <button key={x.id} aria-pressed={x.id === active} onClick={() => go(x.hour)}>{x.label}</button>)}</div>
    <div className="mp-step" role="group" aria-label="Move the time cursor">
      <button onClick={() => go(hour - 24)} disabled={hour <= 0} aria-label="One day earlier">−1 day</button>
      <button onClick={() => go(hour - 1)} disabled={hour <= 0} aria-label="One hour earlier">−1 h</button>
      <button onClick={() => go(hour + 1)} disabled={hour >= span} aria-label="One hour later">+1 h</button>
      <button onClick={() => go(hour + 24)} disabled={hour >= span} aria-label="One day later">+1 day</button>
    </div>
    <p className="mp-cursor-hint">Click or drag on the chart, or select it and use the arrow keys. The table and skyline below follow the cursor.</p>
  </div>
}

export function MomentTable({ cols, caption }: { cols: MomentColumn[]; caption: string }) {
  return <table className="mp-moment-table" data-cols={cols.length}>
    <caption className="sr-only">{caption}</caption>
    {cols.length > 1 && <thead><tr><td />{cols.map(c => <th key={c.label} scope="col">{c.label}</th>)}</tr></thead>}
    <tbody>{ROWS.filter(r => !r.show || r.show(cols)).map(r => <tr key={r.id} data-row={r.id}>
      <th scope="row">{r.label}{ROW_EVIDENCE[r.id] && <EvidenceButton id={ROW_EVIDENCE[r.id]} label={r.label} />}</th>
      {cols.map(col => { const x = r.cell(col.m, col); return <td key={col.label} data-ok={x.ok}><strong>{x.v}</strong>{x.note && <small>{x.note}</small>}</td> })}
    </tr>)}</tbody>
  </table>
}
