import { useEffect, useRef } from 'react'
import { MoonWalk } from './MoonWalk'
import { LunarCompanion } from './LunarCompanion'
import { BuriWhisper, useBuriReactions } from './BuriWhisper'
import type { ReactionScene } from './lib/buriReactions'
import type { ComponentProps } from 'react'
import './chader-buri.css'

const portrait = '/chader-buri-guide.webp'
export type GuideMode = 'icon' | 'chat' | 'tour'

type Props = Omit<ComponentProps<typeof LunarCompanion>,'onClose'> & {
  mode:GuideMode; onMode:(mode:GuideMode)=>void; landed:boolean; arriving:boolean; flightVisible:boolean; sunState:string; earthClearance:number
  scene:ReactionScene; reactions:boolean
  showHelpLabel?:boolean
}
export function ChaderBuriGuide(p:Props) {
  const launcher=useRef<HTMLButtonElement>(null)
  const {whisper,dismiss}=useBuriReactions(p.scene,p.reactions&&p.mode==='icon')
  const close=()=>{p.onMode('icon');requestAnimationFrame(()=>launcher.current?.focus())}
  useEffect(()=>{
    if(p.mode==='icon')return
    const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close()}}
    window.addEventListener('keydown',key,true)
    return ()=>window.removeEventListener('keydown',key,true)
  },[p.mode])
  if(p.mode==='icon')return <div className="buri-corner">
    {whisper&&<BuriWhisper whisper={whisper} onDismiss={dismiss} onOffer={action=>{p.onAction(action)}} onReply={()=>{dismiss();p.onMode('chat')}}/>}
    <button ref={launcher} className="buri-launch" data-calling={!!whisper} aria-label="Ask Chader Buri for help" onClick={()=>{dismiss();p.onMode('chat')}}><span><img src={portrait} alt=""/></span>{p.showHelpLabel&&<strong>Help</strong>}</button>
  </div>
  if(p.mode==='chat')return <div className="buri-dock buri-conversation" data-guide-open><LunarCompanion {...p} onClose={close}/></div>
  return <MoonWalk siteName={p.siteName} landed={p.landed} flightVisible={p.flightVisible} arriving={p.arriving} sunState={p.sunState} earthClearance={p.earthClearance} onAction={p.onAction} onExplore={close} onChat={()=>p.onMode('chat')}/>
}
