import { useEffect, useMemo, useRef, useState } from 'react'
import { BatteryMedium, Clock3, Eye, EyeOff, LayoutDashboard, Radio, Sun, X } from 'lucide-react'
import '@fontsource-variable/jetbrains-mono'
import './mission-visor.css'
import { projectVisit, type VisitPose } from './lib/visit'
import { OUTPOST_POSITION, objectBearing } from './lib/surfaceMission'
import { ASTRONAUT_EYE_HEIGHT_M } from './lib/astronautMotion'
import { visorGroups, visorDigest, type VisorGroup, type VisorGroupId, type VisorInputs } from './lib/visorData'
import { useScreenDigest } from './lib/screenDigest'
import type { SurfacePreferences } from './lib/surfacePolish'
import type { VisorReading } from './lib/contracts'
import type { VisitPoseStore } from './explore/visitPoseStore'
import { useVisitPose } from './explore/useVisitPose'

const GROUP_PREF: Record<VisorGroupId, keyof SurfacePreferences> = { power: 'visorPower', link: 'visorLink', environment: 'visorEnvironment', clock: 'visorClock' }
const GROUP_ICON = { power: BatteryMedium, link: Radio, environment: Sun, clock: Clock3 }
const KIND_LABEL = { measured: 'Measured', calculated: 'Calculated', estimated: 'Estimated', illustrative: 'Illustrative' }

type Marker = { id: string; label: string; detail: string; az: number; el: number; tone: 'sun' | 'earth' | 'lander' | 'target'; status?: string }
type Props = {
  inputs: VisorInputs
  pose: VisitPose
  poseSource?: VisitPoseStore
  preferences: SurfacePreferences
  onPreferences: (value: SurfacePreferences) => void
  onMissionControl: () => void
  onAsk: (question: string) => void
}

const wrap = (deg: number) => ((deg + 540) % 360) - 180

/** Helmet heads-up display: four instrument groups, AR markers, and a route to Mission Control. */
export function MissionVisor(input: Props) {
  const pose = useVisitPose(input.preferences.visor ? input.poseSource : undefined, input.pose)
  const p = { ...input, pose }
  const root = useRef<HTMLDivElement>(null), [size, setSize] = useState({ w: 1280, h: 800 })
  const [open, setOpen] = useState<{ group: VisorGroupId; id: string } | null>(null)
  const groups = useMemo(()=>visorGroups(p.inputs),[p.inputs])
  const prefs = p.preferences, on = prefs.visor
  const signature = groups.map(g => g.headline.value + g.headline.status).join('|')
  useScreenDigest('surface', on ? visorDigest(groups) : null, `${on}|${signature}|${Math.floor(p.inputs.row)}`)

  useEffect(() => {
    const node = root.current; if (!node) return
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width || 1, h: entry.contentRect.height || 1 }))
    observer.observe(node); return () => observer.disconnect()
  }, [])
  // V toggles the visor (not while typing).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (e.key.toLowerCase() !== 'v' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || t?.closest('input,textarea,select,[contenteditable]')) return
      p.onPreferences({ ...prefs, visor: !prefs.visor })
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [prefs, p.onPreferences])

  const byId = Object.fromEntries(groups.map(g => [g.id, g])) as Record<VisorGroupId, VisorGroup>

  const ask = (g: VisorGroup, r: VisorReading) => (setOpen(null), p.onAsk(`My visor’s ${g.title} shows “${r.label}: ${r.value}${r.unit ? ' ' + r.unit : ''}”${r.status === 'fail' ? ' in red' : r.status === 'warn' ? ' in amber' : ''}. What does it mean, and why?`))
  const reading = (g: VisorGroup, r: VisorReading, headline = false) => {
    const active = open?.group === g.id && open.id === r.id
    return <button key={r.id} className={headline ? 'visor-headline' : 'visor-detail'} data-status={r.status} aria-expanded={active} onClick={() => setOpen(active ? null : { group: g.id, id: r.id })}>
      <span>{r.label}</span><strong>{r.value}{r.unit && <small>{r.unit}</small>}</strong>
    </button>
  }
  const openGroup = open ? byId[open.group] : null, openReading = openGroup && [openGroup.headline, ...openGroup.details].find(r => r.id === open!.id)
  const aspect = size.w / size.h

  return <div ref={root} className="mission-visor" data-on={on} aria-label="Mission Visor">
    <div className="visor-bar pointer-events-auto">
      <button className="visor-control" onClick={p.onMissionControl}><LayoutDashboard size={14} />Mission Control</button>
      <button className="visor-control" aria-pressed={on} onClick={() => p.onPreferences({ ...prefs, visor: !on })} title="Toggle the visor (V)">{on ? <Eye size={14} /> : <EyeOff size={14} />}Visor<kbd>V</kbd></button>
      {on && <span className="visor-chips" role="group" aria-label="Instrument groups">{groups.map(g => {
        const Icon = GROUP_ICON[g.id], key = GROUP_PREF[g.id], shown = !!prefs[key]
        return <button key={g.id} aria-pressed={shown} aria-label={`${shown ? 'Hide' : 'Show'} ${g.title}`} title={g.title} onClick={() => p.onPreferences({ ...prefs, [key]: !shown })}><Icon size={13} /></button>
      })}</span>}
    </div>
    {on && <>
      <div className="visor-frame" aria-hidden="true"><i /><i /><i /><i /></div>
      <VisorMarkers input={p} byId={byId} signature={signature} aspect={aspect} />
      <div className="visor-groups">
        {(['power', 'link'] as const).map(id => prefs[GROUP_PREF[id]] && <Group key={id} group={byId[id]} side="left" render={reading} onHide={() => p.onPreferences({ ...prefs, [GROUP_PREF[id]]: false })} />)}
      </div>
      <div className="visor-groups" data-side="right">
        {(['environment', 'clock'] as const).map(id => prefs[GROUP_PREF[id]] && <Group key={id} group={byId[id]} side="right" render={reading} onHide={() => p.onPreferences({ ...prefs, [GROUP_PREF[id]]: false })} />)}
      </div>
      {openGroup && openReading && <aside className="visor-source pointer-events-auto" aria-label={`${openReading.label} source`}>
        <header><span data-kind={openReading.kind}>{KIND_LABEL[openReading.kind]}</span><button aria-label="Close source" onClick={() => setOpen(null)}><X size={14} /></button></header>
        <h3>{openGroup.title} · {openReading.label}</h3>
        <p className="visor-source-value" data-status={openReading.status}>{openReading.value}{openReading.unit && <small> {openReading.unit}</small>}</p>
        {openReading.id === openGroup.headline.id && openGroup.details.length > 0 && <dl>{openGroup.details.map(d => <div key={d.id}><dt>{d.label}</dt><dd data-status={d.status}>{d.value}{d.unit ? ' ' + d.unit : ''}</dd></div>)}</dl>}
        <p><strong>Source</strong> {openReading.source}</p>
        {openReading.assumption && <p><strong>Assumption</strong> {openReading.assumption}</p>}
        <button className="buri-ask" onClick={() => ask(openGroup, openReading)}><img src="/chader-buri-guide.webp" alt="" />Ask Chader Buri about this</button>
      </aside>}
    </>}
  </div>
}

function Group({ group, side, render, onHide }: { group: VisorGroup; side: 'left' | 'right'; render: (g: VisorGroup, r: VisorReading, headline?: boolean) => React.ReactNode; onHide: () => void }) {
  const Icon = GROUP_ICON[group.id]
  const battery = group.id === 'power' && group.headline.unit === '%' ? Math.max(0, Math.min(100, Number(group.headline.value))) : null
  return <section className="visor-group pointer-events-auto" data-side={side} data-status={group.headline.status} aria-label={group.title}>
    <header><Icon size={12} /><span>{group.title}</span><button aria-label={`Hide ${group.title}`} onClick={onHide}><X size={11} /></button></header>
    {render(group, group.headline, true)}
    {battery !== null && <div className="visor-battery" data-status={group.headline.status} aria-hidden="true"><i style={{ width: `${battery}%` }} /></div>}
    <div className="visor-details">{group.details.slice(0, 3).map(r => render(group, r))}</div>
  </section>
}

function VisorMarkers({input,byId,signature,aspect}:{input:Props;byId:Record<VisorGroupId,VisorGroup>;signature:string;aspect:number}){
 const pose=useVisitPose(input.poseSource,input.pose),p={...input,pose}
  const markers = useMemo<Marker[]>(() => {
    const eastM = p.pose.eastM ?? 0, northM = p.pose.northM ?? 0, eye = p.pose.eyeHeightM ?? ASTRONAUT_EYE_HEIGHT_M
    const landerDist = Math.hypot(OUTPOST_POSITION.eastM - eastM, OUTPOST_POSITION.northM - northM)
    const targetDist = Math.hypot(eastM, northM)
    const power = byId.power.headline, link = byId.link.headline, env = byId.environment
    const list: Marker[] = [
      { id: 'sun', label: 'Sun', detail: `${env.headline.value}° · ${env.details.find(d => d.id === 'sun-eta')?.label.toLowerCase()} ${env.details.find(d => d.id === 'sun-eta')?.value}`, az: p.inputs.sun.az, el: p.inputs.sun.el, tone: 'sun', status: env.headline.status },
      { id: 'earth', label: 'Earth', detail: link.unit ? `est. link ${link.value} ${link.unit}` : link.value, az: p.inputs.earth.az, el: p.inputs.earth.el, tone: 'earth', status: link.status },
      { id: 'lander', label: 'Lander', detail: `${landerDist.toFixed(0)} m · battery ${power.unit ? power.value + ' ' + power.unit : power.value}`, az: objectBearing('lander', p.pose), el: Math.atan2(1.3 - eye, Math.max(1, landerDist)) * 180 / Math.PI, tone: 'lander', status: power.status },
    ]
    if (targetDist > 3) list.push({ id: 'target', label: 'Landing target', detail: `${targetDist.toFixed(0)} m · analysis point`, az: (Math.atan2(-eastM, -northM) * 180 / Math.PI + 360) % 360, el: Math.atan2(-eye, targetDist) * 180 / Math.PI, tone: 'target' })
    return list
  }, [p.pose.eastM, p.pose.northM, p.pose.eyeHeightM, p.pose.heading, signature, p.inputs.sun.az, p.inputs.sun.el, p.inputs.earth.az, p.inputs.earth.el])

return <div className="visor-markers" aria-hidden="true">{markers.map((m, index) => {
        const proj = projectVisit(m.az, m.el, p.pose, aspect), inside = proj && proj.x > .04 && proj.x < .96 && proj.y > .1 && proj.y < .9
        if (inside) return <div key={m.id} className="visor-marker" data-tone={m.tone} data-status={m.status} style={{ left: `${proj!.x * 100}%`, top: `${proj!.y * 100}%` }}><b /><span><strong>{m.label}</strong><small>{m.detail}</small></span></div>
        const rel = wrap(m.az - p.pose.heading), left = rel < 0
        // Off-screen targets wait in a band below the horizon line, one row each, so they never cover in-view markers.
        return <div key={m.id} className="visor-edge" data-tone={m.tone} data-side={left ? 'left' : 'right'} style={{ top: `calc(63% + ${index * 34}px)` }}><span>{left ? '◀' : ''} {m.label} {Math.abs(rel).toFixed(0)}° {left ? '' : '▶'}</span></div>
      })}</div>
}
