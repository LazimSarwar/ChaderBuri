import { Globe2, Pause, Play, RotateCcw, Sun } from 'lucide-react'
import { formatEta } from './fieldMath'
import { TIME_SOURCE, type FieldEvent } from './fieldJourney'
import { formatOffsetHours, formatSimUTC } from './fieldMath'
import { missionPhase, missionPlanningRow, timeReturnTargets } from './explorationJourney'
import { CROSSING_TIMING_NOTE } from './surfacePresentation'

type Props = {
  row: number
  epoch: Date
  startMs: number
  totalHours: number
  playing: boolean
  speed: number
  arrivalRow: number | null
  missionRow: number | null
  /** Mission days use the active exploration mission, independently of the first surface visit. */
  missionDays?: number | null
  onTime: (row: number) => void
  onTogglePlay: () => void
  onSpeed: (secondsPerSecond: number) => void
  /** Next sunrise, sunset, earthrise and earthset at the landing point (calculated). */
  events: FieldEvent[]
  onEvent: (e: FieldEvent) => void
  /** After a jump: what changed since the time you left, and the way back. */
  changed: string[] | null
  onBackBefore: { row: number; label: string; run: () => void } | null
}
const SPEEDS: [number, string][] = [[600, '10 min/s'], [3600, '1 h/s'], [21600, '6 h/s']]
const STEPS: [number, string, string][] = [[-24, '−1 day', 'Back one day'], [-1, '−1 h', 'Back one hour'], [1, '+1 h', 'Forward one hour'], [24, '+1 day', 'Forward one day']]

/** The simulation clock: step, play, and return to the arrival or mission landing time. */
export function TimePanel(p: Props) {
  const last = p.totalHours - 1
  const canStep = (h: number) => p.row + h >= 0 && p.row + h <= last
  const go = (row: number) => p.onTime(Math.max(0, Math.min(last, row)))
  const fmt = (ms: number) => formatSimUTC(new Date(ms)).replace(' UTC', '')
  const missionStart = missionPlanningRow(p.missionRow ?? p.arrivalRow)
  const phase = (row: number) => missionPhase(row, missionStart, p.missionDays)?.label
  const outside = missionPhase(p.row, missionStart, p.missionDays)?.outside
  const returns = timeReturnTargets(p.row, p.arrivalRow, p.onBackBefore?.row ?? null, missionStart)
  const stamp = (row: number) => formatSimUTC(new Date(p.startMs + row * 3_600_000))
  const distinctVisit = p.arrivalRow !== null && (missionStart === null || Math.abs(p.arrivalRow - missionStart) >= .01)
  return <div className="field-time">
    <p className="field-label">Simulation time · UTC</p>
    <p className="field-clock"><time dateTime={p.epoch.toISOString()}>{formatSimUTC(p.epoch)}</time></p>
    <p className="field-offsets">
      {phase(p.row) && <span className="field-mission-phase"><strong>{phase(p.row)}</strong></span>}
      {missionStart !== null && <span>Mission arrival {stamp(missionStart)} · {formatOffsetHours(p.row - missionStart)}</span>}
      {distinctVisit && <span>First visit {stamp(p.arrivalRow!)} · {formatOffsetHours(p.row - p.arrivalRow!)}</span>}
    </p>
    {distinctVisit && <p className="field-event-note">Mission arrival uses the nearest hourly prediction sample. First visit keeps its exact scene time.</p>}
    {outside && <div className="field-time-outside"><strong>Viewing outside your planned mission</strong></div>}
    {returns.length > 0 && <div className="field-time-returns" role="group" aria-label="Return to a planned or previous time">
      {returns.map(t => <button key={t.kind} className="field-button" onClick={() => t.kind === 'previous' && p.onBackBefore ? p.onBackBefore.run() : go(t.row)}><RotateCcw size={14} aria-hidden="true" />{t.kind === 'mission' ? 'Return to mission arrival' : t.kind === 'visit' ? 'Return to first visit' : p.onBackBefore!.label}</button>)}
    </div>}
    {p.changed && <div className="field-changed" role="status"><p className="field-kicker">{p.onBackBefore ? `Compared with ${stamp(p.onBackBefore.row)}` : 'What changed'} <span className="field-tag">Calculated</span></p><ul>{p.changed.map(l => <li key={l}>{l}</li>)}</ul></div>}
    <div className="field-time-row" role="group" aria-label="Step the simulation clock">
      {STEPS.slice(0, 2).map(([h, label, aria]) => <button key={h} className="field-button" aria-label={aria} disabled={!canStep(h)} onClick={() => go(Math.round(p.row) + h)}>{label}</button>)}
      <button className="field-button field-play" aria-pressed={p.playing} onClick={p.onTogglePlay}>{p.playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{p.playing ? 'Pause' : 'Play'}</button>
      {STEPS.slice(2).map(([h, label, aria]) => <button key={h} className="field-button" aria-label={aria} disabled={!canStep(h)} onClick={() => go(Math.round(p.row) + h)}>{label}</button>)}
    </div>
    <div className="field-speed" role="radiogroup" aria-label="Playback speed">
      {SPEEDS.map(([v, label]) => <button key={v} role="radio" aria-checked={p.speed === v} onClick={() => p.onSpeed(v)}>{label}</button>)}
    </div>
    <h3 className="field-subhead">Jump to an event</h3>
    <p className="field-event-note">Event previews show the scene 15 minutes after the crossing, so you can see its effect.</p>
    <p className="field-event-method">{CROSSING_TIMING_NOTE}</p>
    {p.events.length === 0 ? <p className="field-source">No sunrise, sunset, earthrise or earthset within the loaded predictions.</p>
      : <ul className="field-events">{p.events.map(e => <li key={e.kind}><button className="field-event" data-body={e.body} onClick={() => p.onEvent(e)}>
        {e.body === 'sun' ? <Sun size={16} aria-hidden="true" /> : <Globe2 size={16} aria-hidden="true" />}<span><strong>{e.label}</strong><small>{formatEta(e.hours)} · {e.atUTC} UTC{phase(p.row + e.hours) && ` · ${phase(p.row + e.hours)}`}</small></span></button></li>)}</ul>}
    <p className="field-source">Time moves the Sun and Earth across hourly JPL Horizons predictions ({fmt(p.startMs)} to {fmt(p.startMs + last * 3_600_000)} UTC). Your position on the ground does not change. {TIME_SOURCE}</p>
  </div>
}
