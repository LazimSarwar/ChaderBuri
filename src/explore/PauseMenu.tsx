import { useQuality, type QualityStore } from './qualityStore'
import { useEffect, useRef } from 'react'
import { ArrowLeft, Crosshair, Flag, Gauge, Globe2, LogOut, MapPin, Play, Sun } from 'lucide-react'
import { RENDER_QUALITIES, type RenderQuality, type SurfacePreferences } from '../lib/surfacePolish'
import type { MissionLink } from './useFieldBridge'
import { HeightNote } from './HeightNote'
import { ACTIVITIES, qualityText, type ActivityId, type QualityReport } from './fieldJourney'

type Props = {
  siteName: string
  prefs: SurfacePreferences
  reduced: boolean
  speechAvailable: boolean
  missionLink: MissionLink | null
  eyeHeightM: number
  analysisObserverHeightM: number
  /** The first field objective: bring it back after free exploration, or hide it. */
  objective?: { title: string; free: boolean; onShow: () => void; onHide: () => void }
  /** The field activities; the active one is marked. */
  activities?: { active: ActivityId | null; done: ActivityId[]; onStart: (id: ActivityId) => void }
  quality?: QualityReport | null
  qualityStore?: QualityStore
  onPrefs: (next: SurfacePreferences) => void
  onResume: () => void
  onRecenter: (target: 'lander' | 'sun' | 'earth') => void
  onReturnToLanding: () => void
  onBackToMission: () => void
  onExit: () => void
  onClassic: () => void
  onReview?: () => void
  onSetup?: () => void
  onHelp?: () => void
}
type BoolKey = { [K in keyof SurfacePreferences]: SurfacePreferences[K] extends boolean ? K : never }[keyof SurfacePreferences]
const QUALITY_LABEL: Record<RenderQuality, string> = { auto: 'Auto', high: 'High', balanced: 'Balanced', low: 'Low' }

/** Esc menu. Movement and the clock are paused while it is open. */
export function PauseMenu(p: Props) {
  const quality = useQuality(p.qualityStore, p.quality)
  const first = useRef<HTMLButtonElement>(null), root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    first.current?.focus()
    return () => { if (previous && document.contains(previous)) previous.focus() }
  }, [])
  // Keep Tab inside the dialog.
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !root.current) return
    const items = [...root.current.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled])')]
    if (!items.length) return
    const a = items[0], z = items[items.length - 1]
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
  }
  const toggle = (key: BoolKey, label: string, detail: string, disabled = false) =>
    <label className="field-toggle"><input type="checkbox" checked={!!p.prefs[key] && !disabled} disabled={disabled} onChange={e => p.onPrefs({ ...p.prefs, [key]: e.target.checked })} /><span>{label}<small>{detail}</small></span></label>
  const motionPct = Math.round((p.reduced ? 0 : p.prefs.motionScale) * 100)
  return <div className="field-pause-scrim pointer-events-auto">
    <div ref={root} className="field-pause" role="dialog" aria-modal="true" aria-labelledby="field-pause-title" onKeyDown={trap}>
      <p className="field-kicker">Paused · {p.siteName}</p>
      <h2 id="field-pause-title">Field menu</h2>
      <div className="field-pause-actions">
        <button ref={first} className="field-button is-primary" onClick={p.onResume}><Play size={16} aria-hidden="true" />Resume</button>
        {p.onReview && <button className="field-button" onClick={p.onReview}>Review field assignment</button>}
        {p.missionLink && <button className="field-button" onClick={p.onBackToMission}><ArrowLeft size={16} aria-hidden="true" />{p.missionLink.source === 'compare' ? 'Back to comparison' : 'Back to mission plan'}</button>}
        <button className="field-button" onClick={p.onExit}><LogOut size={16} aria-hidden="true" />Exit to orbit</button>
      </div>

      {(p.onSetup||p.onHelp)&&<div className="field-help-links">{p.onSetup&&<button className="field-button" onClick={p.onSetup}>Plan with help</button>}{p.onHelp&&<button className="field-button" onClick={p.onHelp}>How to use this project</button>}</div>}
      {p.activities && <>
        <h3 className="field-subhead">Activities</h3>
        <div className="field-pause-activities">
          {ACTIVITIES.map(a => {
            const isEarth = a.id === 'earth', active = isEarth ? !!p.objective && !p.objective.free && !p.activities!.active : p.activities!.active === a.id
            const done = p.activities!.done.includes(a.id)
            return <button key={a.id} className="field-next-item" aria-pressed={active} onClick={() => isEarth ? p.objective?.onShow() : p.activities!.onStart(a.id)}>
              <strong>{a.title}{done && <span className="field-tag">Done</span>}{active && <span className="field-tag is-live">Now</span>}</strong><small>{a.question}</small>
            </button>
          })}
          {p.objective && !p.objective.free && <button className="field-button" onClick={p.objective.onHide}><Flag size={16} aria-hidden="true" />Free exploration (hide the activity card)</button>}
        </div>
      </>}

      <h3 className="field-subhead">Recenter</h3>
      <div className="field-pause-grid">
        <button className="field-button" onClick={() => p.onRecenter('lander')}><Crosshair size={16} aria-hidden="true" />Recenter view on the lander</button>
        <button className="field-button" onClick={() => p.onRecenter('sun')}><Sun size={16} aria-hidden="true" />Recenter view on the Sun</button>
        <button className="field-button" onClick={() => p.onRecenter('earth')}><Globe2 size={16} aria-hidden="true" />Recenter view on Earth</button>
        <button className="field-button" onClick={p.onReturnToLanding}><MapPin size={16} aria-hidden="true" />Return to landing point</button>
      </div>

      <h3 className="field-subhead">Settings</h3>
      <div className="field-setting">
        <label htmlFor="field-motion"><span>Motion effects</span><small>{p.reduced ? 'Off: your device asks for reduced motion.' : `${motionPct}% · head sway, dust and transitions in the view.`}</small></label>
        <input id="field-motion" type="range" min={0} max={100} step={10} value={motionPct} disabled={p.reduced} aria-valuetext={`${motionPct} percent`} onChange={e => p.onPrefs({ ...p.prefs, motionScale: Number(e.target.value) / 100 })} />
      </div>
      <div className="field-setting">
        <span className="field-setting-label" id="field-quality-label">Display quality<small>{qualityText(quality)}</small></span>
        <div className="field-segment" role="radiogroup" aria-labelledby="field-quality-label">
          {RENDER_QUALITIES.map(q => <button key={q} role="radio" aria-checked={p.prefs.quality === q} onClick={() => p.onPrefs({ ...p.prefs, quality: q })}>{QUALITY_LABEL[q]}</button>)}
        </div>
      </div>
      <div className="field-toggles">
        {toggle('captions', 'Chader Buri captions', 'Her short tips and remarks while you explore.')}
        {p.speechAvailable ? toggle('readAloud', 'Read her captions aloud', 'Your browser’s speech voice. Off by default; browser speech services may process the text.') : <p className="field-source">Read-aloud is not available in this browser.</p>}
        {toggle('largeText', 'Larger text', 'Bigger captions, labels and panels.')}
        {toggle('motion', 'Camera bob while walking', p.reduced ? 'Off: your device asks for reduced motion.' : 'A gentle 8 mm sway. Off by default.', p.reduced)}
        {toggle('helmetFrame', 'Helmet frame', 'A faint visor edge around the view.')}
        {toggle('suitLamp', 'Helmet lamp', 'An illustrative lamp for dark ground. Display light only: it adds no solar power and changes no result.')}
        {toggle('fieldGloves', 'Gloves', 'Show your suit gloves at the bottom of the view.')}
        {toggle('fieldVisor', 'Mission Visor instruments', 'Power, Earth link, environment and mission clock on the helmet display (V).')}
      </div>
      {p.reduced && <p className="field-source">Reduced motion is on: no camera bob and no animated transitions.</p>}
      <HeightNote eyeHeightM={p.eyeHeightM} analysisObserverHeightM={p.analysisObserverHeightM} missionLinked={!!p.missionLink} />
      <button className="field-text-button" onClick={p.onClassic}><Gauge size={14} aria-hidden="true" />Classic instruments (assignments, measurements, expert tools)</button>
    </div>
  </div>
}
