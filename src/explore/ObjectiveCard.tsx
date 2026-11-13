import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { consoleGlanceStore, glanceForVisit } from './consoleGlanceStore'
import { antennaMissionText } from './antennaMission'
import { Check, ChevronDown, ChevronUp, Clock3, Footprints, Globe2, Radio, RotateCcw } from 'lucide-react'
import { NextActivities } from './ActivityCard'
import { formatSimUTC } from './fieldMath'
import type { ActivityId } from './fieldJourney'
import { OBJECTIVE_TITLE, earthSkylineText, objectiveDoneCount, objectiveStage, objectiveSummaryText, type ObjectiveProgress, type ObjectiveStep } from './fieldObjective'
import './antenna-result.css'

type Props = {
  visitKey: string
  reveal: number
  progress: ObjectiveProgress
  steps: ObjectiveStep[]
  /** Phones and narrow windows start collapsed; the choice there is not saved. */
  narrow: boolean
  /** Something else needs the screen (a tool sheet or card on a phone): show the one-line bar only. */
  compact: boolean
  onReadingChange?: (reading: boolean) => void
  earthHidden: boolean
  onFaceEarth: () => void
  onWalk: () => void
  onOpenAntenna: () => void
  onOpenTime: () => void
  onReturnToArrival: (() => void) | null
  onCompare: () => void
  onEarthLink: () => void
  onDecisionReview: () => void
  onRecordObservation: () => void
  onCollapse: (collapsed: boolean) => void
  onFree: () => void
  onRestart: () => void
  /** After completion: the other activities to offer. */
  next: ActivityId[]
  onActivity: (id: ActivityId) => void
}

/** The first activity, top left: three steps with live progress, one clear next action, and a way out. */
export function ObjectiveCard(p: Props) {
  const id = useId(), stage = objectiveStage(p.progress), done = objectiveDoneCount(p.progress), complete = stage === 'done'
  const [phoneOpen, setPhoneOpen] = useState(false)
  useEffect(() => { if (p.reveal > 0) setPhoneOpen(true) }, [p.reveal])
  // Finishing the objective opens the card once on a phone so the summary is seen.
  const wasComplete = useRef(complete)
  useEffect(() => { if (complete && !wasComplete.current) setPhoneOpen(true); wasComplete.current = complete }, [complete])
  const open = !p.compact && (p.narrow ? phoneOpen : !p.progress.collapsed)
  useEffect(()=>{p.onReadingChange?.(p.narrow && open)},[p.narrow,open,p.onReadingChange])
  useEffect(()=>()=>p.onReadingChange?.(false),[p.onReadingChange])
  const toggle = () => { if (p.narrow) setPhoneOpen(o => !o); else p.onCollapse(open) }
  const current = p.steps.find(s => s.current)
  // The mission console's whole-mission prediction, so the one-moment test is read against the site decision.
  const storedGlance = useSyncExternalStore(consoleGlanceStore.subscribe, consoleGlanceStore.getSnapshot)
  const glance = glanceForVisit(storedGlance, p.visitKey, '')
  const consequence = glance.antennaMission ? antennaMissionText(glance.antennaMission) : null
  const recordedAt = p.progress.summary && <p className="field-recorded-at"><time dateTime={p.progress.summary.sceneUTC}>Recorded {formatSimUTC(new Date(p.progress.summary.sceneUTC))}</time></p>
  const primaryActions = <div className="field-journey-actions field-antenna-primary" aria-label="Review the mission consequence">
    <button className="field-button is-primary" onClick={p.onEarthLink}>Review Earth link</button>
    <button className="field-button" onClick={p.onCompare}>Compare another site</button>
  </div>
  const action = stage === 'find' ? (p.earthHidden ? { label: 'Choose a time to see Earth', icon: Clock3, run: p.onOpenTime } : { label: 'Turn to face Earth', icon: Globe2, run: p.onFaceEarth })
    : stage === 'walk' ? { label: 'Walk there', icon: Footprints, run: p.onWalk }
    : stage === 'point' ? (p.earthHidden ? { label: 'Open Time', icon: Clock3, run: p.onOpenTime } : { label: 'Open the antenna', icon: Radio, run: p.onOpenAntenna })
    : null
  return <section className="field-objective pointer-events-auto" aria-labelledby={id + 'title'} data-open={open} data-complete={complete} data-narrow={p.narrow || undefined}>
    <button className="field-objective-head" aria-expanded={open} aria-controls={id + 'body'} onClick={toggle}>
      <span className="field-objective-kicker">{complete ? 'Objective complete' : `Objective · ${done} of 3`}</span>
      <strong id={id + 'title'}>{OBJECTIVE_TITLE}</strong>
      {!open && current && <span className="field-objective-now">Now: {current.label}</span>}
      {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      <span className="sr-only">{open ? 'Collapse objective' : 'Expand objective'}</span>
    </button>
    <div className="field-objective-meter" role="progressbar" aria-label="Objective progress" aria-valuemin={0} aria-valuemax={3} aria-valuenow={done} aria-valuetext={`${done} of 3 steps`}><i style={{ width: `${done / 3 * 100}%` }} /></div>
    {open && <div className="field-objective-body" id={id + 'body'}>
      {action && <button className="field-button is-primary field-objective-action" onClick={action.run}><action.icon size={16} aria-hidden="true" />{action.label}</button>}
      {!complete && <ol className="field-objective-steps">
        {p.steps.map((s, i) => <li key={s.id} data-done={s.done} data-current={s.current} aria-current={s.current ? 'step' : undefined}>
          <span className="field-objective-mark" aria-hidden="true">{s.done ? <Check size={13} /> : i + 1}</span>
          <span><strong>{s.label}</strong>{(s.current || (s.done && !complete)) && <small>{s.detail}</small>}</span>
          <span className="sr-only">{s.done ? '(done)' : s.current ? '(current step)' : '(to do)'}</span>
        </li>)}
      </ol>}
      {stage === 'find' && p.earthHidden && <p className="field-objective-blocked">Earth is behind the terrain. Turning toward it cannot complete this step now. Preview Earthrise in Time{p.onReturnToArrival ? ' or return to your arrival.' : '.'}</p>}
      {p.earthHidden && stage !== 'done' && p.onReturnToArrival && <button className="field-text-button" onClick={p.onReturnToArrival}>Return to mission arrival</button>}
      {complete && p.progress.summary && <div className="field-objective-summary" role="status">
        <strong>Recorded observation <span className="field-tag">Calculated</span></strong>
        {!p.narrow && recordedAt}
        {p.narrow ? <p>Earth {earthSkylineText(p.progress.summary.earthElDeg - p.progress.summary.skylineElDeg)}; pointing error {p.progress.summary.pointingErrorDeg.toFixed(1)}°.</p> : <p>Earth was {earthSkylineText(p.progress.summary.earthElDeg - p.progress.summary.skylineElDeg)}. Your antenna pointed {p.progress.summary.pointingErrorDeg.toFixed(1)}° from Earth’s centre.</p>}
        {p.narrow && primaryActions}
        {p.narrow && recordedAt}
        <p className="field-recorded-scope">Saved for this time. Conditions in the current view may differ.</p>
        <strong className="field-objective-why">What this means for the mission</strong>
        {consequence ? <div className="field-antenna-consequence">
          <small>{consequence.title} · arrival {glance.arrivalUTC}</small>
          <p>{consequence.earth}</p><p>{consequence.stations}</p><p>{consequence.next}</p><p>{consequence.consequence}</p>
        </div> : <p role="status">Loading mission consequences. Open Earth link to check the whole-mission prediction.</p>}
        <small>Pointing alone does not establish a radio link. These are hourly predictions at the landing point, not a booked or tested connection.</small>
        <details className="field-observation-context"><summary>Measurement details · 3 of 3 steps complete</summary><p>{objectiveSummaryText(p.progress.summary)}</p>
        <small>Measured at the landing point: JPL Horizons positions against the LOLA skyline, scene time {p.progress.summary.sceneUTC.slice(0, 16).replace('T', ' ')} UTC.</small>
        </details>
        {!p.narrow && primaryActions}
        <div className="field-journey-actions" aria-label="Continue your exploration">
          <button className="field-button" onClick={p.onOpenTime}>Explore a different time</button>
          <button className="field-button" onClick={p.onDecisionReview}>Review field assignment</button>
          <button className="field-button" onClick={p.onRecordObservation}>Save observation to journal</button>
        </div>
      </div>}
      <p className="field-objective-note">The antenna is illustrative example equipment.</p>
      {complete && p.next.length > 0 && <NextActivities ids={p.next} onActivity={p.onActivity} />}
      <div className="field-objective-foot">
        <button className="field-text-button" title="Hides this card. Bring it back from the field menu (Esc)." onClick={p.onFree}>{complete ? 'Continue exploring freely' : 'Free exploration'}</button>
        {complete && <button className="field-text-button" onClick={p.onRestart}><RotateCcw size={14} aria-hidden="true" />Start again</button>}
      </div>
    </div>}
  </section>
}
