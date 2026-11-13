import { useEffect, useState, type ReactNode } from 'react'
import './mission-view-controls.css'

const COMPACT_CONTROLS = '(max-width:767px), (max-width:1023px) and (max-height:500px)'

/** Keep the result near the top on small screens without changing the controls or their tab order. */
export function MissionViewControls({ view, resetKey, children }: { view: string; resetKey?: number; children: ReactNode }) {
  const [open, setOpen] = useState(() => !window.matchMedia(COMPACT_CONTROLS).matches)
  useEffect(() => {
    const media = window.matchMedia(COMPACT_CONTROLS)
    const changed = () => setOpen(!media.matches)
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useEffect(() => { if (window.matchMedia(COMPACT_CONTROLS).matches) setOpen(false) }, [resetKey])
  return <details className="mp-view-controls" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>Change site, date or view</span>{view !== 'Overview' && <small>Showing {view}</small>}</summary>
    <div className="mp-view-controls-body">{children}</div>
  </details>
}
