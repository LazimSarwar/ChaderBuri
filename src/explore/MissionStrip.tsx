import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { MissionDecisions, type MissionDecisionProps, type DecisionMode } from './MissionDecisions'
import type { ConsoleRequest, ConsoleReply } from './missionConsole.worker'
import { AccuracyBadge } from './AccuracyBadge'
import type { AccuracyScope } from './accuracyText'
import { countdown } from './missionEvents'
import { landingZones } from './landingZone'
import type { TerrainSampler } from './terrainGrid'
import { LIMIT_LABEL, utcInput } from './missionReadout'
import { useScreenDigest } from '../lib/screenDigest'
import { consoleGlanceStore } from './consoleGlanceStore'
import { SiteComparison } from './SiteComparison'
import { missionPhase, missionPlanningRow } from './explorationJourney'
import { missionEventLabel, MISSION_EVENT_TIMING_NOTE } from './surfacePresentation'
import './mission-strip.css'

type Props = MissionDecisionProps & { visitKey: string; landingRow: number; sampler: TerrainSampler | null; resolutionM: number; heightM: number; groundSource: string; timeOpen: boolean; menuOpen: boolean; onMenu: (open: boolean) => void; onJump: (row: number) => void; onRecord: (text: string) => void; onReview?: () => void }
const modes = ['why', 'compare', 'arrival', 'events', 'ground', 'link'] as const
const stamp = (row: number, start: number) => utcInput(row, start).replace('T', ' ') + ' UTC'
export const MissionStrip = memo(function MissionStrip(p: Props) {
  const [arrival, setArrival] = useState(() => missionPlanningRow(p.landingRow) ?? 0), [retry, setRetry] = useState(0)
  const phoneMenu = p.menuOpen, setPhoneMenu = p.onMenu
  const [state, setState] = useState<{ key: string; reply: ConsoleReply } | null>(null)
  const worker = useRef<Worker | null>(null), serial = useRef(0), proposal = useRef(p.onProposal); proposal.current = p.onProposal
  const constraintsKey = JSON.stringify(p.constraints), slugs = p.sites.map(s => s.slug).join('|')
  const calendar = p.mode === 'arrival', key = JSON.stringify([p.index.datasetId, p.site.slug, arrival, constraintsKey, calendar, retry])
  useEffect(() => { setArrival(missionPlanningRow(p.landingRow) ?? 0) }, [p.site.slug, p.landingRow])
  useEffect(() => () => { worker.current?.terminate(); worker.current = null; proposal.current?.(null) }, [])
  useEffect(() => {
    const id = ++serial.current; let done = false, received = false
    const timeout = setTimeout(() => { if (!done && !received) { worker.current?.terminate(); worker.current=null;setState({key,reply:{id,error:'Mission data took too long to load. Retry the console.'}}) } }, 30000)
    const w = worker.current ??= new Worker(new URL('./missionConsole.worker.ts', import.meta.url), { type: 'module' })
    setState(null)
    w.onmessage = ({ data }: MessageEvent<ConsoleReply>) => { if (!done && data.id === id) {received=true;clearTimeout(timeout);setState(previous => ({ key, reply: { ...(previous?.key === key ? previous.reply : {}), ...data } }))} }
    w.onerror = () => { if (!done) setState({ key, reply: { id, error: 'The mission worker stopped. Retry to reload it.' } }); w.terminate(); worker.current = null }
    const request: ConsoleRequest = { id, index: p.index, slugs: slugs.split('|'), slug: p.site.slug, row: arrival, c: JSON.parse(constraintsKey), calendar }
    w.postMessage(request)
    return () => { done = true; clearTimeout(timeout) }
  }, [key, slugs])
  const reply = state?.key === key ? state.reply : null, current = reply?.current
  const zones = useMemo(() => landingZones(p.sampler, p.resolutionM), [p.sampler, p.resolutionM]), zone = zones[1]
  const name = (slug: string) => p.sites.find(s => s.slug === slug)?.name ?? slug
  const rank = reply?.ranks?.find(s => s.slug === p.site.slug), complete = reply?.loaded === reply?.total
  const next = reply?.events?.find(e => e.row > p.row), days = reply?.days ?? []
  const nextDay = days.find(d => d.row !== null && d.row >= arrival)
  const selectedDay = new Date(p.startMs + arrival * 3600000).toISOString().slice(0, 7), [month, setMonth] = useState(selectedDay)
  const availableMonths = [...new Set(days.map(d => new Date(p.startMs + d.day * 86400000).toISOString().slice(0, 7)))]
  useEffect(() => { setMonth(selectedDay) }, [selectedDay])
  const monthDays = days.filter(d => new Date(p.startMs + d.day * 86400000).toISOString().startsWith(month))
  const fmt = (n: number | undefined | null, unit = '%') => n == null ? 'Not assessed' : `${n.toFixed(1)}${unit}`
  const badge = (scope: AccuracyScope) => <AccuracyBadge scope={scope} resolutionM={p.resolutionM} heightM={p.heightM} validationNote={reply?.validationNote} />
  const open = (mode: DecisionMode) => { setPhoneMenu(false); p.onMode(p.mode === mode ? null : mode) }
  const callbacks = useRef({ mode: p.mode, onMode: p.onMode }); callbacks.current = { mode: p.mode, onMode: p.onMode }
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || (e.target as Element | null)?.closest('input,textarea,select,[contenteditable],dialog')) return; const n = Number(e.key); if (n >= 1 && n <= 6) { e.preventDefault(); const mode = modes[n - 1]; callbacks.current.onMode(callbacks.current.mode === mode ? null : mode); setPhoneMenu(false) } }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [])
  useEffect(() => {
    if (!p.mode || p.mode === 'route') { proposal.current?.(null); return }
    if (p.mode !== 'why') proposal.current?.({ slug: p.site.slug, row: arrival, sceneRow: Math.round(p.row), constraints: JSON.parse(constraintsKey), basis: p.basis })
  }, [p.mode, arrival, constraintsKey, p.site.slug, p.row, p.basis])
  const example = p.basis === 'Illustrative exploration mission'
  const verdict = current ? `${current.pass ? 'Meets' : 'Misses'} ${example ? 'example mission limits' : 'mission requirements'} · tightest: ${LIMIT_LABEL[current.limiting].toLowerCase()}` : reply?.error ? 'Unavailable · retry inside' : 'Calculating…'
  const rankText = rank ? `#${rank.rank} of ${reply?.ranks?.length} ${complete ? 'sites' : 'loaded'} · same arrival` : reply?.error ? 'Unavailable' : 'Loading sites…'
  const eventText = next ? `${missionEventLabel(next)} ${countdown(next.row, p.row)}` : reply?.events ? 'No later event in mission' : 'Loading events…'
  const linkText = reply?.comms?.opportunityPct != null ? `${fmt(reply.comms.opportunityPct)} Earth + DSN` : reply?.comms ? 'DSN coverage unavailable' : 'Loading DSN…'
  const groundText = zone.maxSlopeDeg !== null ? `Sampled max ${zone.maxSlopeDeg.toFixed(1)}° · 25 m` : 'Terrain unavailable'
  const titles = ['Why this site', 'Compare sites', 'Arrival time', 'Mission timeline', 'Landing-zone terrain', 'Mission communications']
  // Chip labels are the visitor's questions; the number is the keyboard shortcut.
  const labels = ['Why this site?', 'Compare sites', 'When to arrive', 'What happens next', 'Landing area', 'Earth link']
  const phase = missionPhase(p.row, arrival, p.constraints.missionDays)
  const verdictGlance = current ? `${current.pass ? 'Meets' : 'Misses'} · tightest: ${LIMIT_LABEL[current.limiting].toLowerCase()}` : verdict
  const glances = [verdictGlance, rankText, reply?.nextRow != null ? `Next passing ${stamp(reply.nextRow,p.startMs).slice(0,10)}` : reply?.current ? 'None in next 90 d' : 'Searching arrivals…', eventText, groundText, linkText]
  useEffect(() => {
    const earthset = reply?.events?.find(e => e.label === 'Earthset' && e.row > p.row)
    consoleGlanceStore.publish({ visitKey:p.visitKey,siteName:p.site.name,arrivalUTC:stamp(arrival,p.startMs),sceneUTC:stamp(p.row,p.startMs),verdict, next: eventText, link: linkText, battery: current?.power ? `${current.power.minPct.toFixed(1)}% mission minimum` : 'Battery not assessed', timeline: reply?.events?.slice(0, 8).map(e => `${stamp(e.row, p.startMs)} ${missionEventLabel(e)}`) ?? [], ranking: reply?.ranks?.slice(0, 5).map(r => `#${r.rank} ${name(r.slug)}: ${r.result.pass ? 'meets' : 'misses'}`) ?? [],
      antennaMission: current ? { days: p.constraints.missionDays, basis: p.basis, earthPct: current.linkPct, longestEarthGapH: current.longestGapH, minEarthPct: p.constraints.minLinkPct, maxEarthGapH: p.constraints.maxGapH, opportunityPct: reply?.comms?.opportunityPct ?? null, longestOpportunityGapH: reply?.comms?.longestGapH ?? null, nextEarthsetUTC: earthset ? stamp(earthset.row,p.startMs) : null, phase: phase?.state ?? 'during' } : null,
    })
  }, [verdict, eventText, linkText, reply, p.startMs, p.visitKey, p.site.name, arrival, p.row, constraintsKey, p.basis, phase?.state])
  const digest = current ? [
    { id: 'console-site', label: 'Mission console site and arrival', value: `${p.site.name} ${stamp(arrival, p.startMs)}` },
    { id: 'console-verdict', label: 'Selected requirements', value: verdict },
    { id: 'console-rank', label: 'Same mission ranking', value: rankText },
    { id: 'console-event', label: 'Next modelled event from scene clock', value: eventText },
    { id: 'console-link', label: 'Mission-wide estimated station opportunity', value: linkText },
    { id: 'console-ground', label: `Resolved terrain (${p.resolutionM} m DEM)`, value: groundText },
    ...(p.mode === 'compare' ? (reply?.ranks ?? []).map(r => ({ id: `site-${r.slug}`, label: `${r.rank}. ${name(r.slug)}`, value: `${r.result.pass?'Meets':'Misses'};Sun${r.result.litPct.toFixed(1)}%;dark${r.result.longestDarkH}h;Earth${r.result.linkPct.toFixed(1)}%;gap${r.result.longestGapH}h;bat${r.result.power?.minPct.toFixed(1)??'n/a'}%;T${r.result.thermal?.minTempK.toFixed(1)??'n/a'}`, source: 'Same arrival, equipment and duration; nominal solver. T is lander K, not suit temperature.' })) : []),
    ...(p.mode === 'link' && reply?.comms ? [{ id:'comms-coverage',label:'Station geometry coverage',value:`${reply.comms.knownHours}/${reply.comms.hours} hours`,source:'Cached DSN geometry; missing geometry means unavailable, not zero opportunity.' },{id:'comms-gap',label:'Longest gap without Earth + DSN opportunity',value:fmt(reply.comms.longestGapH,' h')},...reply.comms.stations.map(s=>({id:`dsn-${s.name}`,label:`${s.name} simultaneous opportunity`,value:fmt(s.pct),source:'Earth visible and station elevation ≥6°; not a booking or an RF guarantee.'}))] : []),
    ...(p.mode === 'ground' ? zones.map(z=>({id:`zone-${z.radiusM}`,label:`Resolved ground inside ${z.radiusM} m`,value:`sampled max ${fmt(z.maxSlopeDeg,'°')}; relief ${fmt(z.reliefM,' m')}; coverage ${fmt(100*z.coverage)}`,source:`LOLA ${z.resolutionM} m pixels${z.interpolated?'; coarse/interpolated zone':''}. Sub-resolution hazards unassessed.`})) : []),
    ...(p.mode === 'events' ? (reply?.events??[]).filter(e=>e.row>=p.row).slice(0,5).map(e=>({id:`event-${e.id}`,label:missionEventLabel(e),value:stamp(e.row,p.startMs),source:e.note})) : []),
    ...(p.mode === 'arrival' ? (reply?.slips??[]).map(s=>({id:`slip-${s.offsetH}`,label:`Arrival shift ${s.offsetH} h`,value:s.pass===null?'Outside complete-mission coverage':s.pass?'Meets chosen nominal requirements':'Requirements not met',source:'Thirteen discrete nominal starts at 12-hour spacing; not continuous slip tolerance.'})) : []),
  ] : null
  useScreenDigest('surface-console', digest, JSON.stringify(digest))
  const legacy = p.mode === 'why' || p.mode === 'route'
  return <div className="mission-console">
    <aside className="field-decisions mission-strip pointer-events-auto" aria-label="Surface mission decisions">
      <p className="mission-strip-context" data-outside={phase?.outside || undefined}>
        <span>{example ? 'Example mission' : 'Plan'}: <time>{stamp(arrival,p.startMs)}</time> · {p.constraints.missionDays} days</span>
        {phase?.outside && <span className="mission-outside">{phase.label}{!p.timeOpen && <button onClick={() => p.onJump(arrival)}>Return to arrival</button>}</span>}
      </p>
      <nav className="decision-shortcuts mission-chips" aria-label="Mission choices" data-expanded={phoneMenu || undefined}>
        {modes.map((mode, i) => <button key={mode} aria-label={titles[i]} aria-keyshortcuts={String(i + 1)} aria-expanded={p.mode === mode} data-meets={i === 0 && current ? current.pass : undefined} onClick={() => open(mode)}><span>{labels[i]}<kbd aria-hidden="true">{i + 1}</kbd></span><strong title={glances[i]}>{glances[i]}</strong></button>)}
        <button className="mission-phone-toggle" aria-label={phoneMenu ? 'Close mission choices' : 'Open mission choices'} aria-expanded={phoneMenu} onClick={() => setPhoneMenu(!phoneMenu)}><span>{phoneMenu ? 'Close mission' : 'Mission'}</span><strong>{phoneMenu ? 'Close choices' : 'All 6 tools'}</strong></button>
        <button className="mission-route" aria-label="Plan route" aria-expanded={p.mode === 'route'} onClick={() => open('route')}>Plan route</button><button className="mission-return" aria-label="Return to lander" onClick={() => { setPhoneMenu(false); p.onReturn() }}>Return to lander</button>
        {p.onReview && <button className="mission-review" onClick={() => { setPhoneMenu(false); p.onReview?.() }}>Review field assignment</button>}
      </nav>
      {p.mode && !legacy && <section className="decision-readout console-sheet" aria-label={titles[modes.indexOf(p.mode as typeof modes[number])]}><header><h2>{titles[modes.indexOf(p.mode as typeof modes[number])]}</h2><button aria-label="Close mission readout" onClick={() => p.onMode(null)}>×</button></header><div className="decision-body">
        <p>{p.site.name} · arrival {stamp(arrival, p.startMs)} · {p.constraints.missionDays} days</p><p className="decision-caption">{p.basis}. Same equipment and numerical requirements. Scene: {stamp(p.row, p.startMs)}.</p>
        {reply?.error ? <p role="alert">{reply.error} <button onClick={() => setRetry(n => n + 1)}>Retry mission console</button></p> : !current ? <p role="status">Loading verified products and calculating…</p> : <>
        {p.mode === 'compare' && <><SiteComparison ranks={reply?.ranks ?? []} slug={p.site.slug} name={name} context={`Arrival ${stamp(arrival,p.startMs)}; ${p.constraints.missionDays} days; ${p.basis}; same equipment and requirements`} onVisit={p.onVisit ? slug => { p.onVisit?.(slug, arrival, p.constraints); p.onMode(null) } : undefined} onRecord={p.onRecord} /><details className="comparison-full"><summary>All sites and detailed numbers ({reply?.loaded} of {reply?.total} loaded)</summary>{badge('ranking')}<p>Sites meeting your requirements come first, then the largest minimum margin across your limits. Exact ties retain catalogue order. {reply?.unavailable?.length ? `${reply.unavailable.length} sites unavailable; this list is incomplete.` : ''}</p><div className="console-table"><table><caption>Same arrival, mission duration and equipment</caption><thead><tr>{['Rank / site', 'Your requirements', 'Tightest', 'Sun %', 'Longest dark h', 'Earth %', 'Longest Earth gap h', 'Lowest battery %', 'Coldest lander K'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{reply?.ranks?.map(r => <tr key={r.slug} aria-current={r.slug === p.site.slug || undefined}><th>#{r.rank} {name(r.slug)}{r.slug === p.site.slug ? <small className="console-here">You are here</small> : p.onVisit && <button className="console-visit" aria-label={`Visit ${name(r.slug)}`} onClick={() => { p.onVisit?.(r.slug, arrival, p.constraints); p.onMode(null) }}>Visit</button>}</th><td>{r.result.pass ? 'Meets' : 'Misses'}</td><td>{LIMIT_LABEL[r.result.limiting]}</td><td>{fmt(r.result.litPct, '')}{badge('illumination')}</td><td>{fmt(r.result.longestDarkH, '')}</td><td>{fmt(r.result.linkPct, '')}{badge('earth')}</td><td>{fmt(r.result.longestGapH, '')}</td><td>{fmt(r.result.power?.minPct, '')}{badge('power')}</td><td>{fmt(r.result.thermal?.minTempK, '')}{badge('thermal')}</td></tr>)}</tbody></table></div><p>Same arrival, duration and equipment. Separate footprint and RF checks do not change this nominal ranking.</p></details></>}
        {p.mode === 'arrival' && <>{badge('time')}<label>Proposed arrival (UTC)<input type="datetime-local" step={3600} min={utcInput(0,p.startMs)} max={utcInput(p.index.coverage.samples-1-p.constraints.missionDays*24,p.startMs)} value={utcInput(arrival,p.startMs)} onChange={e=>{const row=(Date.parse(e.target.value+'Z')-p.startMs)/3600000;if(Number.isInteger(row))setArrival(row)}} /></label><p>{verdict}. {nextDay?.row != null ? `Next sampled passing day at or after this arrival: ${stamp(nextDay.row, p.startMs)}.` : reply?.calendarComplete ? 'No sampled passing day at or after this arrival.' : 'Searching passing dates…'}</p><button className="decision-action" disabled={!current} onClick={()=>{p.onArrival(arrival,p.constraints);p.onMode(null)}}>View this arrival on the surface</button><label>Calendar month<select value={availableMonths.includes(month)?month:availableMonths[0]??month} onChange={e=>setMonth(e.target.value)}>{availableMonths.map(m=><option key={m}>{m}</option>)}</select></label><p className="decision-caption">Four starts per UTC day (00, 06, 12, 18). Filled cells have a passing sampled arrival; empty cells have none among these four. {reply?.calendarComplete?'Full cached coverage searched.':`Searching… ${days.length} days ready.`}</p><div className="console-calendar" aria-label="Sampled landing calendar">{monthDays.map(d=><button key={d.day} disabled={d.row===null} aria-label={`${new Date(p.startMs+d.day*86400000).toISOString().slice(0,10)} ${d.row===null?'no passing sampled start':`passing at ${stamp(d.row,p.startMs)}, margin ${d.margin?.toFixed(3)}`}`} aria-pressed={d.row===arrival} data-pass={d.row!==null} onClick={()=>d.row!==null&&setArrival(d.row)}>{new Date(p.startMs+d.day*86400000).getUTCDate()}<small>{d.row===null?'—':`${d.row%24}:00`}</small></button>)}</div><h3>Arrival slip sensitivity</h3><p>Thirteen starts at 12-hour spacing, ±72 hours. Nominal requirements only; this is not a continuous tolerance guarantee.</p><div className="console-slips">{reply?.slips?.map(s=><button key={s.offsetH} disabled={s.pass===null} onClick={()=>setArrival(s.row)}>{s.offsetH>0?'+':''}{s.offsetH} h · {s.pass===null?'outside coverage':s.pass?'meets':'misses'}</button>)}</div></>}
        {p.mode === 'events' && <>{badge('time')}<p>Counted from the scene clock; events belong to the mission beginning {stamp(arrival,p.startMs)}. Selecting an event pauses the clock and changes only the scene.</p><p className="field-event-method">{MISSION_EVENT_TIMING_NOTE}</p><ol className="console-events">{reply?.events?.map(e=><li key={e.id}><button onClick={()=>p.onJump(e.row)}><strong>{missionEventLabel(e)}</strong><time>{stamp(e.row,p.startMs)} · {countdown(e.row,p.row)}</time></button><p>{e.note}</p></li>)}</ol></>}
        {p.mode === 'ground' && <>{badge('ground')}<p>{p.groundSource}. Landing area: estimates around the nominal landing coordinate. To inspect where you are standing, use Inspect under More or press E. A maximum sampled slope is not a bound on hazards between samples.</p><table><caption>Resolved terrain around the landing point</caption><thead><tr><th>Radius</th><th>Max sampled slope</th><th>Relief</th><th>Coverage</th></tr></thead><tbody>{zones.map(z=><tr key={z.radiusM}><th>{z.radiusM} m{z.interpolated?' (coarse/interpolated)':''}</th><td>{fmt(z.maxSlopeDeg,'°')}</td><td>{fmt(z.reliefM,' m')}</td><td>{fmt(100*z.coverage)}</td></tr>)}</tbody></table><p>Small rocks, craterlets, regolith strength and landing-vehicle clearance are unassessed. Footprint sensitivity is a separate visibility/battery check under Why this site? → Communications and sensitivity at this arrival, not a landing hazard map.</p></>}
        {p.mode === 'link' && <>{badge('comms')}<p>Earth visible: {fmt(reply?.comms?.earthPct)}. Earth plus at least one Deep Space Network (DSN) ground station: {fmt(reply?.comms?.opportunityPct)}. Longest interval without a simultaneous opportunity: {fmt(reply?.comms?.longestGapH,' h')}.</p><table><caption>Hourly opportunity with Earth visible and station elevation ≥6°</caption><tbody>{reply?.comms?.stations.map(s=><tr key={s.name}><th>{s.name}</th><td>{fmt(s.pct)}</td></tr>)}</tbody></table><p>{reply?.comms?`${reply.comms.knownHours}/${reply.comms.hours} hours have complete cached station geometry.`:'Loading cached DSN geometry…'} This does not check bookings, antenna pointing, interference, vehicle RF hardware or operational relays. Snapshot X-band link estimates are under Why this site? → Communications and sensitivity at this arrival.</p></>}
        </>}
        {p.onAsk && current && <button className="decision-ask" onClick={()=>p.onAsk?.('Explain the mission console on my screen, its selected arrival, ranking and limitations. Distinguish the proposal from the scene clock.')}>Ask Chader Buri about this</button>}
      </div></section>}
    </aside>
    {legacy && <MissionDecisions {...p} row={arrival} sceneRow={p.row} validationNote={reply?.validationNote} sourceResolutionM={p.resolutionM} extra={<>    {reply?.failure && <div className="console-repair-summary pointer-events-auto"><strong>{reply.failure.title}</strong><span>{reply.failure.explanation}</span>{reply.repairs?.map((r,i)=><button key={i} onClick={()=>p.onArrival(arrival,r.c)}>Preview verified repair: {r.label}</button>)}</div>}</>} hideNav />}

  </div>
})
