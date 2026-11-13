import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, BookA, BookOpen, ChevronDown, Map, MapPin, Sun, Type } from 'lucide-react'
import type { WorkspacePanel } from './lib/workspace'
import { useMissionSummary } from './lib/missionSummary'

const TEXT_KEY = 'chader-buri.text-size'
/** Larger text for the dashboard and Chader Buri's panel: the whole page scales, so nothing is cut or hidden. Remembered on this device. */
function useLargeText() {
  const [large, setLarge] = useState(() => { try { return localStorage.getItem(TEXT_KEY) === 'large' } catch { return false } })
  useEffect(() => {
    document.documentElement.dataset.textSize = large ? 'large' : 'normal'
    try { localStorage.setItem(TEXT_KEY, large ? 'large' : 'normal') } catch { /* storage unavailable: this visit only */ }
  }, [large])
  return [large, setLarge] as const
}

type Section = Exclude<WorkspacePanel, null | 'selection' | 'validation'>
const SECTIONS: { id: Section; label: string; icon: typeof Sun }[] = [
  { id: 'conditions', label: 'Site conditions', icon: Sun },
  { id: 'sites', label: 'Sites', icon: MapPin },
  { id: 'atlas', label: 'Atlas', icon: Map },
  { id: 'evidence', label: 'Validation & sources', icon: BookOpen },
  { id: 'glossary', label: 'Glossary', icon: BookA },
  { id: 'guide', label: 'How to use', icon: BookOpen },
  { id: 'weather', label: 'Space weather', icon: Sun },
]

/**
 * The mission being planned, on every dashboard page, kept apart from the 3D scene's clock:
 * site · landing (UTC) · duration · equipment · verdict, with the scene time shown separately.
 */
/** guideChange: the last mission change Chader Buri made, shown with Undo while the mission is still as she left it. */
export function MissionBar(p: { sceneUTC: string; onEdit?: () => void; guideChange?: { text: string; onUndo: () => void } | null }) {
  const m = useMissionSummary()
  return <div className="dash-mission" role="status" aria-live="polite">
    <span className="dash-mission-label">{m?.selectedByUser ? 'Your selected plan' : 'Suggested plan'}</span>
    {m ? <>
      <span className="dash-mission-main"><strong>{m.siteName}</strong> · lands {m.landingUTC} UTC · {m.missionDays} days</span>
      <span className="dash-mission-gear">{m.equipment}</span>
      <span className="dash-mission-verdict" data-ok={m.verdict === 'meets'}>{m.verdict === 'meets' ? `✓ Meets your selected requirements` : `✕ Misses your selected requirements`}{m.updating && <em> · checking nearby touchdowns…</em>}</span>
      {p.onEdit && <button className="mp-link" onClick={p.onEdit}>Edit mission</button>}
    </> : <span className="dash-mission-main">Calculating your mission…</span>}
    {p.guideChange && <span className="dash-mission-change" role="status"><span>Chader Buri changed your mission. {p.guideChange.text.replace(/ You can undo this\.$/, '')}</span><button className="dash-btn" onClick={p.guideChange.onUndo}>Undo</button></span>}
    <span className="dash-mission-scene" title="The 3D scene has its own clock, separate from the mission landing date">3D scene time · {p.sceneUTC} UTC</span>
  </div>
}

/** One page header style for every dashboard section: small label, title, one plain sentence. */
export function DashPageHead(p: { kicker: string; title: string; text: string }) {
  return <header className="dash-head"><p className="mp-kicker">{p.kicker}</p><h2>{p.title}</h2><p>{p.text}</p></header>
}

/** The dashboard's own top bar: one row of sections, help, and the way back to the Moon. */
export function DashboardHeader(p: { panel: Exclude<WorkspacePanel, null | 'selection'>; onPanel: (panel: Section) => void; onClose: () => void; onAsk: () => void; onSurface: boolean; onSetup?: () => void; onCompare?: () => void; compareReady?: boolean; onExploreMission?: () => void }) {
  const current = p.panel === 'validation' ? 'evidence' : p.panel
  const [large, setLarge] = useLargeText()
  const mission = useMissionSummary()
  const tools = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const close = (event: PointerEvent) => { if (event.target instanceof Node && !tools.current?.contains(event.target)) tools.current?.removeAttribute('open') }
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && tools.current?.open) { event.preventDefault(); event.stopPropagation(); tools.current.removeAttribute('open'); tools.current.querySelector('summary')?.focus() }
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key, true) }
  }, [])
  const go = (panel: Section) => { tools.current?.removeAttribute('open'); p.onPanel(panel) }
  return <header className="dash-header dash-journey-header">
    <div className="dash-brand"><span className="dash-brand-mark" aria-hidden="true" /><span>Chader Buri<small>Lunar landing dashboard</small></span></div>
    <nav className="dash-nav mission-journey" aria-label="Mission journey">
      <button aria-current={current === 'setup' ? 'step' : undefined} onClick={() => p.onSetup ? p.onSetup() : go('setup')}><span aria-hidden="true">1</span>Set mission</button>
      <button aria-current={current === 'plan' ? 'step' : undefined} disabled={current === 'setup'} title={current === 'setup' ? 'Finish setting your mission to review these entries' : undefined} onClick={() => go('plan')}><span aria-hidden="true">2</span>Review result</button>
      <button aria-current={current === 'compare' ? 'step' : undefined} disabled={current === 'setup' || p.compareReady === false} title={current === 'setup' ? 'Finish setting your mission first' : p.compareReady === false ? 'Waiting for two sites to finish loading' : 'Compare sites or arrival dates with the same equipment'} onClick={() => p.onCompare ? p.onCompare() : go('compare')}><span aria-hidden="true">3</span>Compare options</button>
      <button disabled={current === 'setup' || !mission || !p.onExploreMission} title={current === 'setup' ? 'Finish setting your mission first' : mission ? `Explore the plan at ${mission.siteName}, landing ${mission.landingUTC} UTC. Use a comparison option in your plan first to explore it here.` : 'Review a mission result first'} onClick={p.onExploreMission}><span aria-hidden="true">4</span>Explore plan</button>
    </nav>
    <div className="dash-header-actions">
      <details ref={tools} className="journey-tools">
        <summary><span>Tools & help</span><ChevronDown size={14} aria-hidden="true" /></summary>
        <nav aria-label="More dashboard tools">{SECTIONS.map(({ id, label, icon: Icon }) => <button key={id} aria-current={current === id ? 'page' : undefined} onClick={() => go(id)}><Icon size={15} aria-hidden="true" />{label}</button>)}</nav>
      </details>
      <button className="dash-btn dash-text-size" aria-pressed={large} onClick={() => setLarge(v => !v)} title="Make the dashboard text larger"><Type size={15} aria-hidden="true" /><span>Larger text</span></button>
      <button className="dash-ask" onClick={p.onAsk}><img src="/chader-buri-guide.webp" alt="" /><span>Ask Chader Buri</span></button>
      <button className="dash-close" aria-label={p.onSurface ? 'Back to the surface' : 'Back to the Moon'} onClick={p.onClose}><ArrowLeft size={15} aria-hidden="true" /><span className="journey-back-long">{p.onSurface ? 'Back to the surface' : 'Back to the Moon'}</span><span className="journey-back-short">Back</span></button>
    </div>
  </header>
}
