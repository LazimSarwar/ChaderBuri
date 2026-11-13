import { useEffect, useRef, useState } from 'react'
import { ArrowUp } from 'lucide-react'

const RADIUS = 46, DEAD = 0.18, RESEND = 0.12

/** Left-thumb walking pad: drag from the centre to walk continuously; release to stop. */
export function TouchJoystick({ onWalk, disabled }: { onWalk: (forward: number, right: number) => void; disabled: boolean }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 })
  const active = useRef<number | null>(null), centre = useRef({ x: 0, y: 0 }), sent = useRef({ f: 0, r: 0 }), walk = useRef(onWalk)
  walk.current = onWalk
  const send = (f: number, r: number) => {
    if (Math.abs(f - sent.current.f) < RESEND && Math.abs(r - sent.current.r) < RESEND && !(f === 0 && r === 0 && (sent.current.f || sent.current.r))) return
    sent.current = { f, r }; walk.current(f, r)
  }
  const stop = () => { active.current = null; setKnob({ x: 0, y: 0 }); if (sent.current.f || sent.current.r) { sent.current = { f: 0, r: 0 }; walk.current(0, 0) } }
  useEffect(() => {
    const hidden = () => { if (document.hidden) stop() }
    window.addEventListener('blur', stop); document.addEventListener('visibilitychange', hidden)
    return () => { window.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', hidden); stop() }
  }, [])
  useEffect(() => { if (disabled) stop() }, [disabled])
  const move = (x: number, y: number) => {
    let dx = x - centre.current.x, dy = y - centre.current.y
    const d = Math.hypot(dx, dy)
    if (d > RADIUS) { dx *= RADIUS / d; dy *= RADIUS / d }
    setKnob({ x: dx, y: dy })
    const f = -dy / RADIUS, r = dx / RADIUS, m = Math.hypot(f, r)
    if (m < DEAD) send(0, 0); else send(Math.round(f * 10) / 10, Math.round(r * 10) / 10)
  }
  return <div className="field-joystick" aria-hidden="true" data-active={active.current !== null}
    onPointerDown={e => {
      if (disabled) return
      const rect = e.currentTarget.getBoundingClientRect()
      centre.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      active.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX, e.clientY)
    }}
    onPointerMove={e => { if (active.current === e.pointerId) move(e.clientX, e.clientY) }}
    onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
    <span className="field-joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
  </div>
}

export function JumpButton({ onJump, disabled, airborne }: { onJump: () => void; disabled: boolean; airborne: boolean }) {
  return <button className="field-jump" aria-label="Jump in lunar gravity" disabled={disabled || airborne} onClick={onJump}><ArrowUp size={20} aria-hidden="true" /><span>{airborne ? 'In flight' : 'Jump'}</span></button>
}
