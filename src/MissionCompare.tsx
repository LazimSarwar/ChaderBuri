import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowRight, Check, Minus, X } from 'lucide-react'
import type { Ephemeris, Horizon, Site } from './data'
import { referenceConstraints, referenceRow } from './architect/reference'
import { landingRow } from './architect/landingDate'
import { verdictText } from './architect/verdictText'
import { cloneConstraints, type Scn } from './architect/comparison'
import type { Constraints } from './architect/solver'
import { MissionGlance } from './architect/MissionGlance'
import { MomentTable, TimeSteps } from './architect/MomentTable'
import { SkyChart } from './SkyChart'
import { siteSeries } from './lib/seriesCache'
import { bestOtherSite, compareFairly, type FairMode, type FairSide } from './lib/fairCompare'
import { momentAt, momentText, skylineSentence } from './lib/missionMoment'
import { equipmentLine, type MissionSummary } from './lib/missionSummary'
import { useScreenDigest } from './lib/screenDigest'
import { BuriWhy } from './architect/MomentTable'
import { onAsk, postBrief, setCompareFocus, usePointer } from './lib/guideDesk'
import { compareBrief } from './lib/guideBriefs'
import { EvidenceButton } from './architect/Evidence'
import type { EvidenceId } from './lib/evidence'
import type { PredictionIndex } from './lib/predictionIndex'
import { MissionCsvDownloads } from './MissionCsvDownloads'

/** How Compare opens: which kind of comparison, and optionally the first and second option. */
export type FairSeed = { key: number; mode: FairMode; slug?: string; row?: number; slugB?: string; rowB?: number }

type Props = {
  sites: Site[]
  eph: Record<string, Record<'sun' | 'earth', Ephemeris>>
  horizons: Record<string, Horizon>
  startMs: number
  datasetIndex?: PredictionIndex
  /** The mission plan's mission: its lander, length and requirements are used for both options. */
  mission: MissionSummary | null
  sceneSlug: string; sceneRow: number
  seed: FairSeed | null
  defaultB?: string
  onSiteB?: (slug: string) => void
  onUse: (slug: string, row: number, constraints: Constraints) => void
  onVisit: (slug: string, row: number, end: number, constraints: Constraints) => void
  onAdvanced: (scns: Scn[]) => void
}

const HOUR = 3_600_000
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Compare two options fairly: two sites at the same landing time, or one site on two dates.
 * The lander, mission length and requirements are the mission plan's, identical for both,
 * so the page can say what improved, what got worse and why, from one change only.
 */
export function MissionCompare({ sites, eph, horizons, startMs, datasetIndex, mission, sceneSlug, sceneRow, seed, defaultB, onSiteB, onUse, onVisit, onAdvanced }: Props) {
  const c = useMemo(() => mission?.constraints ?? referenceConstraints(), [mission?.constraints])
  const series = useMemo(() => sites.map(s => siteSeries(s.slug, eph[s.slug].sun, eph[s.slug].earth, horizons[s.slug])), [sites, eph, horizons])
  const bySlug = useMemo(() => new Map(series.map(s => [s.slug, s])), [series])
  const name = (slug: string) => sites.find(s => s.slug === slug)?.name ?? slug
  const hours = c.missionDays * 24
  const maxRow = Math.max(0, Math.min(...series.map(s => s.hours)) - hours)
  const clampRow = (r: number) => Math.max(0, Math.min(maxRow, Math.round(r)))
  const fmt = (row: number) => { const d = new Date(startMs + row * HOUR); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad2(d.getUTCHours())}:00 UTC` }
  const short = (row: number) => { const d = new Date(startMs + row * HOUR); return `${d.getUTCDate()} ${MON[d.getUTCMonth()]}` }

  const has = (slug?: string): slug is string => !!slug && bySlug.has(slug)
  const baseSlug = has(seed?.slug) ? seed!.slug! : has(mission?.slug) ? mission!.slug : has(sceneSlug) ? sceneSlug : sites[0].slug
  const baseRow = clampRow(seed?.row ?? mission?.row ?? (sceneRow || referenceRow(startMs)))
  const laterRow = (r: number) => r + 7 * 24 <= maxRow ? r + 7 * 24 : r - 7 * 24 >= 0 ? r - 7 * 24 : clampRow(r + 24)
  const [mode, setMode] = useState<FairMode>(seed?.mode ?? 'sites')
  const [slugA, setSlugA] = useState(baseSlug)
  const [rowA, setRowA] = useState(baseRow)
  const [slugB, setSlugB] = useState(() => has(seed?.slugB) && seed!.slugB !== baseSlug ? seed!.slugB! : has(defaultB) && defaultB !== baseSlug ? defaultB : bestOtherSite(series, baseSlug, baseRow, c) ?? baseSlug)
  const [rowB, setRowB] = useState(() => seed?.rowB !== undefined ? clampRow(seed.rowB) : laterRow(baseRow))
  const [hour, setHour] = useState(0)
  useEffect(() => setHour(0), [mode, slugA, slugB, rowA, rowB])
  useEffect(() => { if (mode === 'sites') onSiteB?.(slugB) }, [mode, slugB])
  // Follow the mission plan's mission until the visitor changes something here: while site data is still
  // loading, the plan can briefly feature another site before the saved one is ready.
  const touched = useRef(false)
  useEffect(() => {
    if (touched.current || has(seed?.slug) || !mission || !has(mission.slug)) return
    if (mission.slug === slugA && clampRow(mission.row) === rowA) return
    const r0 = clampRow(seed?.row ?? mission.row)
    setSlugA(mission.slug); setRowA(r0); setRowB(seed?.rowB !== undefined ? clampRow(seed.rowB) : laterRow(r0))
    if ((!has(seed?.slugB) && (!has(defaultB) || defaultB === mission.slug)) || slugB === mission.slug) setSlugB(bestOtherSite(series, mission.slug, r0, c) ?? slugB)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mission?.slug, mission?.row, bySlug])
  const pickA = (slug: string) => { setSlugA(slug); if (slug === slugB) setSlugB(bestOtherSite(series, slug, rowA, c) ?? slugB) }

  // Option labels: site names, or the two landing dates.
  const dateLabel = (r: number, other: number, letter: string) => r === other ? `Landing ${letter}` : short(r) === short(other) ? `${short(r)} ${pad2(new Date(startMs + r * HOUR).getUTCHours())}:00 landing` : `${short(r)} landing`
  const side = (slug: string, row: number, label: string): FairSide => ({ label, ref: mode === 'dates' ? `the ${label}` : label, site: name(slug), slug, row, series: bySlug.get(slug)!, sunRows: eph[slug].sun.rows, earthRows: eph[slug].earth.rows, horizon: horizons[slug] })
  const A = mode === 'sites' ? side(slugA, rowA, name(slugA)) : side(slugA, rowA, dateLabel(rowA, rowB, 'A'))
  const B = mode === 'sites' ? side(slugB, rowA, name(slugB)) : side(slugA, rowB, dateLabel(rowB, rowA, 'B'))
  const equipment = equipmentLine(c)
  const r = useMemo(() => compareFairly(mode, A, B, c, fmt, equipment),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, A.slug, A.row, B.slug, B.row, A.label, B.label, c, bySlug, equipment])
  const mA = r.tlA ? momentAt(r.tlA, A.sunRows, A.earthRows, A.horizon, hour) : null
  const mB = r.tlB ? momentAt(r.tlB, B.sunRows, B.earthRows, B.horizon, hour) : null
  const span = r.tlA?.span ?? hours

  useScreenDigest('compare', r.evA && r.evB ? [
    { id: 'compare-kind', label: 'Comparison', value: `${r.differs}. Kept the same: ${r.same.join('; ')}` },
    { id: 'compare-verdict', label: 'Comparison result', value: `${r.verdict} ${r.summary}`, status: r.evB.pass ? 'ok' as const : 'fail' as const },
    ...r.metrics.map(x => ({ id: `compare-${x.id}`, label: x.label, value: `${A.label}: ${x.a}; ${B.label}: ${x.b} (${x.change}, ${x.diff})`, status: x.change === 'worse' ? 'warn' as const : 'ok' as const })),
  ] : null, `${r.differs}|${r.verdict}|${hours}`)

  const moments = [
    { id: 'landing', label: 'Landing', hour: 0 },
    ...[[A, r.tlA] as const, [B, r.tlB] as const].flatMap(([s, t]) => [
      ...(t?.dark ? [{ id: `dark-${s.label}`, label: `Longest darkness · ${s.label}`, hour: t.dark[0] - t.row }] : []),
      ...(t?.lowest && c.power ? [{ id: `low-${s.label}`, label: `Lowest battery · ${s.label}`, hour: t.lowest.row - t.row }] : []),
    ]),
    { id: 'end', label: 'Mission end', hour: span },
  ]
  // Chader Buri explains the trade-off from this page's own result, and highlights the rows that changed.
  const explain = () => postBrief(r.evA && r.evB ? compareBrief(r, A.ref ?? A.label, B.ref ?? B.label, '') : { question: 'What is the trade-off here?', answer: r.verdict, shown: '', next: 'Choose landings that leave room for the whole mission in the cached data.', focus: null, offers: [], scenario: '' })
  const explainRef = useRef(explain); explainRef.current = explain
  useEffect(() => onAsk(a => { if (a.topic === 'compare') explainRef.current() }), [])
  const pointer = usePointer(), pointed = pointer?.target === 'metrics' ? pointer.metrics ?? [] : []
  // Tell Chader Buri which two options are on screen, so she explains these in place.
  useEffect(() => { setCompareFocus({ mode, a: { slug: A.slug, row: A.row }, b: { slug: B.slug, row: B.row } }) }, [mode, A.slug, A.row, B.slug, B.row])
  useEffect(() => () => setCompareFocus(null), [])
  // Bring what she points at into view: a changed row, or the comparison result.
  const tableRef = useRef<HTMLTableElement>(null), resultRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!pointer) return
    const el = pointer.target === 'verdict' ? resultRef.current : pointed.length ? tableRef.current?.querySelector<HTMLElement>('[data-pointed]') : null
    el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [pointer?.key])
  const advanced = () => onAdvanced([{ id: 0, slug: A.slug, row: A.row, c }, { id: 1, slug: B.slug, row: B.row, c }])

  return <div className="fc">
    <section className="mp-card fc-setup" aria-label="What to compare" onChangeCapture={() => { touched.current = true }} onClickCapture={() => { touched.current = true }}>
      <div className="dash-seg fc-mode" role="group" aria-label="Kind of comparison">
        <button aria-pressed={mode === 'sites'} onClick={() => setMode('sites')}>Two sites, same dates</button>
        <button aria-pressed={mode === 'dates'} onClick={() => setMode('dates')}>One site, two dates</button>
      </div>
      {mode === 'sites' ? <div className="fc-fields">
        <label className="mp-field"><span>Site A</span><select value={slugA} onChange={e => pickA(e.target.value)}>{sites.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
        <label className="mp-field"><span>Site B</span><select value={slugB} onChange={e => setSlugB(e.target.value)}>{sites.filter(s => s.slug !== slugA).map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
        <DateField label="Landing for both (UTC)" row={rowA} startMs={startMs} maxRow={maxRow} days={c.missionDays} onPick={setRowA} />
      </div> : <div className="fc-fields">
        <label className="mp-field"><span>Site</span><select value={slugA} onChange={e => setSlugA(e.target.value)}>{sites.map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
        <DateField label="Landing A (UTC)" row={rowA} startMs={startMs} maxRow={maxRow} days={c.missionDays} onPick={setRowA} />
        <div className="fc-date-b">
          <DateField label="Landing B (UTC)" row={rowB} startMs={startMs} maxRow={maxRow} days={c.missionDays} onPick={setRowB} />
          <div className="fc-shift" role="group" aria-label="Landing B relative to landing A">{[-7, -1, 1, 7].map(d => { const t = rowA + d * 24; return <button key={d} disabled={t < 0 || t > maxRow} aria-pressed={rowB === t} onClick={() => setRowB(t)}>{d > 0 ? '+' : '−'}{Math.abs(d)} day{Math.abs(d) > 1 ? 's' : ''}</button> })}</div>
        </div>
      </div>}
      <div className="fc-held">
        <div><span className="fc-held-label">Kept the same</span>{r.same.map(x => <span key={x} className="fc-chip">{x}</span>)}</div>
        <div><span className="fc-held-label">The one change</span><span className="fc-chip is-diff">{r.differs}</span></div>
      </div>
      <p className="mp-muted">The lander, mission length and requirements come from {mission ? 'your mission plan' : 'the worked example until you set up a mission plan'}. Want each option to have different equipment? <button className="mp-link fc-inline" onClick={advanced}>Compare equipment in the mission plan</button></p>
    </section>

    {datasetIndex && <MissionCsvDownloads index={datasetIndex} scenarios={[{id:0,slug:A.slug,row:A.row,c,label:`A · ${A.label}`},{id:1,slug:B.slug,row:B.row,c,label:`B · ${B.label}`}]} series={bySlug} sites={sites} eph={eph} horizons={horizons}/>}
    {!r.evA || !r.evB ? <section className="mp-card"><p className="mp-muted">{r.verdict}</p></section> : <>
      <div className="fc-sides">{([[A, r.evA, 'A'], [B, r.evB, 'B']] as const).map(([s, ev, letter]) => {
        const v = verdictText(ev, c)
        return <section key={letter} className="mp-card fc-side" data-ok={ev.pass} aria-label={`Option ${letter}: ${s.label}`}>
          <div className="fc-side-head"><p className="mp-kicker">Option {letter}</p><span className="mp-badge" data-ok={ev.pass}>{ev.pass ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{ev.pass ? 'Meets' : 'Misses'} your requirements</span></div>
          <h3>{mode === 'sites' ? s.site : fmt(s.row)}</h3>
          <p className="mp-sub">{mode === 'sites' ? `Lands ${fmt(s.row)}` : s.site} · {c.missionDays}-day mission</p>
          <p className="fc-side-why">{v.why}</p>
          <div className="mp-stats fc-stats">
            <div><span>Lowest battery</span><strong>{ev.power ? `${ev.power.minPct.toFixed(0)}%` : '—'}</strong></div>
            <div><span>Sunlight</span><strong>{ev.litPct.toFixed(0)}%</strong></div>
            <div><span>Earth in view</span><strong>{ev.linkPct.toFixed(0)}%</strong></div>
            <div><span>Longest darkness</span><strong>{ev.longestDarkH} h</strong></div>
          </div>
          <div className="mp-actions">
            <button className="dash-btn is-primary" onClick={() => onUse(s.slug, s.row, cloneConstraints(c))}>Use in my plan <ArrowRight className="h-4 w-4" /></button>
            <button className="dash-btn" onClick={() => onVisit(s.slug, s.row, s.row + hours, cloneConstraints(c))}>Visit in 3D</button>
          </div>
        </section>
      })}</div>

      <section className="mp-card" aria-label="What changed">
        <h4 className="mp-card-title">What changed <span className="mp-title-note">from {A.label} to {B.label}</span></h4>
        <p ref={resultRef} className="fc-result" data-pointed={pointer?.target === 'verdict' || undefined}><strong>{r.verdict}</strong> {r.summary}</p>
        <BuriWhy label="Explain the trade-off" onClick={explain} />
        <table ref={tableRef} className="fc-table">
          <thead><tr><th scope="col">Measure</th><th scope="col">{A.label}</th><th scope="col">{B.label}</th><th scope="col">At {B.label}</th></tr></thead>
          <tbody>{r.metrics.map(x => <tr key={x.id} data-change={x.change} data-pointed={pointed.includes(x.id) || undefined}>
            <th scope="row">{x.label}<EvidenceButton id={x.id as EvidenceId} label={x.label} period={`${hours / 24}-day missions, same equipment for both`} /></th><td data-label={A.label}>{x.a}</td><td data-label={B.label}>{x.b}</td>
            <td data-label={`At ${B.label}`}><span className="fc-change">{x.change === 'same' ? <Minus className="h-3.5 w-3.5" /> : x.change === 'better' ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}{x.change === 'same' ? 'Same' : x.change === 'better' ? 'Better' : 'Worse'}</span><small>{x.diff}</small></td>
          </tr>)}</tbody>
        </table>
      </section>

      <section className="mp-card" aria-label="Why they differ">
        <h4 className="mp-card-title">Why</h4>
        <ul className="fc-why">{r.why.map(l => <li key={l}>{l}</li>)}</ul>
      </section>

      {r.tlA && r.tlB && mA && mB && <section className="mp-card" aria-label="Both missions, hour by hour">
        <h4 className="mp-card-title">Both missions, hour by hour <span className="mp-title-note">{mode === 'sites' ? 'the cursor marks the same moment at both sites' : 'the cursor marks the same time after landing'}</span></h4>
        {([[A, r.tlA, mA], [B, r.tlB, mB]] as const).map(([s, t, m]) => <div key={s.label} className="fc-glance">
          <p className="fc-glance-label">{s.label}</p>
          <MissionGlance series={s.series} row={s.row} c={c} run={t.run} marks={{ lowest: t.lowest, reserveRow: t.reserveRow, dark: t.dark, gap: t.gap }} cursor={{ hour: m.hour, onChange: setHour, label: `Time cursor for ${s.label}`, text: momentText(m, fmt) }} />
        </div>)}
        <TimeSteps moments={moments} hour={mA.hour} span={span} onHour={setHour} />
        <div className="fc-moment"><MomentTable cols={[{ label: A.label, when: fmt(mA.row), m: mA }, { label: B.label, when: fmt(mB.row), m: mB }]} caption={`Both options ${mA.hour} hours after landing`} /></div>
        <div className="fc-skies">{([[A, mA], [B, mB]] as const).map(([s, m]) => <div key={s.label} className="mp-moment-sky">
          <h5>{s.label}: why is the Sun or Earth blocked?</h5>
          <SkyChart horizon={horizons[s.slug]} sunAz={m.sun.az} sunEl={m.sun.el} earthAz={m.earth.az} earthEl={m.earth.el}
            tracks={{ sun: s.sunRows.slice(s.row, s.row + hours), earth: s.earthRows.slice(s.row, s.row + hours), label: `path over the ${c.missionDays}-day mission` }} />
          <p>{skylineSentence('The Sun', m.sun)}</p><p>{skylineSentence('Earth', m.earth)}</p>
        </div>)}</div>
        <p className="mp-muted">Skylines are measured from LRO LOLA terrain around each landing point; Sun and Earth positions are from JPL Horizons. Hourly screening estimates, not a success probability.</p>
      </section>}
    </>}
  </div>
}

/** A landing time input with its own label, limited to whole UTC hours that leave room for the whole mission. */
function DateField({ label, row, startMs, maxRow, days, onPick }: { label: string; row: number; startMs: number; maxRow: number; days: number; onPick: (row: number) => void }) {
  const iso = (r: number) => new Date(startMs + r * HOUR).toISOString().slice(0, 16)
  const [draft, setDraft] = useState(() => iso(row)), id = useId()
  useEffect(() => setDraft(iso(row)), [row, startMs])
  const total = maxRow + days * 24
  const invalid = landingRow(draft, startMs, total, days) === null
  const commit = (value: string) => { setDraft(value); const next = landingRow(value, startMs, total, days); if (next !== null && next !== row) onPick(next) }
  return <div className="mp-field fc-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="datetime-local" step={3600} min={iso(0)} max={iso(maxRow)} value={draft} aria-invalid={invalid} onChange={e => commit(e.currentTarget.value)} />
    {invalid && <small role="status">Choose a whole UTC hour that leaves room for the whole mission in the cached data.</small>}
  </div>
}
