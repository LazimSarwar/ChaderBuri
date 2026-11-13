import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, Send, Square, X } from 'lucide-react'
import { actionLabel, type GuideAction } from '../lib/guideAction'
import { contextKey, type CompanionContext } from '../lib/lunarCompanion'
import { suggestionKey, type ScreenDigest } from '../lib/contracts'
import type { LunarCompanionSession } from '../useLunarCompanion'
import type { AskSubject, AskSuggestion } from './fieldAsk'
import '../companion-chat.css'

type Props = {
  subject: AskSubject
  suggestions: AskSuggestion[]
  /** Chader Buri's AI conversation (shared with the full chat panel). Absent: deterministic answers only. */
  session?: LunarCompanionSession
  context?: CompanionContext
  /** Exact local scene identity; the AI context itself is sampled hourly. */
  sceneKey: string
  /** Hold the exact scene being explained when the visitor deliberately sends a question. */
  onFreezeScene: () => void
  readScreen: () => ScreenDigest | null
  onGuideAction: (action: GuideAction) => string
  onFocus: (focus: 'sun' | 'earth') => void
  onOpenChat: () => void
  onClose: () => void
}

/** "Ask about this": a compact bubble beside her caption, about the object or activity in front of the visitor. */
export function AskBubble(p: Props) {
  const s = p.session
  const [picked, setPicked] = useState<string | null>(null)
  const [questionsOpen, setQuestionsOpen] = useState(() => !s?.history.length)
  const [input, setInput] = useState('')
  type RequestStamp = { key: string; generation: number; id: number }
  const [asked, setAsked] = useState<(RequestStamp & { question: string; message: string; note: string; suggestion: { action: GuideAction; reason: string } | null; focus: string; more: boolean }) | null>(null)
  const [handled, setHandled] = useState(false)
  const [requestStamp, setRequestStamp] = useState<RequestStamp | null>(null)
  const [notice, setNotice] = useState<'changed' | 'stopped' | null>(null)
  const first = useRef<HTMLButtonElement>(null), inputRef = useRef<HTMLInputElement>(null), threadEnd = useRef<HTMLDivElement>(null)
  const key = JSON.stringify([p.context ? contextKey(p.context) : '', p.sceneKey, p.subject.kind, p.subject.title])
  const current = useRef({ key, generation: 0 }), serial = useRef(0), pending = useRef<RequestStamp | null>(null), mounted = useRef(true)
  // The generation retires A's request even if the visitor goes A → B → A before it returns.
  // A layout effect also prevents a resolved promise from winning a context-change commit.
  useLayoutEffect(() => {
    if (current.current.key === key) return
    current.current = { key, generation: current.current.generation + 1 }
    serial.current++
    if (pending.current || asked) setNotice('changed')
    pending.current = null
    setRequestStamp(null); setAsked(null); setHandled(false)
  }, [key])
  useLayoutEffect(() => { mounted.current = true; return () => { mounted.current = false; serial.current++; pending.current = null } }, [])
  const isCurrent = (stamp: RequestStamp | null) => !!stamp && mounted.current && stamp.key === key && stamp.key === current.current.key && stamp.generation === current.current.generation && stamp.id === serial.current
  // Hide the old answer in the context-changing render, before the effect clears its state.
  const visibleAsked = asked && isCurrent(asked) ? asked : null
  const currentRequest = isCurrent(requestStamp)
  useEffect(()=>{threadEnd.current?.scrollIntoView({block:'nearest'})},[s?.history.length,visibleAsked?.message,s?.busy,notice])
  useEffect(()=>{const body=threadEnd.current?.closest('.field-ask-body');if(!body||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>threadEnd.current?.scrollIntoView({block:'nearest'}));observer.observe(body);return()=>observer.disconnect()},[])
  useEffect(() => { first.current?.focus({ preventScroll: true }) }, [p.subject.kind])
  useEffect(() => { setPicked(null) }, [p.subject.kind])
  useEffect(() => { if (s && s.configured === null) void s.status() }, [])
  const answer = p.suggestions.find(q => q.id === picked) ?? null
  const ready = !!s && !!p.context && s.configured === true
  const send = async () => {
    const text = input.trim()
    if (!text || !s || !p.context || s.busy || pending.current || !ready) return
    p.onFreezeScene()
    const stamp = { ...current.current, id: ++serial.current }
    pending.current = stamp
    setRequestStamp(stamp); setNotice(null)
    setInput(''); setAsked(null); setHandled(false); setPicked(null)
    try {
      const reply = await s.send(text, p.context, p.readScreen())
      if (!reply || !isCurrent(stamp)) return
      // Existing action policy still applies; an obsolete reply cannot run an action or display an offer.
      const note = reply.action ? p.onGuideAction(reply.action) : ''
      if (isCurrent(stamp)) setAsked({ ...stamp, question: text, message: reply.message, note, suggestion: reply.suggestion ?? null, focus: reply.focus, more: !!reply.visitSlug || !!reply.proposedMission })
    } finally { if (pending.current?.id === stamp.id) pending.current = null }
  }
  const stop = () => { serial.current++; pending.current = null; setRequestStamp(null); setNotice('stopped'); s?.cancel(); inputRef.current?.focus({ preventScroll: true }) }
  const offerShown = visibleAsked?.suggestion && !handled && !s?.dismissed.includes(suggestionKey(visibleAsked.suggestion.action))
  const recent = s?.history.slice(-4).filter(entry => !(visibleAsked && entry.source === 'ai' && entry.question === visibleAsked.question && entry.answer === visibleAsked.message)) ?? []
  const pick = (q: AskSuggestion) => {
    serial.current++; pending.current = null; setRequestStamp(null); setPicked(q.id); setAsked(null); setNotice(null)
    setQuestionsOpen(false)
    if (s?.busy) s.cancel()
    p.onFreezeScene()
    if (s && p.context) {
      const digest = p.readScreen(), time = digest?.items.find(item => item.id === 'field-time')?.value
      s.remember(q.question, `${time ? `Scene: ${time}.\n` : ''}${q.answer}`, p.context, { source: 'calculated', siteName: digest?.items.find(item => item.id === 'field-site')?.value ?? p.subject.title })
    }
  }
  return <section className="field-ask field-ask-clear" aria-label={`Ask Chader Buri about: ${p.subject.title}`}>
    <header>
      <span><small>Ask about this</small><strong>{p.subject.title}</strong></span>
      <button className="field-icon-button" aria-label="Close Ask about this (Esc)" onClick={p.onClose}><X size={15} /></button>
    </header>
    <details className="field-ask-suggested" open={questionsOpen} onToggle={event=>{const bank=event.currentTarget;bank.scrollTop=0;if(bank.open){const questions=bank.querySelector<HTMLElement>('.field-ask-questions');if(questions)questions.scrollTop=0}setQuestionsOpen(bank.open)}}><summary>Suggested questions</summary><div className="field-ask-questions" role="group" aria-label="Suggested questions">
      {p.suggestions.slice(0, 3).map((q, i) => <button key={q.id} ref={i === 0 ? first : undefined} className="field-chip" aria-pressed={picked === q.id} onClick={() => pick(q)}>{q.question}</button>)}
    </div></details>
    <div className="field-ask-body">
    <div className="field-ask-thread" role="log" aria-label="Recent conversation with Chader Buri" aria-live="polite" aria-relevant="additions text">
    {recent.map(entry => <div className="field-ask-saved" key={entry.id}>
      <p className="field-ask-q"><small>You</small>{entry.question}</p>
      <p><small>Chader Buri{entry.source === 'calculated' ? ' · calculated answer' : ''}</small>{entry.answer}</p>
      <small className="field-ask-history-scope">Saved answer · {entry.siteName}{entry.sceneUTC ? ` · ${entry.sceneUTC.slice(0, 16).replace('T', ' ')} UTC` : ''}. Ask again for current conditions.</small>
    </div>)}
    {answer && (!s || !p.context) && <div className="field-ask-answer" role="status" aria-live="polite">
      <span className="field-caption-name">Chader Buri · from the values on screen</span>
      <p>{answer.answer}</p>
    </div>}
    {s?.busy && currentRequest && <p className="field-ask-status" role="status">Chader Buri is thinking about “{s.question}”…</p>}
    {s?.error && !s.busy && currentRequest && <p className="field-ask-error" role="alert">{s.error}</p>}
    {visibleAsked && !s?.busy && <div className="field-ask-answer is-ai" role="status" aria-live="polite">
      <span className="field-caption-name">Chader Buri · AI reply</span>
      <p className="field-ask-q">You: {visibleAsked.question}</p>
      <p>{visibleAsked.message}</p>
      {visibleAsked.note && <p className="field-ask-note">{visibleAsked.note}</p>}
      <div className="field-caption-actions">
        {(visibleAsked.focus === 'earth' || visibleAsked.focus === 'sun') && <button className="field-chip" onClick={() => { if (isCurrent(visibleAsked)) p.onFocus(visibleAsked.focus as 'sun' | 'earth') }}>Show me {visibleAsked.focus === 'earth' ? 'Earth' : 'the Sun'}</button>}
        {offerShown && <>
          <button className="field-chip is-offer" title={visibleAsked.suggestion!.reason} onClick={() => { if (!isCurrent(visibleAsked)) return; setHandled(true); p.onGuideAction(visibleAsked.suggestion!.action) }}>{actionLabel(visibleAsked.suggestion!.action, slug => slug)}</button>
          <button className="field-chip" onClick={() => { if (!isCurrent(visibleAsked)) return; setHandled(true); s?.dismiss(suggestionKey(visibleAsked.suggestion!.action)) }}>Not now</button>
        </>}
      </div>
      {visibleAsked.more && <small>She has a suggestion waiting in the full conversation.</small>}
    </div>}
    <div ref={threadEnd}/>
    </div>
    <div className="field-ask-links"><button className="field-text-button field-ask-full" onClick={p.onOpenChat}>Full conversation<ArrowRight size={14} aria-hidden="true" /></button>{!!s?.history.length&&<button className="field-text-button" onClick={()=>{serial.current++;pending.current=null;setRequestStamp(null);s.clear();setPicked(null);setAsked(null);setNotice(null);setQuestionsOpen(true)}}>Clear chat</button>}</div>
    <details className="field-ask-privacy"><summary>{s?.storageAvailable === false ? 'Browser saving unavailable' : 'Saved in this browser'}</summary><p>Questions and recent messages go to Google Gemini when you send. Answers may be mistaken. Clear chat removes this device’s saved conversation.</p></details>
    </div>
    <form className="field-ask-form" onSubmit={e => { e.preventDefault(); void send() }}>
      {notice && <div className="field-ask-notice" role="status">{notice === 'changed' && s?.busy
        ? <button type="button" className="field-button" onClick={stop}><Square size={15} aria-hidden="true" />Stop previous question</button>
        : <p className="field-ask-status">{notice === 'changed' ? 'Scene changed. Ask again for current conditions.' : 'Request stopped.'}</p>}</div>}
      <label htmlFor="field-ask-input">Your question</label>
      <div className="field-ask-compose">
        <input ref={inputRef} id="field-ask-input" type="text" maxLength={1000} value={input} placeholder={ready ? 'Your question, in any language' : 'Needs the AI connection'} disabled={!ready} onChange={e => setInput(e.target.value)} />
        {s?.busy ? <button type="button" className="field-icon-button is-framed" aria-label="Stop Chader Buri’s request" onClick={stop}><Square size={15} /></button>
          : <button type="submit" className="field-icon-button is-framed" aria-label="Send question to Chader Buri" disabled={!input.trim() || !ready}><Send size={16} /></button>}
      </div>
      {s?.configured === false && <small>Chat is unavailable. The suggested questions still work.</small>}
      {s?.configured === null && <small>Checking Chader Buri’s connection…</small>}
    </form>
  </section>
}
