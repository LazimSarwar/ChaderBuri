import { useState } from 'react'
import { accuracyText, type AccuracyScope } from './accuracyText'
export function AccuracyBadge({ scope, resolutionM, heightM, validationNote }: { scope: AccuracyScope; resolutionM: number; heightM: number; validationNote?: string }) {
  const [open, setOpen] = useState(false), info = accuracyText(scope, resolutionM, heightM, validationNote)
  return <span className="accuracy-badge"><button type="button" aria-label={`Source and limits: ${scope}`} aria-expanded={open} onClick={() => setOpen(!open)}>ⓘ</button>{open && <span className="accuracy-note" role="note"><strong>{info.kind[0].toUpperCase() + info.kind.slice(1)}</strong><span>{info.source}</span><span>{info.sampling}</span><span>{info.validation}</span><span>{info.scope}</span><button onClick={() => setOpen(false)}>Close source note</button></span>}</span>
}
