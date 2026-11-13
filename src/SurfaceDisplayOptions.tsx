import type { SurfacePreferences } from './lib/surfacePolish'
import { useReducedMotion } from './useReducedMotion'
export function SurfaceDisplayOptions({preferences:p,onChange}:{preferences:SurfacePreferences;onChange:(value:SurfacePreferences)=>void}){
 const reduced=useReducedMotion()
 return <><h3>Your exploration view</h3><p>Keep the view comfortable and the instruments close at hand.</p>
  <label className="surface-option"><input type="checkbox" checked={p.quietHud} onChange={e=>onChange({...p,quietHud:e.target.checked})}/><span>Quiet field controls<small>Collapse controls after a few seconds of free exploration. Open Field controls whenever needed.</small></span></label>
  <label className="surface-option"><input type="checkbox" checked={p.astronautView} onChange={e=>onChange({...p,astronautView:e.target.checked})}/><span>Astronaut view<small>Subtle visor edges and visible boots when you look down.</small></span></label>
  <label className="surface-option"><input type="checkbox" checked={p.motion} disabled={reduced} onChange={e=>onChange({...p,motion:e.target.checked})}/><span>Gentle movement feedback<small>{reduced?'Your reduced-motion setting disables camera bob and animated deployment.':'Optional 8 mm camera bob while walking. Off during jumps and at rest.'}</small></span></label>
  <label className="surface-option"><input type="checkbox" checked={p.visor} onChange={e=>onChange({...p,visor:e.target.checked})}/><span>Mission Visor<small>Helmet display with power, Earth link, environment and mission clock, plus markers on the Sun, Earth and lander. Press V anytime.</small></span></label>
  <label className="surface-option"><input type="checkbox" checked={p.watchLandings} onChange={e=>onChange({...p,watchLandings:e.target.checked})}/><span>Watch landings<small>A time-compressed landing simulation plays when you arrive at a new site. Skip anytime; off with reduced motion.</small></span></label>
  <label className="surface-option"><input type="checkbox" checked={p.suitAudio} onChange={e=>onChange({...p,suitAudio:e.target.checked})}/><span>Suit sounds<small>Your breathing and bootsteps felt through the suit. Space is silent; this is what you would hear inside the helmet.</small></span></label>
  <label className="surface-option"><input type="checkbox" checked={p.buriReactions} onChange={e=>onChange({...p,buriReactions:e.target.checked})}/><span>Chader Buri comments<small>She notices your first jump, your bootprints, Earth rising over the ridge and sunset, then stays quiet.</small></span></label>
  <p className="visit-field-scope">Saved on this device. These are visual preferences; mission time, terrain, power and visibility calculations stay fixed.</p>
 </>
}
