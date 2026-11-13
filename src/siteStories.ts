import type { Duty, Horizon, Site } from './data'
import { LOLA_SOURCE, siteSeparation } from './lib/visit.ts'

export type SiteStory = { tag:string; facts:string[]; look:{dir:number;label:string;text:string}[]; sources:{label:string;url:string}[] }
const CONTEXT:Record<string,string>={
  'shackleton-rim':'Compare the skyline of a crater-rim site with the nearby floor.',
  'shackleton-floor':'Explore a crater-floor site and the terrain that surrounds its observer.',
  'malapert-massif':'Compare illumination and Earth visibility at this selected massif coordinate.',
  'polar-high-point':'Examine how a high-elevation coordinate changes the local skyline.',
  'im-1-odysseus-site':'Explore the catalogued IM-1 landing region; mission history is linked separately below.',
  'de-gerlache-rim':'Explore the trade between illumination and Earth visibility at this rim coordinate.',
  'haworth-rim':'Inspect the distinction between access to sunlight and access to Earth.',
  'faustini-rim':'Compare a rim skyline with the mission’s selected date and hardware.',
  'nobile-rim':'Explore this Nobile-region coordinate using the current cached predictions.',
  'connecting-ridge':'Inspect the measured horizon at this selected ridge coordinate.',
  'connecting-ridge-extension':'Compare this coordinate with the nearby Connecting Ridge site.',
  'amundsen-rim':'Explore how a local rim horizon changes access to the Sun and Earth.',
  'leibnitz-beta-plateau':'Inspect the plateau skyline and its cached Earth-visibility intervals.',
  'de-gerlache-kocher-massif':'Compare illumination and Earth visibility at this massif coordinate.',
}
/** All numbers and named bearings are derived from the active products, never editorial constants. */
export function buildSiteStory(site:Site,duty:Duty,horizon:Horizon,sites:Site[]):SiteStory {
  const high=horizon.profile.indexOf(Math.max(...horizon.profile)), low=horizon.profile.indexOf(Math.min(...horizon.profile))
  const nearest=sites.filter(s=>s.slug!==site.slug).map(s=>({site:s,...siteSeparation(site,s)})).sort((a,b)=>a.distanceM-b.distanceM)[0]
  return {tag:CONTEXT[site.slug]??'Explore the current terrain and visibility products at this coordinate.',facts:[
    `Over ${duty.start} to ${duty.end} UTC, the Sun’s centre clears the cached terrain mask for ${duty.litPct.toFixed(1)}% of complete hourly intervals.`,
    `Earth’s centre clears the mask for ${duty.linkPct.toFixed(1)}% of those intervals. This does not establish a radio service, antenna pointing or station access.`,
    `The longest sampled terrain darkness is ${duty.longestDarkH.toLocaleString()} h; the longest Earth-centre visibility gap is ${duty.longestNoLinkH.toLocaleString()} h. These are bounded by the cache, not claims of permanent conditions.`,
    `The analysis observer is ${horizon.observerHeightAboveGroundM??0} m above DEM ground, at ${horizon.siteHeightM.toFixed(0)} m above the reference sphere. The exploration camera is a separate virtual viewpoint about 3 m above ground.`,
  ],look:[
    {dir:high,label:'Highest measured skyline',text:`The cached horizon reaches ${horizon.profile[high].toFixed(2)}° at bearing ${high}°. This is a direction, not a surveyed ridge position.`},
    {dir:low,label:'Lowest measured skyline',text:`The cached horizon reaches ${horizon.profile[low].toFixed(2)}° at bearing ${low}°. Visibility still depends on the selected epoch.`},
    ...(nearest?[{dir:nearest.bearing,label:`Bearing to ${nearest.site.name}`,text:`${(nearest.distanceM/1000).toFixed(2)} km along the reference lunar sphere. No traverse safety or surface slope is inferred.`}]:[]),
  ],sources:[{label:'Active terrain horizon',url:`/data/horizons/${site.slug}.json`},{label:'Active duty-cycle product',url:`/data/dutycycle/${site.slug}.json`},{label:'LOLA archive',url:LOLA_SOURCE}]}
}
