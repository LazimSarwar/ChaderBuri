import { useEffect,useRef,useState } from 'react'
import type { Dispatch,SetStateAction } from 'react'
import type { Equipment,JournalPhoto } from './lib/expedition'
import type { FieldReading } from './lib/fieldwork'
import { loadArchive,writeArchive,validateArchive,type ExpeditionRecord } from './lib/expeditionArchive'
type Setter<T>=Dispatch<SetStateAction<T>>
export function useExpeditionArchive(p:{slugs:string[];photos:JournalPhoto[];flags:FieldReading[];inspections:Record<string,FieldReading>;records:ExpeditionRecord[];equipment:Record<string,Equipment>;setPhotos:Setter<JournalPhoto[]>;setFlags:Setter<FieldReading[]>;setInspections:Setter<Record<string,FieldReading>>;setRecords:Setter<ExpeditionRecord[]>;setEquipment:Setter<Record<string,Equipment>>}){
 const [status,setStatus]=useState('Opening saved journal...'),[ready,setReady]=useState(false),loaded=useRef(false),catalog=p.slugs.join('|')
 useEffect(()=>{if(!catalog)return;let alive=true
  void loadArchive().then(raw=>{if(!alive)return;const saved=validateArchive(raw,slug=>catalog.split('|').includes(slug));if(saved&&!loaded.current){p.setPhotos(saved.photos.map(({blob,...photo})=>({...photo,imageUrl:URL.createObjectURL(blob)})));p.setFlags(saved.flags);p.setInspections(saved.inspections);p.setRecords(saved.records);p.setEquipment(saved.equipment)}loaded.current=true;setReady(true);setStatus('Saved on this device')}).catch(()=>{if(alive){loaded.current=true;setReady(true);setStatus('Session only - storage unavailable')}})
  return()=>{alive=false}
 },[catalog])
 useEffect(()=>{if(!ready)return;let alive=true;setStatus('Saving journal...')
  const timer=setTimeout(()=>{void Promise.all(p.photos.map(async({imageUrl,...photo})=>({...photo,blob:await (await fetch(imageUrl)).blob()}))).then(async photos=>{if(!alive)return;await writeArchive({version:1,photos,flags:p.flags,inspections:p.inspections,records:p.records,equipment:p.equipment});if(alive)setStatus('Saved on this device')}).catch(()=>{if(alive)setStatus('Session only - journal could not be saved; download your photos')})},350)
  return()=>{alive=false;clearTimeout(timer)}
 },[ready,p.photos,p.flags,p.inspections,p.records,p.equipment])
 return {ready,status}
}
