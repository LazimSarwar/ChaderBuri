import { AccuracyBadge } from './AccuracyBadge'
import type { AccuracyScope } from './accuracyText'
import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Site } from '../data'
import type { Constraints } from '../architect/solver'
import type { PredictionIndex } from '../lib/predictionIndex'
import { inputRow, LIMIT_LABEL, utcInput, type MissionReading } from './missionReadout'
import type { ReadoutRequest, ReadoutResponse } from './missionReadout.worker'
import type { ExplorationProposal } from './missionSession'
import { useScreenDigest } from '../lib/screenDigest'
import { MISSION_DECISION_SCREEN, missionDecisionDigest } from './missionDecisionDigest'
import { RobustnessSummary } from '../architect/RobustnessSummary'
import { WhySiteSummary } from './WhySiteSummary'
import './mission-decisions.css'

export type DecisionMode = 'why' | 'compare' | 'arrival' | 'route' | 'events' | 'ground' | 'link' | null
export type MissionDecisionProps = {
  hideNav?: boolean
  sceneRow?: number; validationNote?: string; sourceResolutionM?: number; extra?: ReactNode
  mode: DecisionMode; onMode: (mode: DecisionMode) => void
  site: Site; sites: Site[]; row: number; startMs: number; index: PredictionIndex
  constraints: Constraints; basis: string
  onArrival: (row: number, constraints: Constraints) => void; onVisit?: (slug: string, row: number, constraints: Constraints) => void
  route: ReactNode; onReturn: () => void; onAsk?: (question: string) => void; onProposal?: (proposal: ExplorationProposal | null) => void
}
const stamp = (iso: string) => iso.slice(0, 16).replace('T', ' ') + ' UTC'
const pct = (n: number) => n.toFixed(1) + '%'
const hours = (n: number) => n.toFixed(1) + ' h'
function Verdict({ reading }: { reading: MissionReading }) {
  return <p className="decision-verdict" data-meets={reading.result.pass}>
    {reading.result.pass ? 'Meets these requirements' : 'Does not meet these requirements'}<span>{reading.result.pass ? 'Tightest constraint' : 'Limiting requirement'}: {LIMIT_LABEL[reading.result.limiting]}</span>
  </p>
}
function Metrics({ a, b, c, names, resolutionM, validationNote }: { a: MissionReading; b?: MissionReading; c: Constraints; names: [string, string]; resolutionM:number; validationNote?:string }) {
  const rows = [
    ['Sun above skyline', pct(a.result.litPct), b && pct(b.result.litPct), `≥ ${c.minLitPct}%`],
    ['Longest darkness', hours(a.result.longestDarkH), b && hours(b.result.longestDarkH), `≤ ${c.maxDarkH} h`],
    ['Earth above skyline', pct(a.result.linkPct), b && pct(b.result.linkPct), `≥ ${c.minLinkPct}%`],
    ['Longest Earth gap', hours(a.result.longestGapH), b && hours(b.result.longestGapH), `≤ ${c.maxGapH} h`],
    ...(c.power ? [['Lowest battery', a.result.power ? pct(a.result.power.minPct) : 'Unavailable', b && (b.result.power ? pct(b.result.power.minPct) : 'Unavailable'), `≥ ${c.power.reservePct}%`]] : []),
  ]
  return <div className="decision-table-wrap"><table><caption>Same {c.missionDays}-day mission{b ? ' · same equipment and arrival' : ''}</caption><thead><tr><th scope="col">Condition</th><th scope="col" aria-label={b ? names[0] : undefined}>{b ? 'Here' : 'Calculated'}</th>{b && <th scope="col">{names[1]}</th>}<th scope="col">Mission limit</th></tr></thead>
    <tbody>{rows.map(([name, av, bv, requirement]) => <tr key={name}><th scope="row">{name}</th><td>{av}<AccuracyBadge scope={(String(name).startsWith('Sun')||name==='Longest darkness'?'illumination':String(name).startsWith('Earth')||name==='Longest Earth gap'?'earth':'power') as AccuracyScope} resolutionM={resolutionM} heightM={a.observerHeightM} validationNote={validationNote} /></td>{b && <td>{bv}</td>}<td>{requirement}</td></tr>)}</tbody></table></div>
}
function MissionDecisionsView(p: MissionDecisionProps) {
  const [draft, setDraft] = useState(() => utcInput(Math.round(p.row), p.startMs))
  const [alternative, setAlternative] = useState(() => p.sites.find(s => s.slug !== p.site.slug)?.slug ?? '')
  const [state, setState] = useState<{ key: string; reply: ReadoutResponse } | null>(null)
  const [retry, setRetry] = useState(0)
  const worker = useRef<Worker | null>(null), serial = useRef(0)
  const row = inputRow(draft, p.startMs), constraintKey = JSON.stringify(p.constraints)
  const key = JSON.stringify([p.index.datasetId, p.site.slug, p.mode === 'compare' ? alternative : null, row, p.mode === 'arrival', constraintKey, retry])
  useEffect(() => {
    setDraft(utcInput(Math.round(p.row), p.startMs))
    setAlternative(p.sites.find(s => s.slug !== p.site.slug)?.slug ?? '')
  }, [p.site.slug, p.startMs]) // A running clock must not reset a visitor's proposed arrival.
  useEffect(() => () => { worker.current?.terminate(); worker.current = null }, [])
  useEffect(() => {
    if (!p.mode || p.mode === 'route' || row === null) return
    const id = ++serial.current
    let timer: ReturnType<typeof setTimeout> | undefined
    const fail = (message: string) => { if (serial.current === id) setState({ key, reply: { id, error: message } }) }
    try {
      const w = worker.current ??= new Worker(new URL('./missionReadout.worker.ts', import.meta.url), { type: 'module' })
      w.onmessage = ({ data }: MessageEvent<ReadoutResponse>) => { if (data.id === serial.current && data.id === id) { clearTimeout(timer); setState({ key, reply: data }) } }
      w.onerror = () => { clearTimeout(timer); fail('The mission calculation could not start. Retry to load a fresh worker.'); w.terminate(); if (worker.current === w) worker.current = null }
      const request: ReadoutRequest = { id, index: p.index, slug: p.site.slug, alternative: p.mode === 'compare' ? alternative || null : null, row, constraints: JSON.parse(constraintKey), dates: p.mode === 'arrival' }
      w.postMessage(request)
      timer = setTimeout(() => { fail('Loading took too long. Check the connection and retry.'); w.terminate(); if (worker.current === w) worker.current = null }, 30000)
    } catch (error) { fail(error instanceof Error ? error.message : 'Mission calculation unavailable') }
    return () => { clearTimeout(timer); ++serial.current }
  }, [key, p.mode])
  const reply = state?.key === key ? state.reply : null, a = reply?.current, b = reply?.alternative
  const valid = row !== null && row >= 0 && row + p.constraints.missionDays * 24 <= p.index.coverage.samples - 1
  const title = p.mode === 'why' ? 'Why choose this site?' : p.mode === 'compare' ? 'Compare landing sites' : p.mode === 'route' ? 'Plan an excursion' : 'Choose an arrival'
  const alternativeName = p.sites.find(s => s.slug === alternative)?.name ?? alternative
  const refreshArrival = () => setDraft(utcInput(Math.round(p.row), p.startMs))
  const proposalCallback = useRef(p.onProposal); proposalCallback.current = p.onProposal
  useEffect(() => {
    const callback = proposalCallback.current
    if (!p.mode || p.mode === 'route' || row === null || !valid) { callback?.(null); return }
    callback?.({ slug: p.site.slug, row, sceneRow: Math.round(p.sceneRow ?? p.row), constraints: JSON.parse(constraintKey), basis: p.basis,
      ...(p.mode === 'compare' && alternative ? { compare: { mode: 'sites' as const, a: { slug: p.site.slug, row }, b: { slug: alternative, row } } } : {}) })
  }, [key, p.mode, p.row, p.sceneRow, p.basis])
  useEffect(() => () => proposalCallback.current?.(null), [])
  const digest = p.mode && p.mode !== 'route' && row !== null && valid ? missionDecisionDigest({ site: p.site.name, sceneUTC: utcInput(Math.round(p.sceneRow ?? p.row), p.startMs), arrivalUTC: utcInput(row, p.startMs), basis: p.basis, constraints: p.constraints, current: a, alternative: b, alternativeName }) : null
  useScreenDigest(MISSION_DECISION_SCREEN, digest, JSON.stringify([key, p.mode, p.row, p.sceneRow, reply]))
  return <aside className="field-decisions pointer-events-auto" aria-label="Surface mission decisions" data-open={!!p.mode}>
    {!p.hideNav && <nav className="decision-shortcuts has-route" aria-label="Mission choices">
      {([['why', 'Why this site', 'Why site'], ['compare', 'Compare sites', 'Compare'], ['arrival', 'Arrival time', 'Arrival'], ['route', 'Plan route', 'Route']] as const).map(([mode, label, short]) => <button key={mode} aria-label={label} aria-expanded={p.mode === mode} aria-controls="surface-mission-readout" onClick={() => { if (!p.mode) refreshArrival(); p.onMode(p.mode === mode ? null : mode) }}><span className="decision-long">{label}</span><span className="decision-short">{short}</span></button>)}
      <button aria-label="Return to lander" onClick={p.onReturn}><span className="decision-long">Return to lander</span><span className="decision-short">Return</span></button>
    </nav>}
    {p.mode && <section id="surface-mission-readout" className="decision-readout" data-mode={p.mode} aria-label={title}>
      <header><h2>{title}</h2><button aria-label="Close mission readout" onClick={() => p.onMode(null)}>×</button></header>
      <div className="decision-body">
        {p.mode === 'route' ? p.route : <>
        {p.mode !== 'why' && <p className="decision-basis">{p.basis} · {p.constraints.missionDays} days</p>}
        <p className="decision-site">{p.site.name}</p>
        {p.mode === 'compare' && <label>Compare with<select value={alternative} onChange={e => setAlternative(e.target.value)}>{p.sites.filter(s => s.slug !== p.site.slug).map(s => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>}
        {p.mode === 'arrival' ? <>
          <label>Arrival (UTC, hourly)<input type="datetime-local" step={3600} min={utcInput(0, p.startMs)} max={utcInput(p.index.coverage.samples - 1 - p.constraints.missionDays * 24, p.startMs)} value={draft} onInput={e => setDraft(e.currentTarget.value)} onChange={e => setDraft(e.target.value)} /></label>
          <div className="decision-date-actions"><button onClick={() => { if (row !== null) setDraft(utcInput(row - 24, p.startMs)) }} disabled={row === null || row < 24}>−1 day</button><button onClick={refreshArrival}>Use scene time</button><button onClick={() => { if (row !== null) setDraft(utcInput(row + 24, p.startMs)) }} disabled={row === null || row + 24 + p.constraints.missionDays * 24 > p.index.coverage.samples - 1}>+1 day</button></div>
        </> : <p className="decision-epoch">Arrival {draft.replace('T', ' ')} UTC <button onClick={refreshArrival}>Use scene time</button></p>}
        {!valid ? <p role="alert">Choose a whole hour inside {p.index.coverage.start}–{p.index.coverage.stop}, leaving room for the complete mission.</p> : reply?.error ? <p role="alert">{reply.error} <button onClick={() => setRetry(n => n + 1)}>Retry calculation</button></p> : !a ? <p role="status">Loading verified site data and calculating…</p> : <>
          {p.mode === 'why' ? <WhySiteSummary reading={a} constraints={p.constraints} resolutionM={p.sourceResolutionM ?? 20} validationNote={p.validationNote} example={p.basis === 'Illustrative exploration mission'} /> : <Verdict reading={a} />}
          <details className="decision-numbers" open={p.mode !== 'why'}><summary>All requirements and calculated values</summary>
          <Metrics a={a} b={b} c={p.constraints} names={[p.site.name, alternativeName]} resolutionM={p.sourceResolutionM ?? 20} validationNote={p.validationNote} />
          {a.result.power && <p>Modelled solar energy: {(a.result.power.generatedWh / 1000).toFixed(1)} kWh. Demand: {(a.result.power.demandWh / 1000).toFixed(1)} kWh. Unmet demand: {(a.result.power.unmetWh / 1000).toFixed(2)} kWh.{a.result.power.firstReserveH !== null && ` First reserve crossing: ${stamp(new Date(Date.parse(a.arrivalUTC) + a.result.power.firstReserveH * 3600000).toISOString())}.`}</p>}
          {a.result.thermal && <p>Enabled lander thermal model: minimum {a.result.thermal.minTempK.toFixed(1)} K; heaters use {(a.result.thermal.heaterEnergyWh / 1000).toFixed(2)} kWh. This is not suit temperature or measured ground temperature.</p>}
          </details>
          {p.mode !== 'arrival' && <details><summary>Communications and sensitivity at this arrival</summary>{reply.details ? <><p><strong>{reply.details.link.headline.label}: {reply.details.link.headline.value} {reply.details.link.headline.unit}</strong></p><p>{reply.details.link.headline.assumption}</p>{reply.details.link.details.map(d => <p key={d.id}>{d.label}: {d.value} {d.unit} · {d.assumption}</p>)}<p>Diagnostic at the nominal landing point and selected arrival only. This is not a station booking, crew-to-lander radio assessment or a whole-mission link guarantee.</p><RobustnessSummary assessment={reply.details.robustness} nominal={a.result} compact />{b && reply.alternativeDetails && <><h3>{alternativeName}</h3><RobustnessSummary assessment={reply.alternativeDetails.robustness} nominal={b.result} compact /></>}</> : reply.detailsError ? <p role="alert">{reply.detailsError}. The verdict above is unaffected. <button onClick={() => setRetry(n => n + 1)}>Retry checks</button></p> : <p role="status">Loading separate communications and sensitivity checks…</p>}</details>}
          {b && <><p className="decision-site">{alternativeName}</p><Verdict reading={b} /><p>{a.result.pass && !b.result.pass ? `For this arrival, ${p.site.name} meets your requirements; ${LIMIT_LABEL[b.result.limiting].toLowerCase()} limits ${alternativeName}.` : !a.result.pass && b.result.pass ? `For this arrival, ${alternativeName} meets your requirements; ${LIMIT_LABEL[a.result.limiting].toLowerCase()} limits this site.` : a.result.pass ? 'Both sites meet these requirements. Compare the darkness, Earth gaps and battery reserve before choosing.' : 'Neither site meets these requirements for this arrival. Try another arrival or revise the equipment assumptions in planning.'}</p>{p.onVisit && <button className="decision-action" onClick={() => { p.onVisit?.(b.slug, b.row, p.constraints); p.onMode(null) }}>Visit {alternativeName}</button>}</>}
          {p.mode === 'why' && <details><summary>Mission events</summary><dl className="decision-events"><dt>First darkness in this mission</dt><dd>{a.firstDarkUTC ? stamp(a.firstDarkUTC) : 'None in this window'}</dd><dt>First Earth blockage in this mission</dt><dd>{a.firstEarthGapUTC ? stamp(a.firstEarthGapUTC) : 'None in this window'}</dd><dt>Mission ends</dt><dd>{stamp(a.endUTC)}</dd></dl></details>}
          {p.mode === 'arrival' && <>
            <button className="decision-action" onClick={() => { p.onArrival(a.row, p.constraints); p.onMode(null) }}>View this arrival on the surface</button>
            <p className="decision-caption">Other nearby arrivals · same mission</p>
            <div className="decision-dates">{reply.dates?.map(d => <button key={d.row} aria-pressed={d.row === row} onClick={() => setDraft(utcInput(d.row, p.startMs))}><time dateTime={d.arrivalUTC}>{stamp(d.arrivalUTC)}</time><span>{d.result.pass ? 'Meets requirements' : 'Requirements not met'}{d.result.power ? ` · ${pct(d.result.power.minPct)} lowest battery` : ''}</span></button>)}</div>
            <p>These five nearby dates are examples, not a search for the best arrival.</p>
          </>}
          <p className="decision-source">Cached JPL predictions + NASA LOLA terrain · hourly samples · nominal landing coordinate · {a.observerHeightM} m analysis height. Walking does not relocate this analysis. Earth visibility is geometry, not a verified radio link. Verdicts use unrounded model values.</p>
        </>}
        <details><summary>Equipment assumptions & data limits</summary><p>{p.constraints.power ? `${p.constraints.power.panelAreaM2} m² ${p.constraints.power.orientation} array, ${p.constraints.power.efficiencyPct}% efficiency; ${p.constraints.power.loadW} W load; ${p.constraints.power.capacityWh / 1000} kWh battery; ${p.constraints.power.initialPct}% initial charge; ${p.constraints.power.reservePct}% reserve; ${p.constraints.power.chargeEfficiencyPct}% / ${p.constraints.power.dischargeEfficiencyPct}% charge/discharge efficiencies.${p.constraints.power.orientation === 'fixed' ? ` Tilt ${p.constraints.power.tiltDeg}°, bearing ${p.constraints.power.azimuthDeg}°.` : ''}` : 'Battery and solar-array sizing are not evaluated.'} {p.constraints.thermal && p.constraints.power ? 'The selected planner thermal model is included in the verdict.' : 'Thermal limits are not evaluated.'}</p><p>Illustrative mission assumptions, not a flown vehicle. Nominal calculations exclude local walking-route changes, landing dispersion, RF link budget, suit life support and operational certification. This is a simulation, not live telemetry.</p><p>Dataset {p.index.datasetId.slice(0, 12)} · indexed {stamp(p.index.generatedUTC)} · coverage {p.index.coverage.start}–{p.index.coverage.stop}.</p></details>
        {p.extra}
        <p className="decision-caption">Viewing an arrival or another site changes the exploration scene. Your dashboard mission stays unchanged.</p>
        <details className="decision-evidence" open={p.mode !== 'why'}><summary>Site evidence and unassessed risks</summary><div className="mission-evidence-grid"><p><strong>Site evidence</strong>{p.site.kind === 'clps' ? 'Catalogued mission coordinate' : 'Candidate-region sample coordinate'}; not a certified landing area. {p.site.note}</p><p><strong>Not assessed by this verdict</strong>Landing obstacles and vehicle footprint, crew life support, route thermal exposure, radiation, rescue, launch/descent/ascent and return trajectories. Nearby touchdown and height sensitivity are shown separately under Communications and sensitivity.</p><p><strong>Data quality</strong>Hourly sky sampling and the nominal horizon’s height apply to these values. Display soil and individual rocks are illustrative. A green result means the chosen numerical requirements were met.</p></div></details>
        {p.onAsk && a && <button className="decision-ask" onClick={() => p.onAsk?.(p.mode === 'compare' ? 'Explain the site comparison on my screen using its proposed arrival, equipment and limiting requirements.' : 'Explain the mission proposal on my screen, its selected arrival and its main limitation. Distinguish it from the current scene time.')}>Ask Chader Buri about this {p.mode === 'compare' ? 'comparison' : 'arrival'}</button>}
        </>}
      </div>
    </section>}
  </aside>
}

export const MissionDecisions = memo(MissionDecisionsView)
