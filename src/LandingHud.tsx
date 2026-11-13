import { useEffect, useRef } from 'react'
import { FastForward } from 'lucide-react'
import '@fontsource-variable/jetbrains-mono'
import './mission-visor.css'
import { landingStore, requestLandingSkip } from './lib/landingStore'
import { PHASES, PHASE_LABEL } from './lib/landingProfile'
const phaseLabel = (phase: keyof typeof PHASE_LABEL) => phase === 'hazard-scan' ? 'Illustrative hover' : phase === 'landed' ? 'Touchdown complete' : PHASE_LABEL[phase]

/**
 * Live telemetry for the time-compressed landing simulation. Reads the shared store in its
 * own animation frame and writes text directly, so the 3D scene never waits on React.
 */
export function LandingHud({ siteName }: { siteName: string }) {
  const root = useRef<HTMLDivElement>(null)
  const field = (name: string) => root.current?.querySelector<HTMLElement>(`[data-field="${name}"]`)
  useEffect(() => {
    let frame = 0, lastPhase = ''
    const tick = () => {
      const t = landingStore.telemetry, node = root.current
      if (t && node) {
        const set = (name: string, text: string) => { const el = field(name); if (el && el.textContent !== text) el.textContent = text }
        set('alt', t.altM.toFixed(t.altM < 10 ? 1 : 0)); set('vs', t.vVertMps.toFixed(1)); set('hs', t.vHorizMps.toFixed(1)); set('range', t.rangeM.toFixed(0))
        set('prop', t.propellantPct.toFixed(1)); set('thr', t.throttlePct.toFixed(0)); set('pitch', t.pitchDeg.toFixed(1))
        set('distance', `${t.distanceM.toFixed(0)} m`)
        field('prop-bar')?.style.setProperty('width', `${Math.max(0, Math.min(100, t.propellantPct * 2))}%`)
        field('thr-bar')?.style.setProperty('width', `${Math.max(0, Math.min(100, t.throttlePct))}%`)
        const bracket = field('bracket')
        if (bracket) {
          bracket.style.display = t.screen ? 'block' : 'none'
          if (t.screen) { const size = Math.max(46, Math.min(150, 4200 / Math.max(1, t.distanceM))); bracket.style.left = `${t.screen.x * 100}%`; bracket.style.top = `${t.screen.y * 100}%`; bracket.style.width = bracket.style.height = `${size}px` }
        }
        if (t.phase !== lastPhase) {
          lastPhase = t.phase; node.dataset.phase = t.phase
          set('phase', phaseLabel(t.phase))
          node.querySelectorAll<HTMLElement>('[data-step]').forEach(step => { const i = PHASES.indexOf(step.dataset.step as never), now = PHASES.indexOf(t.phase); step.dataset.state = i < now ? 'done' : i === now ? 'now' : 'next' })
        }
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); requestLandingSkip() } }
    window.addEventListener('keydown', key)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', key) }
  }, [])

  return <div ref={root} className="landing-hud" aria-label="Landing simulation telemetry">
    <div className="visor-frame" aria-hidden="true"><i /><i /><i /><i /></div>
    <header className="landing-title">
      <span>Time-compressed landing simulation · {siteName}</span>
      <strong data-field="phase" aria-live="polite">Braking &amp; approach</strong>
      <ol aria-label="Landing phases">{PHASES.map(p => <li key={p} data-step={p} data-state="next">{phaseLabel(p)}</li>)}</ol>
    </header>
    <div className="landing-bracket" data-field="bracket" aria-hidden="true"><i /><i /><i /><i /><span>Lander · <b data-field="distance">—</b></span></div>
    <section className="landing-column" aria-label="Descent">
      <div><span>Altitude</span><strong><b data-field="alt">160</b><small>m</small></strong></div>
      <div><span>Vertical speed</span><strong><b data-field="vs">0</b><small>m/s</small></strong></div>
      <div><span>Ground speed</span><strong><b data-field="hs">0</b><small>m/s</small></strong></div>
      <div><span>Range to pad</span><strong><b data-field="range">220</b><small>m</small></strong></div>
    </section>
    <section className="landing-column" data-side="right" aria-label="Vehicle">
      <div><span>Propellant</span><strong><b data-field="prop">46</b><small>%</small></strong><i className="landing-bar"><i data-field="prop-bar" /></i></div>
      <div><span>Throttle</span><strong><b data-field="thr">88</b><small>%</small></strong><i className="landing-bar"><i data-field="thr-bar" /></i></div>
      <div><span>Pitch</span><strong><b data-field="pitch">38</b><small>°</small></strong></div>
    </section>
    <p className="landing-callout" aria-hidden="true"><span data-for="contact">Contact</span><span data-for="shutdown">Engine cutoff</span><span data-for="landed">Touchdown complete</span></p>
    <footer className="landing-footer">
      <span>Illustrative profile, not flight telemetry. Space is silent: you see the plume, you hear nothing.</span>
      <button className="visor-control pointer-events-auto" onClick={requestLandingSkip}><FastForward size={14} />Skip landing<kbd>Esc</kbd></button>
    </footer>
  </div>
}
