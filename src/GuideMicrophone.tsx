import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'

type Recognizer = {
  lang:string; interimResults:boolean; continuous:boolean;
  onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>>})=>void)|null;
  onerror:((e:{error:string})=>void)|null; onend:(()=>void)|null;
  start():void; abort():void
}
type SpeechWindow = Window & {SpeechRecognition?:new()=>Recognizer;webkitSpeechRecognition?:new()=>Recognizer}
export function GuideMicrophone({onText,disabled}:{onText:(text:string)=>void;disabled:boolean}) {
  const device=useRef<Recognizer|null>(null)
  const [listening,setListening]=useState(false),[notice,setNotice]=useState('')
  useEffect(()=>()=>{const r=device.current;if(r){r.onresult=null;r.onerror=null;r.onend=null;r.abort()}},[])
  const Constructor=(window as SpeechWindow).SpeechRecognition??(window as SpeechWindow).webkitSpeechRecognition
  if(!Constructor)return null
  function toggle(){
    if(device.current){device.current.abort();return}
    const r=new Constructor!()
    device.current=r;r.lang=navigator.language;r.continuous=false;r.interimResults=false
    r.onresult=e=>{onText(e.results[0]?.[0]?.transcript.slice(0,1000)??'');setNotice('Review your question, then send.')}
    r.onerror=e=>setNotice(e.error==='not-allowed'?'Microphone access is off. Type your question below.':'Dictation stopped. You can type or try again.')
    r.onend=()=>{device.current=null;setListening(false)}
    try{window.speechSynthesis?.cancel();r.start();setListening(true);setNotice('Listening…')}catch{r.onend();setNotice('Microphone unavailable. Type your question below.')}
  }
  return <div><button type="button" className="buri-read" aria-pressed={listening} disabled={disabled} onClick={toggle}><Mic size={14}/>{listening?'Stop microphone':'Dictate a question'}</button>{notice&&<small role="status">{notice}</small>}</div>
}

