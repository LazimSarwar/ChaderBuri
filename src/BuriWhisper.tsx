import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { detectReaction, REACTION_LINES, type Reaction, type ReactionScene } from './lib/buriReactions'
import type { GuideAction } from './lib/guideAction'

const COOLDOWN_MS = 20000
const IDLE_MS = 70000
const HOLD_MS = 45000
const BEAT_MS = 650
const READING = '.visit-field-card,.visit-tool-card'

/** Watches the visit and returns one short remark at a time, never more often than every 20 s. */
export function useBuriReactions(scene: ReactionScene, listening: boolean) {
  const [whisper, setWhisper] = useState<Reaction | null>(null)
  const prev = useRef<ReactionScene | null>(null), said = useRef(new Set<string>()), lastAt = useRef(0), firstSite = useRef<string | null>(null)
  const held = useRef<{ reaction: Reaction; at: number } | null>(null)
  // She reacts after a short beat, which also lets a card opened by the same action appear first.
  const say = (r: Reaction) => {
    if (Date.now() - lastAt.current < COOLDOWN_MS) return
    if (!held.current || r.priority >= held.current.reaction.priority) held.current = { reaction: r, at: Date.now() }
  }
  useEffect(() => {
    if (!listening) { held.current = null; return }
    const timer = window.setInterval(() => {
      const pending = held.current, now = Date.now()
      if (!pending || now - pending.at < BEAT_MS) return
      if (now - pending.at > HOLD_MS || said.current.has(pending.reaction.key) || now - lastAt.current < COOLDOWN_MS) { held.current = null; return }
      // Don't talk over an open field card; wait until the visitor closes it.
      if (document.querySelector(READING)) return
      held.current = null; said.current.add(pending.reaction.key); lastAt.current = now; setWhisper(pending.reaction)
    }, 250)
    return () => clearInterval(timer)
  }, [listening])
  useEffect(() => {
    if (scene.landed && firstSite.current === null) firstSite.current = scene.siteSlug
    const reaction = detectReaction(prev.current, scene, said.current, firstSite.current)
    prev.current = scene
    if (reaction && listening) say(reaction)
  })
  // One gentle offer of help if the visitor stands still for a while after landing.
  const activity = `${scene.landed}|${scene.siteSlug}|${Math.round(scene.trailDistanceM)}|${scene.photos}|${scene.airborne}`
  useEffect(() => {
    if (!scene.landed || !listening || said.current.has('idle')) return
    const timer = window.setTimeout(() => say({ key: 'idle', text: REACTION_LINES.idle, priority: 0 }), IDLE_MS)
    return () => clearTimeout(timer)
  }, [activity, listening])
  useEffect(() => { if (!listening) setWhisper(null) }, [listening])
  return { whisper, dismiss: () => setWhisper(null) }
}

export function BuriWhisper({ whisper, onDismiss, onReply, onOffer }: { whisper: Reaction; onDismiss: () => void; onReply: () => void; onOffer?: (action: GuideAction) => void }) {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (held) return
    const timer = window.setTimeout(onDismiss, 6000 + whisper.text.length * 45)
    return () => clearTimeout(timer)
  }, [whisper.key, held])
  return <div className="buri-whisper" role="status" aria-live="polite" key={whisper.key}
    onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)} onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
    <span className="buri-whisper-name">Chader Buri</span>
    <p>{whisper.text}</p>
    <div className="buri-whisper-actions">{whisper.offer && onOffer ? <button className="buri-whisper-offer" onClick={() => { onOffer(whisper.offer!.action); onDismiss() }}>{whisper.offer.label}</button> : <button onClick={onReply}>Reply</button>}<button aria-label="Dismiss Chader Buri’s comment" onClick={onDismiss}><X size={13} /></button></div>
  </div>
}
