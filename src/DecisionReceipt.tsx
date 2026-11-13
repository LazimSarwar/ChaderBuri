import { useMemo,useState,useEffect } from 'react'
import type { DecisionGuide } from './lib/explorationDecision'
import type { SensitiveDateContext } from './lib/sensitiveDate'
import { buildDecisionReceipt,journeyURL,storyScenarios } from './lib/decisionStory'
import type { PredictionIndex } from './lib/predictionIndex'
import type { Site } from './data'
import { PrintableBrief } from './architect/PrintableBrief'
import type { Scn } from './architect/comparison'

export function DecisionReceipt({guide,context,index,site,onGuide,onCompare}:{guide:DecisionGuide;context:SensitiveDateContext;index:PredictionIndex;site:Site;onGuide:(g:DecisionGuide)=>void;onCompare:(scenarios:Scn[],note:string)=>void}){
 const [print,setPrint]=useState(false),[link,setLink]=useState(''),[copied,setCopied]=useState(false),[download,setDownload]=useState('')
 const inputs=guide.story?JSON.stringify(storyScenarios(guide.story)):''
 const evidence=useMemo(()=>{if(!guide.story)return null;try{return buildDecisionReceipt(index,{...guide,story:{...guide.story,reason:''}},context,site)}catch{return null}},[index,inputs,guide.originRow,guide.source?.datasetId,guide.source?.model,context.series,context.products,context.sun,context.earth,context.horizon,site])
 const receipt=useMemo(()=>evidence&&guide.story?{...evidence,reason:guide.story.reason,journey:{slug:site.slug,guide},brief:{...evidence.brief,decision:{...evidence.brief.decision,reason:guide.story.reason}}}:null,[evidence,guide,site.slug])
 useEffect(()=>{setLink('');setCopied(false)},[guide])
 useEffect(()=>{if(!receipt)return;const url=URL.createObjectURL(new Blob([JSON.stringify(receipt,null,2)],{type:'application/json'}));setDownload(url);return()=>URL.revokeObjectURL(url)},[receipt])
 if(!guide.story)return null
 return <details className="decision-receipt"><summary>Your decision story · {storyScenarios(guide.story).length} stages</summary>
  <p>Original mission → {guide.story.repair?'hardware repair':'hardware unchanged'}{guide.story.later?' → later landing date':''}. Inputs stay with the evidence when you leave this view.</p>
  <label>Why this choice?<textarea aria-label="Decision story reason" maxLength={280} rows={2} value={guide.story.reason} placeholder="Explain the trade-off you would accept." onChange={e=>onGuide({...guide,story:{...guide.story!,reason:e.target.value}})}/></label>
  {receipt?<><button className="tool-button" onClick={()=>setPrint(true)}>Preview decision receipt</button><a className="tool-button" href={download||undefined} download={`chader-buri-${site.slug}-decision.json`}>Download decision JSON</a><button className="tool-button" onClick={()=>onCompare(storyScenarios(guide.story!),`Decision story: ${receipt.stages.join(' → ')}. Visitor reason: ${guide.story!.reason||'Not entered'}. Each scenario retains its own requirements and diagnostics.`)}>Compare full decision story</button><button className="tool-button" onClick={async()=>{const url=journeyURL(window.location.href,site.slug,guide,index);setLink(url);try{await navigator.clipboard.writeText(url);setCopied(true)}catch{setCopied(false)}}}>Share this decision</button>{link&&<><p role="status">{copied?'Journey link copied.':'Copy this journey link:'}</p><input aria-label="Decision journey link" readOnly value={link} onFocus={e=>e.currentTarget.select()}/></>}{print&&<PrintableBrief brief={receipt.brief} onClose={()=>setPrint(false)}/>}</>:<p>Receipt unavailable: complete, valid mission inputs are required.</p>}
  <p className="visit-field-scope">The JSON includes assumptions, results, source/product fingerprints and your reason. Links recalculate with the deployed snapshot; preserve the JSON and original products for older-model reproduction.</p>
 </details>
}
