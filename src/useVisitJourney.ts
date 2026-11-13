import { useEffect,useRef,useState } from 'react'
export function useVisitJourney(row:number,onTime:(row:number)=>void){
 const [journey,setJourney]=useState<{startRow:number;endRow:number;label:string;originRow:number}|null>(null)
 const [progress,setProgress]=useState(0),[origin,setOrigin]=useState<number|null>(null)
 const callback=useRef(onTime);callback.current=onTime
 const expected=useRef<number|null>(null)
 useEffect(()=>{
  if(journey&&expected.current!==null&&Math.abs(row-expected.current)>.01)setJourney(null)
 },[row,journey])
 useEffect(()=>{
  if(!journey)return
  let frame=0,last=0,start:number|null=null
  const tick=(time:number)=>{
   start??=time
   const fraction=Math.min(1,(time-start)/12000)
   if(time-last>=200||fraction===1){last=time;const next=journey.startRow+(journey.endRow-journey.startRow)*fraction;expected.current=next;callback.current(next);setProgress(fraction)}
   if(fraction<1)frame=requestAnimationFrame(tick);else setJourney(null)
  }
  frame=requestAnimationFrame(tick)
  const visibility=()=>{if(document.hidden)setJourney(null)}
  document.addEventListener('visibilitychange',visibility)
  return()=>{cancelAnimationFrame(frame);document.removeEventListener('visibilitychange',visibility)}
 },[journey])
 const start=(startRow:number,endRow:number,label:string)=>{
  if(![startRow,endRow].every(Number.isFinite)||endRow<=startRow)return
  setOrigin(row);expected.current=startRow;callback.current(startRow);setProgress(0)
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){expected.current=endRow;callback.current(endRow);setJourney(null)}
  else setJourney({startRow,endRow,label,originRow:row})
 }
 return {journey,progress,start,stop:()=>setJourney(null),keep:()=>{setJourney(null);setOrigin(null)},restore:()=>{setJourney(null);if(origin!==null){expected.current=origin;callback.current(origin)}setOrigin(null)},canRestore:origin!==null}
}
