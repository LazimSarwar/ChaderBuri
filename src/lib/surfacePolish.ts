// suitAudio and buriReactions make the visit feel inhabited; both are presentation only.
export type SurfacePreferences={quietHud:boolean;astronautView:boolean;motion:boolean;suitAudio:boolean;buriReactions:boolean;visor:boolean;visorPower:boolean;visorLink:boolean;visorEnvironment:boolean;visorClock:boolean;watchLandings:boolean
 /** Field interface (restrained HUD) instead of the classic instruments; its comfort options. */
 fieldMode:boolean;fieldGloves:boolean;helmetFrame:boolean;largeText:boolean;captions:boolean;readAloud:boolean;fieldVisor:boolean
 /** Strength of presentation motion (head sway, dust, transitions) from 0 to 1; reduced motion forces 0. */
 motionScale:number
 /** Rendering quality; 'auto' lets the scene adapt to the device. Presentation only. */
 quality:RenderQuality
 /** An illustrative helmet lamp on the surface: display light only, never solar generation. */
 suitLamp:boolean}
export type RenderQuality='auto'|'high'|'balanced'|'low'
export const RENDER_QUALITIES:readonly RenderQuality[]=['auto','high','balanced','low']
export const DEFAULT_SURFACE_PREFERENCES:SurfacePreferences={quietHud:true,astronautView:true,motion:false,suitAudio:true,buriReactions:true,visor:true,visorPower:true,visorLink:true,visorEnvironment:true,visorClock:true,watchLandings:true,fieldMode:true,fieldGloves:true,helmetFrame:true,largeText:false,captions:true,readAloud:false,fieldVisor:false,motionScale:1,quality:'auto',suitLamp:false}
export function parseSurfacePreferences(raw:unknown):SurfacePreferences{
 if(!raw||typeof raw!=='object')return {...DEFAULT_SURFACE_PREFERENCES}
 const value=raw as Record<string,unknown>
 const pick=(k:string,v:unknown)=>{
  const x=value[k]
  if(typeof v==='boolean')return typeof x==='boolean'?x:v
  if(typeof v==='number')return typeof x==='number'&&Number.isFinite(x)?Math.max(0,Math.min(1,x)):v
  return typeof x==='string'&&(RENDER_QUALITIES as readonly string[]).includes(x)?x:v
 }
 return Object.fromEntries(Object.entries(DEFAULT_SURFACE_PREFERENCES).map(([k,v])=>[k,pick(k,v)])) as SurfacePreferences
}
/** The motion strength the scene receives: the visitor's setting, or none with reduced motion. */
export const effectiveMotionScale=(prefs:Pick<SurfacePreferences,'motionScale'>,reduced:boolean)=>reduced?0:Math.max(0,Math.min(1,Number.isFinite(prefs.motionScale)?prefs.motionScale:1))
export function deploymentStep(current:number,enabled:boolean,seconds:number,reduced:boolean){
 if(reduced)return enabled?1:0
 const step=Math.max(0,Math.min(.05,Number.isFinite(seconds)?seconds:0))/ .55
 return Math.max(0,Math.min(1,current+(enabled?step:-step)))
}
export function easeDeployment(progress:number){const t=Math.max(0,Math.min(1,progress));return t*t*(3-2*t)}
export function presentationAngle(current:number,target:number,seconds:number,snap:boolean){
 if(snap)return target
 const delta=((target-current+540)%360)-180
 return current+delta*(1-Math.exp(-Math.min(.05,Math.max(0,seconds))*18))
}
export function presentationBob(distanceM:number,walking:boolean,airborne:boolean,enabled:boolean,reduced:boolean){
 if(!enabled||reduced||!walking||airborne||!Number.isFinite(distanceM))return 0
 return Math.sin(distanceM*Math.PI*2/.9)*.008
}
export type SurfaceFocus={object:'lander'|'payload'|'panel'|'antenna';payloadIndex?:number;label:string;distanceM:number}
