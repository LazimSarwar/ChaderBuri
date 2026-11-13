import type { LandingSample } from '../architect/dispersion.ts'
import type { VisitPose } from './visit.ts'
/** Local tangent bearing marker only, not terrain occlusion or a safe route. */
export function sampleBearing(sample:LandingSample,view:VisitPose,nominalGroundM:number){
 const east=sample.eastM-(view.eastM??0),north=sample.northM-(view.northM??0),distanceM=Math.hypot(east,north)
 if(distanceM<1)return null
 const up=sample.siteHeightM-(view.groundM??nominalGroundM)-(view.eyeHeightM??1.7)-(view.heightAboveGroundM??0)-distanceM*distanceM/(2*1737400)
 return {distanceM,az:(Math.atan2(east,north)*180/Math.PI+360)%360,el:Math.atan2(up,distanceM)*180/Math.PI}
}
