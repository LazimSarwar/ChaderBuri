import { useEffect, useRef } from 'react'
import { AlertTriangle, LayoutDashboard, RotateCcw } from 'lucide-react'
import { failureCopy, type GraphicsFailure } from './lib/graphicsFailure'
import './graphics-failure.css'

/**
 * The 3D view's failure state. Shown in the workspace layer above the scene controls (which are hidden meanwhile),
 * with a plain explanation, a bounded "Retry 3D in Low quality" where it can help, the dashboard, and the
 * original error kept in a separate technical section. Focus moves here when it appears.
 */
export function GraphicsFailurePanel({ failure, retriesLeft, onRetry, onDashboard }: {
  failure: GraphicsFailure
  retriesLeft: number
  onRetry: () => void
  onDashboard: () => void
}) {
  const copy = failureCopy(failure.kind, retriesLeft), heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus({ preventScroll: true }) }, [failure.at])
  return <section className="graphics-failure pointer-events-auto" role="alert" aria-labelledby="graphics-failure-title" data-kind={failure.kind}>
    <div className="graphics-failure-head"><AlertTriangle size={18} aria-hidden="true" /><h2 id="graphics-failure-title" ref={heading} tabIndex={-1}>{copy.title}</h2></div>
    <p>{copy.explain}</p>
    <div className="graphics-failure-actions">
      {copy.retry && <button className="is-primary" onClick={onRetry}><RotateCcw size={15} aria-hidden="true" />Retry 3D in Low quality</button>}
      <button onClick={onDashboard}><LayoutDashboard size={15} aria-hidden="true" />Open dashboard</button>
    </div>
    {copy.retry && <p className="graphics-failure-note">{retriesLeft === 1 ? 'One retry left in this session.' : `${retriesLeft} retries left in this session.`}</p>}
    <details className="graphics-failure-details">
      <summary>Technical details</summary>
      <dl>
        <div><dt>Kind</dt><dd>{failure.kind}</dd></div>
        <div><dt>Error</dt><dd>{failure.error}</dd></div>
        <div><dt>WebGL 2</dt><dd>{failure.webgl2 ? 'available' : 'unavailable'}</dd></div>
        <div><dt>Renderer</dt><dd>{failure.renderer ?? 'not reported'}</dd></div>
        <div><dt>Time</dt><dd>{failure.at}</dd></div>
      </dl>
      {failure.stack && <pre>{failure.stack}</pre>}
      <p>The full error is also in the browser console (“3D view failed”).</p>
    </details>
  </section>
}
