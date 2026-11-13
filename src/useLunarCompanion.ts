import { useCallback,useEffect,useRef,useState } from 'react'
import { checkedCompanionReply,contextKey,guardReply,type CompanionContext,type CompanionMessage,type CompanionTurn,type CompanionEvidence } from './lib/lunarCompanion'
import type { Constraints } from './architect/solver'
import type { ScreenDigest } from './lib/contracts'
import { appendConversation, COMPANION_HISTORY_KEY, parseCompanionHistory, readCompanionHistory, writeCompanionHistory, type ConversationEntry } from './lib/companionHistory'

export function useLunarCompanion(){
 const [mission,setMission]=useState<Constraints|null>(null)
 const [turns,setTurns]=useState<CompanionTurn[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[configured,setConfigured]=useState<boolean|null>(null),[question,setQuestion]=useState('')
 const [history,setHistory]=useState(readCompanionHistory),[storageAvailable,setStorageAvailable]=useState(true)
 const historyRef=useRef(history);historyRef.current=history
 useEffect(()=>{setStorageAvailable(writeCompanionHistory(history))},[history])
 const remember=useCallback((question:string,answer:string,context:CompanionContext,meta?:{id?:string;source?:ConversationEntry['source'];siteName?:string;sceneUTC?:string|null;at?:number})=>{
  const at=meta?.at??Date.now()
  setHistory(previous=>appendConversation(previous,{id:meta?.id??`answer:${at}:${Math.random().toString(36).slice(2,8)}`,at,question,answer,source:meta?.source??'calculated',contextStamp:contextKey(context),siteName:meta?.siteName??context.slug,sceneUTC:meta?.sceneUTC??null}))
 },[])
 const request=useRef<AbortController|null>(null)
 // Suggestions the visitor turned down this session; sent so she doesn't repeat them.
 const [dismissed,setDismissed]=useState<string[]>([]),dismissedRef=useRef(dismissed);dismissedRef.current=dismissed
 const dismiss=useCallback((key:string)=>setDismissed(d=>d.includes(key)?d:[...d,key].slice(-20)),[])
 // A seeded question is sent once per press, even if the chat panel closes and reopens.
 const seeds=useRef(new Set<number>())
 const claimSeed=useCallback((id:number)=>{if(seeds.current.has(id))return false;seeds.current.add(id);return true},[])
 useEffect(()=>()=>request.current?.abort(),[])
 const status=useCallback(async()=>{try{const r=await fetch('/api/companion',{signal:AbortSignal.timeout(5000)}),d=await r.json();if(!r.ok||typeof d.configured!=='boolean')throw new Error();setConfigured(d.configured);setError('')}catch{setConfigured(null);setError('Chader Buri’s server could not be reached. You can keep exploring.')}},[])
 const cancel=useCallback(()=>{request.current?.abort();request.current=null;setBusy(false);setQuestion('')},[])
 useEffect(()=>{
  const changed=(event:StorageEvent)=>{if(event.key!==COMPANION_HISTORY_KEY&&event.key!==null)return;cancel();setTurns([]);setHistory(parseCompanionHistory(event.newValue))}
  window.addEventListener('storage',changed);return()=>window.removeEventListener('storage',changed)
 },[cancel])
 // prior: the recent conversation (including her authored explanations) when the caller has it.
 const send=useCallback(async(text:string,context:CompanionContext,screen?:ScreenDigest|null,prior?:{question:string;answer:string}[])=>{
  if(!text.trim()||text.length>1000)return
  request.current?.abort();const controller=new AbortController();request.current=controller
  setBusy(true);setError('');setQuestion(text.trim())
  const messages:CompanionMessage[]=(prior??historyRef.current.map(t=>({question:t.question,answer:`Earlier conversation about ${t.siteName}${t.sceneUTC?` at ${t.sceneUTC}`:''}: ${t.answer}`}))).slice(-3).flatMap(t=>[{role:'user' as const,content:t.question.slice(0,1800)},{role:'assistant' as const,content:t.answer.slice(0,1800)}]);messages.push({role:'user',content:text.trim()})
  const timer=setTimeout(()=>controller.abort(),35000)
  try{
   const response=await fetch('/api/companion',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({context,messages,screen:screen??null,dismissed:dismissedRef.current}),signal:controller.signal}),d=await response.json()
   if(request.current!==controller)return
   if(!response.ok){if(d.code==='AI_NOT_CONFIGURED')setConfigured(false);throw new Error(typeof d.error==='string'?d.error:'Chader Buri could not answer.')}
   const evidence=d.evidence as CompanionEvidence
   if(!evidence||contextKey(evidence.context)!==contextKey(context)||!Array.isArray(evidence.sites)||!Array.isArray(evidence.eligibleSlugs))throw new Error('The reply belongs to another scene. Ask Chader Buri again.')
   // Navigation and mission changes run only when asked for; otherwise they become a labelled offer.
   const reply=guardReply(text,checkedCompanionReply(d.reply,evidence),context.view?.screen??'')
   if(request.current!==controller)return
   const at=Date.now()
   setConfigured(true);setTurns(previous=>[...previous,{question:text.trim(),reply,evidence,at}].slice(-8));remember(text.trim(),reply.message,context,{id:`ai:${at}`,source:'ai',siteName:evidence.sites.find(site=>site.slug===context.slug)?.name??context.slug,sceneUTC:evidence.landingUTC,at});setQuestion('');return reply
  }catch(e){if(request.current===controller)setError(controller.signal.aborted?'Chader Buri’s request was stopped. Try again when ready.':(e as Error).message)}
  finally{clearTimeout(timer);if(request.current===controller){request.current=null;setBusy(false)}}
 },[remember])
 const clear=useCallback(()=>{cancel();setTurns([]);setHistory([]);setDismissed([]);setError('');writeCompanionHistory([])},[cancel])
 return {turns,history,remember,storageAvailable,busy,error,configured,question,status,send,cancel,clear,mission,setMission,dismissed,dismiss,claimSeed}
}
export type LunarCompanionSession=ReturnType<typeof useLunarCompanion>
