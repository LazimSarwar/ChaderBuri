// Constant lunar surface gravity, rounded to NASA's Moon Fact Sheet value.
// https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html
export const LUNAR_GRAVITY_MPS2=1.62
// Chosen exploration controls, not measured suit/astronaut performance.
export const ASTRONAUT_EYE_HEIGHT_M=1.7
export const CROUCH_EYE_HEIGHT_M=1.1
export const WALK_SPEED_MPS=1.4
export const JUMP_SPEED_MPS=2
export const MAX_MOTION_DELTA_S=.05
export type AstronautMotion={feetM:number|null;verticalMps:number;eastMps:number;northMps:number;airborne:boolean}
export const standingAstronaut=():AstronautMotion=>({feetM:null,verticalMps:0,eastMps:0,northMps:0,airborne:false})
export function motionDelta(seconds:number){
 if(!Number.isFinite(seconds)||seconds<0)throw new Error('Invalid movement elapsed time')
 return Math.min(seconds,MAX_MOTION_DELTA_S)
}
export function walkingVelocity(heading:number,forward:number,right:number){
 if(![heading,forward,right].every(Number.isFinite))throw new Error('Invalid walking input')
 const length=Math.hypot(forward,right),a=heading*Math.PI/180
 if(!length)return {eastMps:0,northMps:0}
 return {eastMps:WALK_SPEED_MPS*(Math.sin(a)*forward+Math.cos(a)*right)/length,northMps:WALK_SPEED_MPS*(Math.cos(a)*forward-Math.sin(a)*right)/length}
}
export function launchAstronaut(motion:AstronautMotion,groundM:number|null,velocity:{eastMps:number;northMps:number}):AstronautMotion{
 if(motion.airborne||groundM===null||!Number.isFinite(groundM)||![velocity.eastMps,velocity.northMps].every(Number.isFinite))return motion
 return {feetM:groundM,verticalMps:JUMP_SPEED_MPS,...velocity,airborne:true}
}
/** Analytic constant-g step with terrain contact; no ground is invented across missing DEMs. */
export function advanceAstronaut(motion:AstronautMotion,groundM:number|null,seconds:number):AstronautMotion{
 const dt=motionDelta(seconds)
 if(groundM===null||!Number.isFinite(groundM))return motion
 if(!motion.airborne||motion.feetM===null)return {...standingAstronaut(),feetM:groundM}
 if(dt===0)return motion
 const feetM=motion.feetM+motion.verticalMps*dt-.5*LUNAR_GRAVITY_MPS2*dt*dt
 if(feetM<=groundM)return {...standingAstronaut(),feetM:groundM}
 return {...motion,feetM,verticalMps:motion.verticalMps-LUNAR_GRAVITY_MPS2*dt}
}
