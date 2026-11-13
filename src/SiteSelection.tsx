import { ArrowRight, Mountain, X } from 'lucide-react'
import type { Mission, Site } from './data'

export function SiteSelection({site,mission,pending,loading=false,progress,onSkip,onVisit,onDetails,onSites,onClose,onCompare}: {
  site: Site | null; mission: Mission | null; pending: boolean
  progress: number | null; onSkip: ()=>void
  loading?: boolean
  onCompare?:()=>void
  onVisit: ()=>void; onDetails: ()=>void; onSites: ()=>void; onClose: ()=>void
}) {
  const title = site?.name ?? mission?.name ?? 'Mission location'
  const lat = site?.lat ?? mission?.lat, lon = site?.lonEast ?? mission?.lonEast
  return <section className="site-selection pointer-events-auto" data-arriving={pending} aria-label="Selected mission site">
    <header className="flex items-start justify-between gap-3"><div><p className="eyebrow">{site ? 'Supported lunar site' : 'Mission location'}</p><h2>{title}</h2></div><button className="tool-button" aria-label="Close selected site" onClick={onClose}><X size={16}/></button></header>
    {lat!=null&&lon!=null&&<p className="mt-2 font-mono text-xs text-inkdim">{Math.abs(lat).toFixed(4)}°{lat<0?'S':'N'} · {Math.abs(lon).toFixed(4)}°{lon<0?'W':'E'}</p>}
    {site ? <><button className="primary-action mt-4" disabled={pending||loading} onClick={onVisit}><span className="flex items-center gap-2"><Mountain size={16}/>{loading ? 'Loading site predictions…' : pending ? 'Entering terrain…' : 'Visit terrain · 360°'}</span><ArrowRight size={16}/></button><p className="mt-2 text-xs leading-5 text-inkdim">Look freely in every direction. Measured LOLA terrain reconstruction; surface colour is illustrative.</p></> : <p className="mt-3 text-sm leading-6 text-inkdim">Detailed terrain is not available for this mission location. Choose a supported lunar site to visit.</p>}
    {pending&&<div className="visit-arrival" role="status"><div className="arrival-steps"><span data-active={(progress??0)<0.45}>01 · APPROACH</span><span data-active={(progress??0)>=0.45&&(progress??0)<0.85}>02 · DESCEND</span><span data-active={(progress??0)>=0.85}>03 · SURFACE</span></div><progress aria-label="Camera arrival" value={progress??0} max={1}/><p className="mb-2 text-[10px] text-inkdim">Camera tour · not a spacecraft trajectory</p><button className="text-xs text-earth underline" onClick={onSkip}>Skip arrival ↗</button></div>}
    {!pending&&<div className="mt-3 flex flex-wrap gap-4 text-xs text-earth">{onCompare&&<button disabled={loading} onClick={onCompare}>Compare this site</button>}<button disabled={loading} onClick={onDetails}>Site & mission details</button><button onClick={onSites}>{site ? 'Choose another site' : 'Browse supported sites'}</button></div>}
  </section>
}
