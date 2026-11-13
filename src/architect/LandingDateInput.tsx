import { useEffect,useId,useState } from 'react'
import { landingRow } from './landingDate'
export function LandingDateInput({row,startMs,hours,days,onPick}:{row:number;startMs:number;hours:number;days:number;onPick:(row:number)=>void}){
 const iso=(r:number)=>new Date(startMs+r*3600000).toISOString().slice(0,16)
 const [draft,setDraft]=useState(()=>iso(row)),id=useId()
 useEffect(()=>setDraft(iso(row)),[row,startMs])
 const invalid=landingRow(draft,startMs,hours,days)===null
 const commit=(value:string)=>{setDraft(value);const next=landingRow(value,startMs,hours,days);if(next!==null&&next!==row)onPick(next)}
 return <div className="landing-date-input"><label htmlFor={id}>Landing (UTC)</label><input id={id} className="comparison-input" type="datetime-local" step="3600" min={iso(0)} max={iso(hours-days*24)} value={draft} aria-invalid={invalid} aria-describedby={invalid?id+'-error':undefined} onInput={e=>commit(e.currentTarget.value)} onChange={e=>commit(e.currentTarget.value)}/>{invalid&&<p id={id+'-error'} role="status">Choose a whole UTC hour with enough cached data for this mission. Last applied landing: {iso(row).replace('T',' ')} UTC.</p>}</div>
}
