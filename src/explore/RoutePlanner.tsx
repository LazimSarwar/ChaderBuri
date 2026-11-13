import { memo } from 'react'
import { useState, type ReactNode } from 'react'
import type { Excursion } from './useExcursion'
import { SCIENCE_OBJECTIVES, SCIENCE_SOURCES } from './scienceObjectives'
import { routeDefaults, type RouteSettings, type LocalSky } from './routeAnalysis'
import './excursion.css'

const time = (row: number, startMs: number) => new Date(startMs + row * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
export function LocalSkyText({ name, value }: { name: string; value: LocalSky }) {
  return <span className="route-sky" data-blocked={value.status === 'blocked nearby'}>{name}: {value.status}{value.clearanceDeg !== null && ` (${value.clearanceDeg.toFixed(1)}° margin)`}<small>{value.samples ? `Sampled to ${Math.round(value.sampledToM)} m; distant skyline unassessed here.` : 'Insufficient loaded terrain in this direction.'}</small></span>
}
function NumberSetting({ name, value, onChange, min, max, step = 1, optional = false }: { name: string; value: number | null; onChange: (v: number | null) => void; min: number; max: number; step?: number; optional?: boolean }) {
  return <label>{name}<input type="number" min={min} max={max} step={step} value={value ?? ''} placeholder={optional ? 'Not supplied' : undefined} onChange={e => { const n = e.currentTarget.value === '' ? null : Number(e.currentTarget.value); if (n === null && optional) onChange(null); else if (n !== null && Number.isFinite(n) && n >= min && n <= max) onChange(n) }} /></label>
}
function RoutePlannerView({ excursion: e, map, startMs, source, onPhoto, siteKind, siteNote, observerHeightM }: { excursion: Excursion; map: ReactNode; startMs: number; source: string; onPhoto: () => void; siteKind: string; siteNote: string; observerHeightM: number }) {
  const [note, setNote] = useState(''), [pointE, setPointE] = useState(20), [pointN, setPointN] = useState(15)
  const { plan, analysis: a } = e, objective = SCIENCE_OBJECTIVES.find(o => o.id === plan.objective)!
  const update = <K extends keyof RouteSettings>(key: K, value: RouteSettings[K]) => e.setSettings({ ...plan.settings, [key]: value })
  return <div className="route-planner">
    <div className="route-actions">
      {plan.phase === 'draft' && plan.points.length > 0 && <><button className="decision-action" disabled={!a.assessedLimitsMet} onClick={e.start}>Start route preview</button><small>{a.reasons[0] ?? 'Assessed limits only; operational hazards remain unassessed.'}</small></>}
      {e.active && plan.phase !== 'at-station' && <button className="decision-action" onClick={e.resumeTravel}>Continue to {e.target?.label}</button>}
      {e.active && plan.phase !== 'at-station' && <button onClick={e.cancel}>Stop route preview</button>}
      {plan.phase === 'complete' && <><strong>Returned to the lander approach</strong><button onClick={e.exportBrief}>Download completed excursion</button></>}
    </div>
    {e.active && <details className="route-return-summary"><summary>Return ≈ {e.returnAnalysis.totalMin.toFixed(1)} min · time margin {e.returnMarginMin.toFixed(1)} min</summary><p>Return from your current position: about {e.returnAnalysis.distanceM.toFixed(0)} m. The margin is time left after that return and your chosen reserve.{!e.returnAnalysis.assessedLimitsMet && ' Return terrain or budget needs review.'} This uses avatar travel and your assumed pace, not suit telemetry.</p></details>}
    {plan.phase === 'at-station' && <div className="route-observation">
      <h3>At {e.target?.label}</h3><p>Describe terrain or lighting in this simulation. Composition and water are not measured.</p>
      <label>Observation<textarea value={note} maxLength={500} onChange={ev => setNote(ev.target.value)} placeholder="Describe the terrain, lighting or evidence still needed…" /></label>
      <button disabled={note.trim().length < 3} onClick={() => { e.observe(note); setNote('') }}>Record observation</button><button onClick={onPhoto}>Take simulated photo</button>
      <button className="decision-action" disabled={!plan.observations.some(o => o.station === e.target?.id)} onClick={e.finishTask}>Finish {e.target?.taskMin}-min activity (simulate time)</button>
    </div>}
    <p>{siteKind === 'clps' ? 'Catalogued mission coordinate' : 'Candidate-region sample coordinate'}. This point is not a certified landing area.</p>
    <p>{siteNote}</p>
    <label>Science objective<select disabled={e.active || plan.phase === 'complete'} value={plan.objective} onChange={event => e.setObjective(event.target.value as typeof plan.objective)}>{SCIENCE_OBJECTIVES.map(o => <option key={o.id} value={o.id}>{o.title}</option>)}</select></label>
    <p><strong>{objective.question}</strong></p><p>{objective.task}</p><p className="decision-caption">Instruments: {objective.instrument}. {objective.output}</p>
    <p>Choose up to six worksites on the map, or enter offsets below. Worksites are visitor-selected, not mapped rock or ice detections. The route includes return to the lander approach.</p>
    {map}
    {!e.active && plan.phase !== 'complete' && <div className="route-add">
      <NumberSetting name="Worksite east (m)" min={-249} max={249} value={pointE} onChange={n => setPointE(n ?? 0)} />
      <NumberSetting name="Worksite north (m)" min={-249} max={249} value={pointN} onChange={n => setPointN(n ?? 0)} />
      <button disabled={plan.points.length >= 6 || Math.hypot(pointE, pointN) > 249} onClick={() => e.addPoint(pointE, pointN)}>Add worksite</button>
    </div>}
    {plan.points.length === 0 ? <p role="status">Add a worksite to estimate the excursion.</p> : <>
      <dl className="route-totals"><div><dt>Whole route incl. return</dt><dd>{a.distanceM.toFixed(0)} m</dd></div><div><dt>Travel + tasks</dt><dd>{a.totalMin.toFixed(1)} min</dd></div><div><dt>Time left after return</dt><dd>{a.timeRemainingMin.toFixed(1)} min</dd></div><div><dt>Your required reserve</dt><dd>{a.timeReserveMin.toFixed(1)} min</dd></div></dl>
      <p className="decision-verdict" data-meets={a.assessedLimitsMet}>{a.assessedLimitsMet ? 'Within the limits assessed below' : 'Review the route before previewing'}<span>This does not assess EVA or landing safety.</span></p>
      <p className="decision-caption">Excursion battery: {a.resources.some(r => r.unit === 'Wh') ? 'estimated from supplied capacity and demands' : 'not assessed; capacity and demands not supplied'}. {plan.settings.mode === 'walk' && `Oxygen: ${a.resources.some(r => r.unit === 'L') ? 'estimated from your supplied budget and rate' : 'not assessed; no suit budget supplied'}.`} Suit thermal control, radio and unresolved hazards remain unassessed.</p>
      {a.reasons.length > 0 && <ul className="route-reasons">{a.reasons.map(r => <li key={r}>{r}</li>)}</ul>}
      <ol className="route-legs">{a.legs.map((leg, i) => <li key={leg.to.id}>
        <strong>{i + 1}. {leg.to.label}</strong><span>{leg.distanceM.toFixed(0)} m · {leg.minutes.toFixed(1)} min travel{leg.to.taskMin > 0 && ` + ${leg.to.taskMin} min task`}</span>
        <time>{time(leg.arrivalRow, startMs)}</time>
        <span>Maximum resolved segment slope: {leg.maxSlopeDeg === null ? 'not assessed' : `${leg.maxSlopeDeg.toFixed(1)}°`}{leg.exceedsSlope ? ' · exceeds your limit' : ''}. Missing terrain samples: {leg.missingSamples}.</span>
        <LocalSkyText name="Sun at arrival" value={leg.sun} /><LocalSkyText name="Earth at arrival" value={leg.earth} />
        {leg.to.taskMin > 0 && <details><summary>Conditions after the activity</summary><LocalSkyText name="Sun at departure" value={leg.endSun} /><LocalSkyText name="Earth at departure" value={leg.endEarth} /><p>{leg.blockedSamples} sampled route points had modelled nearby Sun obstruction at their estimated passage time.</p></details>}
        {plan.phase === 'draft' && i < plan.points.length && <button onClick={() => e.removePoint(leg.to.id)}>Remove {leg.to.label}</button>}
      </li>)}</ol>
      {a.resources.map(r => <p key={r.name}>{r.name}: {r.used.toFixed(1)} {r.unit} used; {r.remaining.toFixed(1)} {r.unit} left; {r.reserve.toFixed(1)} {r.unit} chosen reserve. {r.meets ? 'Within this supplied budget.' : 'Below the chosen reserve.'}</p>)}

    </>}



    {plan.phase === 'complete' && <p role="status">Excursion complete: returned to the lander approach. {plan.observations.length} observations recorded.</p>}
    {plan.notice && <p role="status">{plan.notice}</p>}
    <details><summary>Route and resource assumptions</summary><fieldset disabled={e.active || plan.phase === 'complete'}>
      <label>Excursion mode<select value={plan.settings.mode} onChange={ev => e.setSettings(routeDefaults(ev.target.value as RouteSettings['mode']))}><option value="walk">Astronaut walking study</option><option value="rover">Rover study</option></select></label>
      <p>Editable training assumptions. These are not NASA suit, rover or route requirements. A mode change loads its illustrative defaults.</p>
      <NumberSetting name="Planning pace (m/s)" value={plan.settings.paceMps} min={.05} max={5} step={.05} onChange={n => update('paceMps', n!)} />
      <NumberSetting name="Maximum resolved slope (°)" value={plan.settings.maxSlopeDeg} min={1} max={59} onChange={n => update('maxSlopeDeg', n!)} />
      <NumberSetting name="Excursion time budget (min)" value={plan.settings.timeBudgetMin} min={1} max={1440} onChange={n => update('timeBudgetMin', n!)} />
      <NumberSetting name="Required reserve (%)" value={plan.settings.reservePct} min={0} max={90} onChange={n => update('reservePct', n!)} />
      <NumberSetting optional name="Excursion battery capacity (Wh)" value={plan.settings.batteryWh} min={1} max={100000} onChange={n => update('batteryWh', n)} />
      <NumberSetting optional name="Demand while travelling (W)" value={plan.settings.travelW} min={1} max={100000} onChange={n => update('travelW', n)} />
      <NumberSetting optional name="Demand while working (W)" value={plan.settings.taskW} min={1} max={100000} onChange={n => update('taskW', n)} />
      {plan.settings.mode === 'walk' && <><NumberSetting optional name="Usable oxygen (L)" value={plan.settings.oxygenL} min={1} max={100000} onChange={n => update('oxygenL', n)} /><NumberSetting optional name="Assumed oxygen consumption (L/min)" value={plan.settings.oxygenLpm} min={.01} max={100} step={.01} onChange={n => update('oxygenLpm', n)} /></>}
    </fieldset></details>
    <details><summary>Evidence, coverage and remaining gaps</summary><p>{source}. Local obstruction uses the loaded DEM and sky directions at the nominal site, at {observerHeightM.toFixed(1)} m observer height. “Clear in sampled area” is not a verified far-field horizon or RF link. Slopes describe resolved DEM segments; decorative rocks are not surveyed obstacles.</p><ul>{a.unassessed.map(item => <li key={item}>{item}</li>)}</ul><p>Thermal control, radiation, dust, emergency rescue, launch/descent/ascent and vehicle certification need separate data and assessments. They are not passed by this preview.</p><ul>{SCIENCE_SOURCES.map(s => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}</ul></details>
    {plan.observations.length > 0 && <details><summary>Recorded observations ({plan.observations.length})</summary>{plan.observations.map(o => <p key={o.station}>{o.note} · {time(o.sceneRow, startMs)}</p>)}</details>}
    <div className="route-footer"><button onClick={e.refresh}>Refresh terrain estimates</button><button disabled={!plan.points.length} onClick={e.exportBrief}>Export excursion brief</button>{plan.phase === 'at-station' && <button onClick={e.cancel}>Stop route preview</button>}{plan.phase === 'complete' && <button onClick={e.cancel}>Review a new departure</button>}</div>
  </div>
}
export function ExcursionStatus({ excursion: e, onOpen }: { excursion: Excursion; onOpen: () => void }) {
  if (!e.active && e.plan.phase !== 'complete') return null
  return <section className="excursion-status pointer-events-auto" aria-label="Excursion progress"><strong>{e.plan.phase === 'complete' ? 'Back at the lander approach' : e.plan.phase === 'at-station' ? `At ${e.target?.label}` : `Heading to ${e.target?.label}`}</strong><span>{e.plan.phase === 'at-station' ? 'Record an observation, then finish the simulated task.' : 'Route preview · conditions and budgets are estimates.'}</span>{e.active && <span>Return ≈ {e.returnAnalysis.totalMin.toFixed(1)} min · time margin {e.returnMarginMin.toFixed(1)} min{!e.returnAnalysis.assessedLimitsMet ? ' · review return conditions' : ''}</span>}<div><button onClick={onOpen}>{e.plan.phase === 'complete' ? 'Review excursion' : 'Open route'}</button>{e.active && <button onClick={e.cancel}>Stop route</button>}</div></section>
}

export const RoutePlanner=memo(RoutePlannerView)
