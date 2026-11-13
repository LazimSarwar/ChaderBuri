import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Globe2, Map as MapIcon, MessageCircle, MessageSquareOff, MessageSquareText, RotateCcw, Square, Sun, Volume2, VolumeX, X } from 'lucide-react'
import { useBuriReactions } from '../BuriWhisper'
import type { ReactionScene } from '../lib/buriReactions'
import type { GuideAction } from '../lib/guideAction'
import { ambientHoldMs, dropGroup, emptyCaptions, expireAmbient, isRepeat, lineKind, receiveLine, resolvePinned, waitingCount, type CaptionKind, type CaptionState } from './fieldCaptions'

/**
 * kind: 'action' lines (anything with an offer, the welcome, objective prompts) stay until the visitor acts or
 * dismisses them; 'ambient' remarks fade. Lines of the same group replace each other (the next objective step).
 */
export type CompanionLine = { key: string; text: string; brief?: string; offer?: { label: string; run: () => void }; kind?: CaptionKind; group?: string; calculated?: boolean }
type Props = {
  /** Lines the field interface asks her to say, oldest first (deterministic; no AI). Each key is handled once. */
  lines: CompanionLine[]
  /** In free exploration, guidance waits behind a labelled Help control. */
  compact?: boolean
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  focused: boolean
  /** Retire every line of a group (n changes on each request). */
  retire: { group: string; n: number } | null
  captions: boolean
  readAloud: boolean
  reduced: boolean
  /** Hold her own remarks while the guided arrival tour is speaking or the menu is open. */
  quiet: boolean
  reactionScene: ReactionScene
  reactions: boolean
  walking: string | null
  onStopWalk: () => void
  onFaceEarth: () => void
  onFaceSun: () => void
  onOpenMap: () => void
  onAsk: () => void
  onGuideAction: (action: GuideAction) => string
  onCaptions: (on: boolean) => void
  onReadAloud: (on: boolean) => void
  /** Another surface covers the captions (a phone with a sheet open): keep lines, show a small waiting chip. */
  hidden: boolean
  onReveal: () => void
  /** Whether a caption is showing (or being read aloud): drives her figure's talking state. */
  onSpeaking: (speaking: boolean) => void
  onShowObjective?: () => void
  objectiveLabel?: string
  /** The "Ask about this" bubble, shown beside her captions. */
  children?: ReactNode
}
const portrait = '/chader-buri-guide.webp'

export function speechAvailable() { return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined' }

/** Chader Buri in the corner: a pinned line that waits for the visitor, a fading remark, a few direct offers, and Ask. */
export function FieldCompanion(p: Props) {
  const [state, setState] = useState<CaptionState<CompanionLine>>(emptyCaptions)
  const [menu, setMenu] = useState(false)
  const expanded = p.expanded, setExpanded = p.onExpandedChange
  const helpClose = useRef<HTMLButtonElement>(null), helpToggle = useRef<HTMLButtonElement>(null), wasFocused = useRef(false)
  useEffect(() => {
    const was = wasFocused.current; wasFocused.current = p.focused
    if (p.focused) helpClose.current?.focus({ preventScroll: true })
    else if (was && (!document.activeElement || document.activeElement === document.body || helpClose.current?.closest('.field-companion')?.contains(document.activeElement))) helpToggle.current?.focus({ preventScroll: true })
  }, [p.focused])
  useEffect(() => { setExpanded(false) }, [p.compact, p.hidden, p.quiet])
  const last = useRef<CompanionLine | null>(null)
  const { whisper, dismiss } = useBuriReactions(p.reactionScene, p.reactions && p.captions && !p.quiet)
  const [voice, setVoice] = useState(false)
  const speak = useCallback((text: string) => {
    if (!p.readAloud || !speechAvailable()) return
    try {
      window.speechSynthesis.cancel()
      const u = new SpeechSynthesisUtterance(text); u.lang = 'en'; u.rate = 0.95
      u.onstart = () => setVoice(true); u.onend = () => setVoice(false); u.onerror = () => setVoice(false)
      window.speechSynthesis.speak(u)
    } catch { /* speech is optional */ }
  }, [p.readAloud])
  const hush = () => { try { if (speechAvailable()) window.speechSynthesis.cancel() } catch { /* ignore */ } setVoice(false) }
  // The same words are not repeated within a short window (her own remarks and repeated prompts).
  const history = useRef(new Map<string, number>())
  const receive = useCallback((line: CompanionLine) => {
    if (!p.captions) return
    // While quiet, actionable lines wait; ambient remarks are simply skipped.
    if (p.quiet && lineKind(line) === 'ambient') return
    // Time navigation can revisit the same facts. Their fresh calculated context must replace old facts.
    if (isRepeat(history.current, line.text, Date.now()) && !line.calculated) return
    last.current = line
    setState(s => receiveLine(s, line))
  }, [p.captions, p.quiet])
  const seen = useRef(new Set<string>())
  useEffect(() => { for (const l of p.lines) if (!seen.current.has(l.key)) { seen.current.add(l.key); receive(l) } }, [p.lines])
  useEffect(() => { if (p.retire) setState(s => dropGroup(s, p.retire!.group)) }, [p.retire?.n])
  // Her own remarks (first jump, bootprints, earthrise, sunset…) come through the same caption.
  useEffect(() => {
    if (!whisper) return
    const offer = whisper.offer
    receive({ key: 'reaction:' + whisper.key, group: 'reaction', text: whisper.text, offer: offer ? { label: offer.label, run: () => { p.onGuideAction(offer.action) } } : undefined })
    dismiss()
  }, [whisper?.key])
  // Only ambient remarks time out.
  const ambient = state.ambient, pinned = state.pinned
  useEffect(() => {
    if (!ambient) return
    const timer = setTimeout(() => setState(s => expireAmbient(s, ambient.key)), ambientHoldMs(ambient.text))
    return () => clearTimeout(timer)
  }, [ambient?.key])
  const spoken = useRef('')
  useEffect(() => {
    const next = !p.quiet && !p.hidden && (!p.compact || expanded) ? (ambient ?? pinned) : null
    if (next && spoken.current !== next.key) { spoken.current = next.key; speak(next.text) }
  }, [ambient?.key, pinned?.key, p.quiet, p.hidden, p.compact, expanded])
  useEffect(() => { if (!p.captions) { setState(emptyCaptions()); hush() } }, [p.captions])
  useEffect(() => () => hush(), [])
  useEffect(() => { if (!p.readAloud) hush() }, [p.readAloud])
  useEffect(() => {
    if (!p.quiet && !p.hidden) return
    hush()
    // A passing remark is obsolete after an interruption; the current action can wait.
    setState(s => s.ambient ? { ...s, ambient: null } : s)
  }, [p.quiet, p.hidden])
  useEffect(() => { if (p.compact && !expanded) hush() }, [p.compact, expanded])
  const donePinned = () => { setState(resolvePinned); if (p.compact) setExpanded(false); hush() }
  const doneAmbient = () => { if (ambient) setState(s => expireAmbient(s, ambient.key)); if (p.compact) setExpanded(false); hush() }
  const replay = () => { if (p.compact) setExpanded(true); if (last.current) { const l = last.current; setState(s => receiveLine(expireAmbient(s, l.key), { ...l })); spoken.current = ''; speak(l.text) } }
  const offers: { label: string; icon: typeof Sun; run: () => void }[] = [
    { label: 'Show me Earth', icon: Globe2, run: p.onFaceEarth },
    { label: 'Find the Sun', icon: Sun, run: p.onFaceSun },
    { label: 'Open the terrain map', icon: MapIcon, run: p.onOpenMap },
  ]
  const compact = p.compact && !expanded
  const show = !p.quiet && !p.hidden && !compact
  const waiting = waitingCount(state)
  const speaking = (show && !!(ambient || pinned)) || voice
  const speakingRef = useRef(p.onSpeaking); speakingRef.current = p.onSpeaking
  useEffect(() => { speakingRef.current(speaking) }, [speaking])
  useEffect(() => () => speakingRef.current(false), [])
  // Replay, stop speech, mute and dismiss sit on every caption.
  const controls = (dismissLine: () => void, label: string) => <>
    <button className="field-icon-button is-small" aria-label="Replay this line" title="Replay" onClick={replay}><RotateCcw size={14} /></button>
    {voice && <button className="field-icon-button is-small" aria-label="Stop reading aloud" title="Stop speech" onClick={hush}><Square size={13} /></button>}
    <button className="field-icon-button is-small" aria-label="Mute Chader Buri’s captions" title="Mute captions" onClick={() => { hush(); p.onCaptions(false) }}><MessageSquareOff size={14} /></button>
    <button className="field-icon-button is-small" aria-label={label} title="Dismiss" onClick={dismissLine}><X size={15} /></button>
  </>
  const tag = (l: CompanionLine) => l.calculated ? <span className="field-tag">Calculated</span> : null
  return <aside className="field-companion pointer-events-auto" aria-label="Chader Buri" data-reduced={p.reduced} data-compact={compact || undefined} data-help-open={p.focused || undefined} data-hidden={p.hidden || undefined}>
    <button className="field-companion-portrait" aria-expanded={menu} aria-controls="field-companion-menu" aria-label="Chader Buri: guidance and options" data-speaking={speaking || undefined} onClick={() => setMenu(m => !m)}><img src={portrait} alt="" />{!p.captions && <span className="field-portrait-badge" aria-hidden="true"><MessageSquareOff size={11} /></span>}</button>
    <div className="field-help-header" hidden={!p.focused}><strong>Chader Buri · Help</strong><button ref={helpClose} className="field-icon-button" aria-label="Close Chader Buri Help" onClick={() => { setExpanded(false); hush() }}><X size={18} aria-hidden="true" /></button></div>
    <div className="field-companion-body">
      {p.children}
      {compact && !p.hidden && !p.quiet && <button ref={helpToggle} className="field-guide-help" aria-label="Chader Buri Help" aria-expanded={false} onClick={() => { if (waiting > 0 || ambient) { p.onReveal(); setExpanded(true) } else p.onAsk() }}><MessageCircle size={15} aria-hidden="true" />Chader Buri · Help{waiting > 0 && <small>Guidance available</small>}</button>}
      {p.hidden && !p.quiet && waiting > 0 && <button className="field-waiting" onClick={p.onReveal}><MessageSquareText size={14} aria-hidden="true" />Chader Buri · {waiting} waiting</button>}
      {show && ambient && <div className="field-caption is-ambient" role="status" aria-live="polite" key={ambient.key} data-pinned={!!pinned}>
        <span className="field-caption-name">Chader Buri{tag(ambient)}{pinned && <small> · then back to your current step</small>}</span>
        <p>{ambient.text}</p>
        <div className="field-caption-actions">
          {p.walking && <button className="field-chip" onClick={() => { p.onStopWalk(); doneAmbient() }}><Square size={12} aria-hidden="true" />Stop walking</button>}
          {controls(doneAmbient, 'Dismiss this remark')}
        </div>
      </div>}
      {/* One caption at a time (field.css): on wide screens a passing remark briefly covers the pinned step; phones keep the step. */}
      {show && pinned && <div className="field-caption is-pinned" role="status" aria-live="polite" key={pinned.key} data-group={pinned.group}>
        <span className="field-caption-name">Chader Buri{tag(pinned)}{p.onShowObjective && <button className="field-caption-steps" onClick={p.onShowObjective}>{p.objectiveLabel ?? 'Show steps'}</button>}</span>
        <p>{pinned.brief ?? pinned.text}</p>
        {pinned.brief && pinned.brief !== pinned.text && <details className="field-caption-detail"><summary>Numbers and context</summary><p>{pinned.text}</p></details>}
        <div className="field-caption-actions">
          {pinned.offer && <button className="field-chip is-offer" onClick={() => { pinned.offer!.run(); donePinned() }}>{pinned.offer.label}</button>}
          {p.walking && <button className="field-chip" onClick={() => { p.onStopWalk(); donePinned() }}><Square size={12} aria-hidden="true" />Stop walking</button>}
          <span className="field-caption-controls">{controls(donePinned, 'Dismiss this line')}</span>
        </div>
      </div>}
      {menu && <div className="field-companion-menu" id="field-companion-menu">
        <div className="field-companion-offers">{offers.map(o => <button key={o.label} className="field-chip" onClick={() => { o.run(); setMenu(false) }}><o.icon size={13} aria-hidden="true" />{o.label}</button>)}</div>
        <div className="field-companion-tools">
          <button className="field-chip" onClick={() => { setMenu(false); p.onAsk() }}><MessageCircle size={13} aria-hidden="true" />Ask Chader Buri</button>
          <button className="field-chip" disabled={!last.current} onClick={replay}><RotateCcw size={13} aria-hidden="true" />Replay last line</button>
          <button className="field-chip" aria-pressed={!p.captions} onClick={() => { hush(); p.onCaptions(!p.captions) }}>{p.captions ? <MessageSquareOff size={13} aria-hidden="true" /> : <MessageSquareText size={13} aria-hidden="true" />}{p.captions ? 'Mute captions' : 'Show captions'}</button>
          {speechAvailable() && <button className="field-chip" aria-pressed={p.readAloud} onClick={() => { if (p.readAloud) hush(); p.onReadAloud(!p.readAloud) }}>{p.readAloud ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}{p.readAloud ? 'Stop reading aloud' : 'Read captions aloud'}</button>}
          <button className="field-chip" disabled={!pinned && !ambient && !p.walking && !voice} onClick={() => { if (p.walking) p.onStopWalk(); setState(emptyCaptions()); hush() }}><Square size={12} aria-hidden="true" />Stop</button>
        </div>
      </div>}
    </div>
  </aside>
}
