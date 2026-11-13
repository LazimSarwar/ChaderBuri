import { localFrame,sitePosition,type Site } from '../data.ts'
import { MOON_RADIUS_M } from './visit.ts'

export const EXPLORATION_RADIUS_M=250
export type ViewpointOffset={eastM:number;northM:number}
export type VisitStep={id:number;forward:number;right:number;reset?:boolean;walk?:boolean;jump?:boolean;crouch?:boolean}
/** Exponential map on the reference lunar sphere, stable at the poles. */
export function viewpointCoordinates(site:Pick<Site,'lat'|'lonEast'>,offset:ViewpointOffset){
 const up=sitePosition(site.lat,site.lonEast),frame=localFrame(up),distance=Math.hypot(offset.eastM,offset.northM),arc=distance/MOON_RADIUS_M
 const v=up.map((u,i)=>u*Math.cos(arc)+(distance?(frame.east[i]*offset.eastM+frame.north[i]*offset.northM)*Math.sin(arc)/distance:0))
 return {lat:Math.asin(Math.max(-1,Math.min(1,v[1])))*180/Math.PI,lonEast:Math.atan2(-v[2],v[0])*180/Math.PI}
}
/** Camera navigation only. The planner still evaluates the selected coordinate. */
export function stepViewpoint(offset:ViewpointOffset,heading:number,forward:number,right:number,metres:number){
 if(![offset.eastM,offset.northM,heading,forward,right,metres].every(Number.isFinite)||metres<0)throw new Error('Invalid viewpoint step')
 const length=Math.hypot(forward,right)
 if(!length)return {...offset,limited:false}
 const a=heading*Math.PI/180,f=forward/length,r=right/length
 let eastM=offset.eastM+metres*(Math.sin(a)*f+Math.cos(a)*r),northM=offset.northM+metres*(Math.cos(a)*f-Math.sin(a)*r)
 const distance=Math.hypot(eastM,northM),limited=distance>EXPLORATION_RADIUS_M
 if(limited){eastM*=EXPLORATION_RADIUS_M/distance;northM*=EXPLORATION_RADIUS_M/distance}
 return {eastM,northM,limited}
}
export function checkedViewpointStep(site:Pick<Site,'lat'|'lonEast'>,offset:ViewpointOffset,heading:number,forward:number,right:number,metres:number,heightAt:(lat:number,lon:number)=>number|null){
 const next=stepViewpoint(offset,heading,forward,right,metres),geo=viewpointCoordinates(site,next),height=heightAt(geo.lat,geo.lonEast)
 if(height===null||!Number.isFinite(height))return {...offset,blocked:true,reason:'terrain' as const}
 return {eastM:next.eastM,northM:next.northM,blocked:next.limited,reason:next.limited?'boundary' as const:null}
}
export function lookTarget(pose:{heading:number;pitch:number},target:{az:number;el:number}){
 const horizontal=((target.az-pose.heading+540)%360+360)%360-180,vertical=target.el-pose.pitch,r=Math.PI/180
 const angle=Math.acos(Math.max(-1,Math.min(1,Math.sin(pose.pitch*r)*Math.sin(target.el*r)+Math.cos(pose.pitch*r)*Math.cos(target.el*r)*Math.cos(horizontal*r))))/r
 return {horizontal,vertical,angle,centred:angle<=6}
}
/** A bounded event-centred camera-clock demonstration, never extrapolated. */
export function eventJourney(row:number,hours:number|null,lastRow:number){
 if(hours===null||![row,hours,lastRow].every(Number.isFinite)||row<0||hours<=0||row+hours>lastRow)return null
 const eventRow=row+hours,startRow=Math.max(0,eventRow-1),endRow=Math.min(lastRow,eventRow+1)
 return endRow-startRow>.001?{startRow,endRow,eventRow}:null
}
