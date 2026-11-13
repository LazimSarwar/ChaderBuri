import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, ChevronDown, ChevronUp } from 'lucide-react'
import { ACTIVITIES, type ActivityId } from './fieldJourney'

export type ActivityStep = { id: string; label: string; done: boolean; current: boolean; detail?: string }
export type ActivityAction = { label: string; icon?: typeof Check; run: () => void; disabled?: boolean }
type Props = {
  title: string
  steps: ActivityStep[]
  action: ActivityAction | null
  /** The finding, written from calculated values, with where those values come from. */
  conclusion: { text: ReactNode; source: string } | null
  /** Extra content for the current step (an event list, a note field). */
  children?: ReactNode
  more?: ActivityAction[]
  next: ActivityId[]
  narrow: boolean
  compact: boolean
  onReadingChange?: (reading: boolean) => void
  onActivity: (id: ActivityId) => void
  onFree: () => void
}

/** One field activity in the objective slot: numbered steps, one next action, a grounded conclusion, then what to do next. */
export function ActivityCard(p: Props) {
  const id = useId(), done = p.steps.filter(s => s.done).length, total = p.steps.length, complete = done === total
  const [phoneOpen, setPhoneOpen] = useState(true), [deskOpen, setDeskOpen] = useState(true)
  const wasComplete = useRef(complete)
  useEffect(() => { if (complete && !wasComplete.current) { setPhoneOpen(true); setDeskOpen(true) } wasComplete.current = complete }, [complete])
  const open = !p.compact && (p.narrow ? phoneOpen : deskOpen)
  useEffect(()=>{p.onReadingChange?.(p.narrow && open)},[p.narrow,open,p.onReadingChange])
  useEffect(()=>()=>p.onReadingChange?.(false),[p.onReadingChange])
  const current = p.steps.find(s => s.current)
  return <section className="field-objective field-activity pointer-events-auto" aria-labelledby={id + 'title'} data-open={open} data-complete={complete}>
    <button className="field-objective-head" aria-expanded={open} aria-controls={id + 'body'} onClick={() => p.narrow ? setPhoneOpen(o => !o) : setDeskOpen(o => !o)}>
      <span className="field-objective-kicker">{complete ? 'Activity complete' : `Activity · ${done} of ${total}`}</span>
      <strong id={id + 'title'}>{p.title}</strong>
      {!open && current && <span className="field-objective-now">Now: {current.label}</span>}
      {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      <span className="sr-only">{open ? 'Collapse activity' : 'Expand activity'}</span>
    </button>
    <div className="field-objective-meter" role="progressbar" aria-label="Activity progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-valuetext={`${done} of ${total} steps`}><i style={{ width: `${done / total * 100}%` }} /></div>
    {open && <div className="field-objective-body" id={id + 'body'}>
      {p.action && <button className="field-button is-primary field-objective-action" disabled={p.action.disabled} onClick={p.action.run}>{p.action.icon && <p.action.icon size={16} aria-hidden="true" />}{p.action.label}</button>}
      <ol className="field-objective-steps">
        {p.steps.map((s, i) => <li key={s.id} data-done={s.done} data-current={s.current} aria-current={s.current ? 'step' : undefined}>
          <span className="field-objective-mark" aria-hidden="true">{s.done ? <Check size={13} /> : i + 1}</span>
          <span><strong>{s.label}</strong>{s.detail && (s.current || s.done) && <small>{s.detail}</small>}</span>
          <span className="sr-only">{s.done ? '(done)' : s.current ? '(current step)' : '(to do)'}</span>
        </li>)}
      </ol>
      {p.children}
      {p.conclusion && <div className="field-objective-summary" role="status">
        <strong>What you found <span className="field-tag">Calculated</span></strong>
        <p>{p.conclusion.text}</p>
        <small>{p.conclusion.source}</small>
      </div>}
      {p.more && p.more.length > 0 && <div className="field-row">{p.more.map(m => <button key={m.label} className="field-button" disabled={m.disabled} onClick={m.run}>{m.icon && <m.icon size={14} aria-hidden="true" />}{m.label}</button>)}</div>}
      {complete && p.next.length > 0 && <NextActivities ids={p.next} onActivity={p.onActivity} />}
      <div className="field-objective-foot"><button className="field-text-button" onClick={p.onFree}>{complete ? 'Continue exploring freely' : 'Free exploration'}</button></div>
    </div>}
  </section>
}

/** "What next": the remaining activities as plain choices. */
export function NextActivities({ ids, onActivity }: { ids: ActivityId[]; onActivity: (id: ActivityId) => void }) {
  return <div className="field-next">
    <p className="field-kicker">Next</p>
    <ul>{ACTIVITIES.filter(a => ids.includes(a.id)).map(a => <li key={a.id}><button className="field-next-item" onClick={() => onActivity(a.id)}><strong>{a.title}</strong><small>{a.question}</small></button></li>)}</ul>
  </div>
}
