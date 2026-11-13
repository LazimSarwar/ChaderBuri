import { useState, type ReactNode } from 'react'
import { ArrowLeft, BookA, BookOpen, Columns2, Ellipsis, Lightbulb, MapPin, Pause, Play, Share2, Target } from 'lucide-react'
import { SPEEDS } from './lib/sim'

type Props = {
  compact?: boolean
  orbit?: boolean
  clockStr: string; dateStr: string; sitesOpen: boolean; toolsOpen: boolean
  onExplore: () => void; onSites: () => void; onTools: () => void; onEvidence: () => void
  onCompare: () => void; onMap: () => void; onGlossary: () => void
  onSetup?: () => void; onHelp?: () => void; onWeather?: () => void
  onQuickCompare:()=>void;compareReady:boolean
  explain: boolean; onExplain: (v: boolean) => void
  onReverse: () => void; reverse: boolean; onNow: () => void
  playing: boolean; onPlay: () => void; speed: number; onSpeed: (v: number) => void
  realtime: boolean
  blink: ReactNode
}

export function WorkspaceBar(p: Props) {
  const [menu, setMenu] = useState(false)
  const [share, setShare] = useState('Share view')
  const [showPlayback,setShowPlayback]=useState(false)
  const [orbitTime,setOrbitTime]=useState(false)
  const condensed=!!p.compact&&!showPlayback
  return <header className="workspace-bar pointer-events-auto" data-compact={condensed} data-time-expanded={p.orbit&&orbitTime}>
    <button className="brand" onClick={p.onExplore} aria-label="Chader Buri home — close all panels"><span className="brand-orbit" /><span>Chader Buri<small>Lunar mission planning</small></span></button>
    <nav aria-label="Workspace controls" className="workspace-tabs"><button aria-expanded={p.sitesOpen} onClick={()=>{setMenu(false);p.onSites()}}><MapPin size={15}/><span>Mission sites</span></button><button aria-expanded={p.toolsOpen} onClick={()=>{setMenu(false);p.onTools()}}><Target size={15}/><span>Dashboard</span></button></nav>
    <button className="workspace-quick-compare tool-button" disabled={!p.compareReady} onClick={p.onQuickCompare}><Columns2 size={14}/>Compare sites & dates</button>
    <div className="ml-auto flex items-center gap-2"><div className="epoch-readout" aria-label="Scene date and time UTC"><small>Scene · UTC</small><span>{p.dateStr}</span><strong>{p.clockStr}</strong></div>
      <button className="tool-button explain-toggle" aria-pressed={p.explain} onClick={() => { setMenu(false); p.onExplain(!p.explain) }} title="Plain-language captions under every decision number"><Lightbulb size={14} /><span>Explain</span></button>
      <button className="tool-button" onClick={() => setMenu(!menu)} aria-expanded={menu} aria-label="More tools"><Ellipsis size={19} /></button>
      {menu && <div className="tools-menu">
        {p.onSetup&&<button onClick={()=>{p.onSetup?.();setMenu(false)}}>Plan with help</button>}
        {p.onHelp&&<button onClick={()=>{p.onHelp?.();setMenu(false)}}><BookOpen size={14}/>How to use</button>}
        {p.onWeather&&<button onClick={()=>{p.onWeather?.();setMenu(false)}}>Space weather</button>}
        {p.orbit&&<button className="orbit-menu-explain" aria-pressed={p.explain} onClick={()=>{p.onExplain(!p.explain);setMenu(false)}}><Lightbulb size={14}/>Explain mode {p.explain?'on':'off'}</button>}
        {p.compact&&<button onClick={()=>{setShowPlayback(v=>!v);setMenu(false)}}>{condensed?'Show':'Hide'} scene playback controls</button>}
        <button disabled={!p.compareReady} onClick={()=>{p.onQuickCompare();setMenu(false)}}><Columns2 size={14}/>Compare sites & dates</button>
        <button onClick={()=>{p.onEvidence();setMenu(false)}}><BookOpen size={14}/>Sources & methods</button>
        <button onClick={() => { p.onGlossary(); setMenu(false) }}><BookA size={14} />Glossary</button>
        <button onClick={() => { p.onMap(); setMenu(false) }}>Lunar south-pole atlas</button>
        {p.blink}
        <button onClick={async () => { try { await navigator.clipboard.writeText(window.location.href); setShare('View link copied') } catch { setShare('Copy the address bar link') } }}><Share2 size={14} />{share}</button>
      </div>}
    </div>
    {!condensed&&<div className="playback-bar"><span className="prediction-label"><i />{p.realtime ? 'Scene · following UTC' : p.orbit ? (p.playing?'Time playing':'Time paused') : 'Scene · cached JPL predictions'}</span><div className="flex items-center gap-2">
      {p.orbit&&<button className="tool-button orbit-time-toggle" aria-label="Time controls and timeline" aria-expanded={orbitTime} onClick={()=>setOrbitTime(v=>!v)}>Time</button>}
      <button className="tool-button time-advanced" aria-pressed={p.realtime} onClick={() => { setMenu(false); p.onNow() }}>Now (UTC)</button>
      <button className="tool-button time-advanced" onClick={p.onReverse} aria-pressed={p.reverse} aria-label="Reverse time"><ArrowLeft size={14} /></button>
      <button className="tool-button" onClick={() => { setMenu(false); p.onPlay() }} aria-label={p.playing ? 'Pause simulation' : 'Play simulation'}>{p.playing ? <Pause size={14} /> : <Play size={14} />}{p.orbit&&<span className="orbit-play-label">{p.playing?'Pause':'Play'}</span>}</button>
      <select className="tool-button time-advanced" aria-label="Playback speed" value={p.speed} onChange={e => p.onSpeed(Number(e.target.value))}>{SPEEDS.map(s => <option value={s.value} key={s.value}>{s.label}</option>)}</select>
    </div></div>}
  </header>
}
