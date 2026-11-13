import { GuideMicrophone } from './GuideMicrophone'
import { actionLabel,type GuideAction } from './lib/guideAction'
import { useEffect,useRef,useState } from 'react'
import { Send,X,ArrowRight,Square } from 'lucide-react'
import { currentCompanionTurn,sameCompanionScene,contextKey,type CompanionContext,type CompanionSite } from './lib/lunarCompanion'
import type { ConversationEntry } from './lib/companionHistory'
import type { LunarCompanionSession } from './useLunarCompanion'
import { suggestionKey,type ScreenDigest } from './lib/contracts'
import { askAbout,clearBriefs,useBriefs,type LoggedBrief } from './lib/guideDesk'
import './companion-chat.css'

/** Starting questions that fit the screen the visitor is reading. */
function startingQuestions(screen:string,basis:CompanionContext['basis']){
 if(screen==='setup')return ['What arrival date should I enter?','What does each requirement mean?','Can I use an example lander?']
 if(screen==='guide')return ['Where should I begin?','What do the numbers and colours mean?','How do I compare two sites fairly?']
 if(screen==='weather')return ['What has NASA reported?','Which dates do these reports cover?','What can these reports tell me about a lunar mission?']
 // On the surface: questions about the decision being made here, answered from the screen she can read.
 if(screen==='surface')return ['Why does this site meet or miss my requirements?','What changes at the next sunset or earthset here?','How does the antenna test relate to choosing this site?']
 if(screen==='compare')return ['Why do these two options differ?','Which option meets my requirements, and why?','What does the reserve I set mean?']
 if(screen==='plan'||basis==='mission')return ['Why does my mission meet or miss my requirements?','Would landing a few days later help?','What does the reserve I set mean?']
 if(['conditions','sites','atlas','evidence','validation','glossary'].includes(screen))return ['What am I looking at here?','How do I plan a mission?','Which site has the most sunlight?']
 return ['What should I explore first?','Is this site suitable for this mission?','Can you suggest a better site?']
}

function MetricCard({site}:{site:CompanionSite}){
 return <div className="luna-evidence"><strong>{site.name}</strong><span data-pass={site.pass}>{site.pass?'Meets nominal requirements':'Misses nominal requirements'}</span><dl><dt>Minimum battery</dt><dd>{site.minBatteryPct===null?'Not assessed':site.minBatteryPct.toFixed(1)+'%'}</dd><dt>Earth outage / mission</dt><dd>{site.outageWithinMissionH} h</dd><dt>Nearby samples</dt><dd>{site.footprint?`${site.footprint.passing}/${site.footprint.total} pass`:'Not assessed'}</dd></dl>{site.failures.length>0&&<small>Misses: {site.failures.join(', ')}.</small>}</div>
}
export function LunarCompanion(p:{context:CompanionContext;siteName:string;onAction:(action:GuideAction)=>string;session:LunarCompanionSession;onClose:()=>void;onVisit:(slug:string,row:number)=>void;onFocus:(focus:'sun'|'earth'|'skyline')=>void;onGuide:()=>void;onSetup?:()=>void;onHelp?:()=>void;readScreen?:()=>ScreenDigest|null;seedQuestion?:{id:number;text:string}|null;scenario?:string|null;undo?:{available:boolean;run:()=>string}}){
 const {session:s}=p,[input,setInput]=useState(''),end=useRef<HTMLDivElement>(null),form=useRef<HTMLTextAreaElement>(null)
 const latest=s.turns.at(-1),key=contextKey(p.context),latestInThread=!!latest&&s.history.at(-1)?.id===`ai:${latest.at}`,active=latest&&latestInThread&&currentCompanionTurn(latest,p.context)
 const current=active?latest.evidence.sites.find(site=>site.slug===p.context.slug):null,recommended=active&&latest.reply.visitSlug?latest.evidence.sites.find(site=>site.slug===latest.reply.visitSlug):null
 const [actionNote,setActionNote]=useState('')
 // Her authored explanations (no AI) and her AI replies, in the order they were given.
 const briefs=useBriefs()
 useEffect(()=>{for(const b of briefs)s.remember(b.question,[b.answer,b.shown,b.next].filter(Boolean).join('\n'),p.context,{id:`brief:${b.id}`,at:b.at,source:'calculated',siteName:!b.scenario||b.scenario===p.scenario?p.siteName:'Previous mission'})},[briefs,s.remember,key,p.scenario,p.siteName])
 // What happened to each turn's suggestion card (by turn index).
 const [handled,setHandled]=useState<Record<number,'allowed'|'dismissed'>>({})
 const consent=useRef<HTMLDivElement>(null)
 const priorKey=useRef(key)
 useEffect(()=>{void s.status();return()=>s.cancel()},[])
 useEffect(()=>{if(priorKey.current!==key){priorKey.current=key;s.cancel();setActionNote('')}},[key])
 useEffect(()=>{if(s.history.length||s.busy||s.error)end.current?.scrollIntoView({block:'nearest'})},[s.history.length,s.busy,s.error])
 useEffect(()=>{const content=end.current?.closest('.luna-content');if(!content||typeof ResizeObserver==='undefined')return;const observer=new ResizeObserver(()=>end.current?.scrollIntoView({block:'nearest'}));observer.observe(content);return()=>observer.disconnect()},[])
 const send=async(text:string)=>{
   if(!text.trim()||s.busy||s.configured!==true)return
   setInput('');setActionNote('')
   const reply=await s.send(text,p.context,p.readScreen?.()??null)
   if(reply?.action&&priorKey.current===key)setActionNote(p.onAction(reply.action))
 }
 // A seeded question ("Ask Chader Buri about this") is sent once she is connected; otherwise it waits in the box.
 useEffect(()=>{const q=p.seedQuestion;if(!q||s.busy||s.configured===null||!s.claimSeed(q.id))return
  if(s.configured===true)void send(q.text);else setInput(q.text)},[p.seedQuestion?.id,s.configured,s.busy])
 const turnIndex=s.turns.length-1,suggestion=latest?.reply.suggestion??null
 // Her ideas retire as soon as the mission or scene they were about changes; they never apply to a different one.
 const sceneSame=latestInThread&&sameCompanionScene(latest!,p.context)
 const showSuggestion=!!suggestion&&sceneSame&&!handled[turnIndex]&&!s.dismissed.includes(suggestionKey(suggestion.action))
 const retiredSuggestion=!!suggestion&&latestInThread&&!sceneSame&&!handled[turnIndex]&&!s.dismissed.includes(suggestionKey(suggestion.action))
 // Her own idea runs only on Allow, and only if the scene she saw is still the scene now.
 const allow=()=>{if(!suggestion)return;if(!active){setActionNote('That suggestion was for an earlier view, so I didn’t change anything. Ask me again here.');setHandled(h=>({...h,[turnIndex]:'dismissed'}));return}
  setHandled(h=>({...h,[turnIndex]:'allowed'}));setActionNote(p.onAction(suggestion.action))}
 const notNow=()=>{if(!suggestion)return;s.dismiss(suggestionKey(suggestion.action));setHandled(h=>({...h,[turnIndex]:'dismissed'}))}
 useEffect(()=>{if(showSuggestion)consent.current?.scrollIntoView({block:'nearest'})},[showSuggestion,turnIndex])
 const missionKey=latest?.reply.proposedMission?`mission:${latest.reply.proposedMission.missionDays}d-${latest.reply.proposedMission.loadW}W-${latest.reply.proposedMission.panelAreaM2}m2`:''
 const screen=p.context.view?.screen??'',onDashboard=p.context.basis==='mission'||screen==='plan'||screen==='compare'
 // After an answer: her follow-ups plus an optional deeper explanation; before one: questions for this screen.
 const questions=active?[...latest.reply.questions.slice(0,2),'Tell me more about that']:startingQuestions(screen,p.context.basis)
 const siteName=(slug:string)=>latest?.evidence.sites.find(x=>x.slug===slug)?.name??slug
 return <section className="luna-panel luna-clear pointer-events-auto" aria-label="Chader Buri AI exploration companion">
  <header><span>Chader Buri <small>AI guide</small></span><button aria-label="Close Chader Buri" onClick={p.onClose}><X size={18}/></button></header>
  <div className="luna-content">
  <div className="luna-heading"><img className="buri-chat-portrait" src="/chader-buri-guide.webp" alt=""/><div><h3>{s.history.length?'Your conversation':'How can I help you?'}</h3><p>{p.context.basis==='mission'?`Your mission · ${p.siteName}`:p.siteName}</p></div></div>
  {!s.history.length&&<p className="luna-intro">Choose a question below, or ask in your own words. I’ll explain one step at a time.</p>}
  <div className="buri-shortcuts" aria-label="Help shortcuts">
   {p.onSetup&&<button onClick={p.onSetup}>Plan a mission</button>}
   {p.onHelp&&<button onClick={p.onHelp}>How to use this</button>}
   {onDashboard&&<button onClick={()=>askAbout(screen==='compare'?'compare':'verdict')}>Explain my result</button>}
  </div>
  {actionNote&&<p role="status" className="luna-status">{actionNote}</p>}
  {p.undo?.available&&<button className="luna-undo" onClick={()=>setActionNote(p.undo!.run())}>Undo Chader Buri’s change</button>}
  {s.configured===false&&<div className="luna-connection" role="status"><strong>Chat is temporarily unavailable</strong><p>You can still plan a mission, read the guide and explore.</p><button onClick={()=>void s.status()}>Try the connection again</button></div>}
  {s.configured===null&&<p className="luna-status" role="status">Checking Chader Buri’s connection… <button onClick={()=>void s.status()}>Retry</button></p>}
  <div className="luna-chat" role="log" aria-label="Conversation with Chader Buri" aria-live="polite" aria-relevant="additions text">
   {s.history.map(entry=>{const brief=briefs.find(b=>entry.id===`brief:${b.id}`);return brief&&!entry.restored?<Brief key={entry.id} b={brief} live={!brief.scenario||brief.scenario===p.scenario} onAction={a=>setActionNote(p.onAction(a))}/>:<SavedTurn key={entry.id} entry={entry} currentKey={key}/>})}
   {s.busy&&<><p className="luna-question">{s.question}</p><p className="luna-status">Checking the mission evidence…</p></>}
   {s.error&&<p className="luna-error" role="alert">{s.error}</p>}
   <div ref={end}/>
  </div>
  {retiredSuggestion&&<p className="luna-stale" role="status">Her last suggestion was retired because {p.context.basis==='mission'?'your mission':'the scene'} changed. Ask again if you still want it.</p>}
  {showSuggestion&&<div ref={consent} className="buri-consent" role="group" aria-label="Chader Buri’s suggestion"><span>Chader Buri suggests</span><p>{suggestion!.reason}</p>{!active&&<small>You’ve switched screens since she suggested this; it is checked again when you choose it.</small>}<div><button className="buri-allow" onClick={allow}>{actionLabel(suggestion!.action,siteName)}</button><button onClick={notNow}>Not now</button></div></div>}
  {active&&current&&<details className="luna-computed"><summary>Calculated evidence / {latest.evidence.sites.length} sites checked</summary><MetricCard site={current}/>{recommended&&<MetricCard site={recommended}/>}<small>Same date, same hardware. Ranking uses the planner’s smallest normalized margin. Outages are clipped to this mission. Hourly sampling does not establish a timing error bound.</small>{latest.evidence.unavailableSlugs.length>0&&<small>{latest.evidence.unavailableSlugs.length} sites were unavailable; no result inferred.</small>}</details>}
  {active&&<div className="luna-actions">{recommended&&!s.dismissed.includes('visit:'+recommended.slug)&&<span className="luna-offer"><button className="luna-travel" onClick={()=>p.onVisit(recommended.slug,p.context.row)}>Take me to {recommended.name}<ArrowRight size={14}/></button><button className="luna-not-now" onClick={()=>s.dismiss('visit:'+recommended.slug)}>Not now</button></span>}{latest.reply.proposedMission&&p.context.constraints.power&&!s.dismissed.includes(missionKey)&&<span className="luna-offer"><button onClick={()=>{const m=latest.reply.proposedMission!;s.setMission({...p.context.constraints,missionDays:m.missionDays,power:{...p.context.constraints.power!,loadW:m.loadW,panelAreaM2:m.panelAreaM2}})}}>Use {latest.reply.proposedMission.missionDays} days / {latest.reply.proposedMission.loadW} W / {latest.reply.proposedMission.panelAreaM2} m² · then recheck</button><button className="luna-not-now" onClick={()=>s.dismiss(missionKey)}>Not now</button></span>}{latest.reply.focus!=='none'&&<button onClick={()=>{p.onFocus(latest.reply.focus as 'sun'|'earth'|'skyline');p.onClose()}}>Show me {latest.reply.focus==='skyline'?'the skyline':'the '+latest.reply.focus}</button>}</div>}
  {!active&&latest&&!sameCompanionScene(latest,p.context)&&<button className="luna-recheck" disabled={s.busy||s.configured!==true} onClick={()=>send('Recheck this site with our current mission assumptions and scene date.')}>Recheck this mission</button>}
  {p.context.basis!=='mission'&&<details className="luna-assumptions"><summary>Mission used in these answers</summary><p>{p.context.constraints.missionDays} days · {p.context.constraints.power?.loadW??'—'} W demand · {p.context.constraints.power?.panelAreaM2??'—'} m² panel · {p.context.constraints.power?.capacityWh??'—'} Wh battery · {p.context.constraints.power?.reservePct??'—'}% reserve. This is an illustrative mission at the landing point; walking changes the view.</p><button onClick={p.onGuide}>Open the worked decision guide <ArrowRight size={12}/></button>{s.mission&&<button onClick={()=>s.setMission(null)}>Restore the example mission</button>}</details>}
  <details className="luna-question-bank" open={s.history.length===0?true:undefined}><summary>Suggested questions</summary><div className="luna-suggestions">{questions.slice(0,3).map(q=><button key={q} disabled={s.busy||s.configured!==true} onClick={()=>send(q)}>{q}</button>)}</div></details>
  </div>
  <form onSubmit={e=>{e.preventDefault();send(input)}}><label htmlFor="luna-question">Your question</label><div className="luna-compose"><textarea ref={form} id="luna-question" rows={1} maxLength={1000} value={input} placeholder="Ask in any language…" onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send(input)}}}/>{s.busy?<button type="button" aria-label="Stop Chader Buri’s request" onClick={()=>{s.cancel();form.current?.focus()}}><Square size={16}/></button>:<button type="submit" aria-label="Send question to Chader Buri" disabled={!input.trim()||s.configured!==true}><Send size={17}/></button>}</div><details className="luna-dictate"><summary>Use your microphone</summary><GuideMicrophone disabled={s.busy||s.configured!==true} onText={setInput}/></details></form>
  <footer><details><summary>{s.storageAvailable?'Saved in this browser':'Chat stays open; browser saving is unavailable'}</summary><p>Messages stay on this device until you clear them. Sending a question shares your question, recent conversation and calculated context with Google Gemini. AI answers can be mistaken.</p></details>{(s.history.length>0||briefs.length>0)&&<button onClick={()=>{s.clear();clearBriefs();form.current?.focus()}}>Clear conversation</button>}</footer>
 </section>
}

/** Restored conversation text has no actions and never claims to describe the current view. */
function SavedTurn({entry,currentKey}:{entry:ConversationEntry;currentKey:string}){
 const previous=entry.restored||entry.contextStamp!==currentKey
 return <div className="luna-turn"><p className="luna-question"><small>You</small>{entry.question}</p><p className="luna-answer"><small>Chader Buri{entry.source==='calculated'?' · calculated answer':''}</small>{entry.answer}</p>{previous&&<small className="luna-stale">Previous conditions · {entry.siteName}{entry.sceneUTC?` · ${entry.sceneUTC.slice(0,16).replace('T',' ')} UTC`:''}. Ask again for the current view.</small>}</div>
}

/** An authored explanation: cause, the evidence she highlighted, and a next step with offers (retired once the mission changes). */
function Brief({b,live,onAction}:{b:LoggedBrief;live:boolean;onAction:(a:GuideAction)=>void}){
 return <div className="luna-turn luna-brief"><p className="luna-question"><small>You</small>{b.question}</p><div className="luna-answer"><small>Chader Buri · calculated explanation</small><p>{b.answer}</p>{b.shown&&<p className="luna-shown">{b.shown}</p>}{b.next&&<p className="luna-next">{b.next}</p>}
  {b.offers.length>0&&(live?<div className="luna-brief-offers">{b.offers.map(o=><button key={o.label} onClick={()=>onAction(o.action)}>{o.label}</button>)}</div>:<small className="luna-stale">Your mission has changed since this explanation, so its offers are retired.</small>)}</div></div>
}
