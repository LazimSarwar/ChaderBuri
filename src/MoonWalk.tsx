import { useEffect, useState } from 'react'
import { ArrowRight, Compass, Globe2, Sun } from 'lucide-react'
import { lines, type JourneyLine } from './JourneyVoice'
import type { GuideAction } from './lib/guideAction'

type Props = {
  landed:boolean; arriving:boolean; flightVisible:boolean; siteName:string; sunState:string; earthClearance:number
  onAction:(action:GuideAction)=>string; onExplore:()=>void; onChat:()=>void
}
export function Departure() {
  return <section className="moon-departure" aria-label="Leaving for the Moon">
    <div className="journey-caption"><img src="/chader-buri-guide.webp" alt=""/><div><span>Chader Buri</span><p role="status">{lines.depart}</p></div></div>
  </section>
}
export function MoonWalk({landed,arriving,flightVisible,siteName,sunState,earthClearance,onAction,onExplore,onChat}:Props) {
  const [sight,setSight] = useState<'sun'|'earth'|null>(null)
  const [seenScene,setSeenScene] = useState(landed||flightVisible)
  useEffect(()=>{if(landed||flightVisible)setSeenScene(true)},[landed,flightVisible])
  let line:JourneyLine = landed?'landed':'depart'
  if (landed && sight==='sun') line=sunState==='shadowed'?'sunShadow':sunState==='grazing'?'sunGrazing':'sunLit'
  if (landed && sight==='earth') line=earthClearance>0?'earthUp':'earthDown'
  const turn=(target:'sun'|'earth')=>{
    onAction({kind:target,value:''})
    setSight(target)
  }
  return <section className="moon-walk" aria-label="Explore with Chader Buri" data-approaching={!seenScene&&arriving} data-guide-open>
    <div className="walk-site"><Compass size={18} aria-hidden="true"/><div><span>{landed?'On the surface':'Lunar approach'}</span><strong>{siteName}</strong></div></div>
    <div className="walk-dialogue journey-caption">
      <img src="/chader-buri-guide.webp" alt="Chader Buri"/>
      <div className="walk-speech"><span>Chader Buri</span><p aria-live="polite">{lines[line]}</p>
        <div className="walk-choices">
          {landed&&sight!=='sun'&&<button onClick={()=>turn('sun')}><Sun size={15}/>Find the Sun</button>}
          {landed&&sight!=='earth'&&<button onClick={()=>turn('earth')}><Globe2 size={15}/>Look for Earth</button>}
          {landed&&sight&&<button onClick={()=>{onExplore();onAction({kind:'conditions',value:''})}}>Read the instruments <ArrowRight size={14}/></button>}
          {!landed&&!arriving&&<button onClick={()=>onAction({kind:'surface',value:''})}>Resume descent</button>}
        </div>
        <div className="walk-secondary"><button onClick={onExplore}>Explore on my own</button>
          {landed&&<button onClick={onChat}>Ask her a question</button>}</div>
      </div>
    </div>
  </section>
}

