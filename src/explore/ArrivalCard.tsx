import { ArrowRight, X } from 'lucide-react'
import type { ArrivalFacts } from './fieldJourney'

type Props = {
  facts: ArrivalFacts
  objective: string | null
  onBegin: (() => void) | null
  beginLabel?: string
  condition?: string | null
  lighting?: string
  compact?: boolean
  onDismiss: () => void
}
/**
 * A short, non-blocking arrival moment: where you are, how far from the pole, the lander, the time, the first job.
 * It carries an action (Begin), so it never closes on a timer: Begin, ✕, Esc or walking a few metres closes it.
 */
export function ArrivalCard(p: Props) {
  return <section className="field-arrival pointer-events-auto" aria-labelledby="field-arrival-title" role="status">
    <div className="field-arrival-content">
    <p className="field-kicker">You are standing at</p>
    <h2 id="field-arrival-title">{p.facts.site}</h2>
    {p.condition && <p className="field-arrival-condition">{p.condition}</p>}
    <p className="field-arrival-range">{p.facts.scale}</p>
    <details className="field-arrival-details" open={!p.compact}><summary>Landing details and lighting</summary>
    <dl className="field-arrival-facts">
      <div><dt>Lander</dt><dd>{p.facts.lander}</dd></div>
      <div><dt>Time</dt><dd>{p.facts.time} · simulation</dd></div>
      {p.lighting && <div className="field-view-light"><dt>View lighting</dt><dd>{p.lighting}</dd></div>}
    </dl>
    <details className="field-arrival-orientation"><summary>Orientation details</summary><p>{p.facts.pole}.</p></details>
    </details>
    {p.objective && <p className="field-arrival-goal"><span className="field-kicker">First objective</span>{p.objective}</p>}
    </div>
    <div className="field-arrival-actions">
      {p.onBegin && <button className="field-button is-primary" onClick={() => { p.onBegin!(); p.onDismiss() }}>{p.beginLabel ?? 'Begin'}<ArrowRight size={15} aria-hidden="true" /></button>}
      <button className="field-icon-button" aria-label="Close the arrival card" onClick={p.onDismiss}><X size={16} /></button>
      {p.condition && <button className="field-text-button field-arrival-stay" onClick={p.onDismiss}>Explore at current time</button>}
    </div>
  </section>
}
