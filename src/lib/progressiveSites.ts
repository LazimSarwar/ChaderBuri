import type { Site } from '../data.ts'
import { validateSiteBundle, type SiteBundle } from './siteProducts.ts'
import type { PredictionIndex } from './predictionIndex.ts'
export type SiteLoadState='queued'|'loading'|'ready'|'error'
type Entry={site:Site;promise:Promise<SiteBundle>;resolve:(b:SiteBundle)=>void;reject:(e:unknown)=>void;status:SiteLoadState}
/** Selected-site-first queue. Failed/incompatible sites never enter a partial planner. */
export class ProgressiveSites {
  private entries=new Map<string,Entry>();private queue:Entry[]=[];private running=0;private stopped=false
  private sites:Site[];private load:(site:Site)=>Promise<SiteBundle>;private index:PredictionIndex
  private ready:(bundle:SiteBundle)=>void;private status:(slug:string,status:SiteLoadState,error?:string)=>void;private concurrency:number
  constructor(sites:Site[],load:(site:Site)=>Promise<SiteBundle>,index:PredictionIndex,
    ready:(bundle:SiteBundle)=>void,status:(slug:string,status:SiteLoadState,error?:string)=>void,concurrency=2){
    this.sites=sites;this.load=load;this.index=index;this.ready=ready;this.status=status;this.concurrency=concurrency
  }
  request(slug:string):Promise<SiteBundle>{
    if(this.stopped)return Promise.reject(new DOMException('Loading cancelled','AbortError'))
    let entry=this.entries.get(slug)
    if(entry?.status==='error'){this.entries.delete(slug);entry=undefined}
    if(!entry){
      const site=this.sites.find(s=>s.slug===slug)
      if(!site)return Promise.reject(new Error('Unknown mission site'))
      let resolve!:Entry['resolve'],reject!:Entry['reject']
      const promise=new Promise<SiteBundle>((yes,no)=>{resolve=yes;reject=no});void promise.catch(()=>{})
      entry={site,promise,resolve,reject,status:'queued'};this.entries.set(slug,entry);this.queue.push(entry)
    }else if(entry.status==='queued'){this.queue=this.queue.filter(e=>e!==entry);this.queue.unshift(entry)}
    this.pump();return entry.promise
  }
  prefetch(){for(const site of this.sites){if(!this.entries.has(site.slug)){
    // Queue all without starting an unbounded burst.
    let resolve!:Entry['resolve'],reject!:Entry['reject'];const promise=new Promise<SiteBundle>((yes,no)=>{resolve=yes;reject=no});void promise.catch(()=>{})
    const entry:Entry={site,promise,resolve,reject,status:'queued'};this.entries.set(site.slug,entry);this.queue.push(entry)
  }}this.pump()}
  stop(){this.stopped=true;for(const e of this.queue)e.reject(new DOMException('Loading cancelled','AbortError'));this.queue=[]}
  private pump(){
    while(!this.stopped&&this.running<this.concurrency&&this.queue.length){
      const entry=this.queue.shift()!;this.running++;entry.status='loading';this.status(entry.site.slug,'loading')
      void this.load(entry.site).then(bundle=>{
        validateSiteBundle(bundle)
        const c=this.index.coverage
        if(bundle.eph.sun.start!==c.start||bundle.eph.sun.stop!==c.stop||bundle.eph.sun.rows.length!==c.samples)throw new Error('Site differs from the indexed UTC grid')
        if(this.stopped)throw new DOMException('Loading cancelled','AbortError')
        entry.status='ready';this.ready(bundle);this.status(entry.site.slug,'ready');return bundle
      }).then(bundle=>{this.running--;entry.resolve(bundle);this.pump()},error=>{this.running--;entry.status='error';if(!this.stopped)this.status(entry.site.slug,'error',String(error));entry.reject(error);this.pump()})
    }
  }
}
