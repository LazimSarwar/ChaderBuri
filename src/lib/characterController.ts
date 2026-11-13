// Chader Buri's visible state, driven by conversation events. Pure, so it can be tested and
// later drive a rigged model (idle / listening / talking / pointing clips) without changes.
export type CharacterPose = 'idle' | 'listening' | 'talking' | 'pointing'
export type CharacterTarget = 'sun' | 'earth' | 'skyline'
export type CharacterState = { pose: CharacterPose; target: CharacterTarget | null; bubble: string | null }
export type CharacterInputs = {
  /** Waiting for her reply. */
  busy: boolean
  /** Her latest reply and when it arrived (ms). */
  reply: { message: string; focus: CharacterTarget | 'none'; at: number } | null
  /** A tour line or comment currently shown in text. */
  line: string | null
  now: number
}
export const TALK_MS = 9000
export const POINT_MS = 14000
const MAX_BUBBLE = 150

export function shorten(text: string, max = MAX_BUBBLE) {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1), stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return (stop > max * .5 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '…')
}

export function characterState(i: CharacterInputs): CharacterState {
  if (i.busy) return { pose: 'listening', target: null, bubble: null }
  const age = i.reply ? i.now - i.reply.at : Infinity
  if (i.reply && i.reply.focus !== 'none' && age < POINT_MS) return { pose: 'pointing', target: i.reply.focus, bubble: age < TALK_MS ? shorten(i.reply.message) : null }
  if (i.reply && age < TALK_MS) return { pose: 'talking', target: null, bubble: shorten(i.reply.message) }
  if (i.line) return { pose: 'talking', target: null, bubble: shorten(i.line) }
  return { pose: 'idle', target: null, bubble: null }
}

// ---- Presence: how her projection is staged in the scene (pure; BuriFigure applies it). ----

/** Sky directions plus the visible hardware she can point at. */
export type PointTarget = CharacterTarget | 'lander' | 'antenna' | 'panel'
export type Vec3 = { x: number; y: number; z: number }

/** An explicit `pointAt` wins (null = not pointing); otherwise she points while her state says so. */
export function pointingTarget(state: CharacterState, pointAt?: PointTarget | null): PointTarget | null {
  if (pointAt !== undefined) return pointAt
  return state.pose === 'pointing' ? state.target : null
}

/** Is she speaking: an explicit flag wins, otherwise while a reply or line is shown. */
export const isSpeaking = (state: CharacterState, speaking?: boolean) => speaking ?? (state.pose === 'talking' || (state.pose === 'pointing' && !!state.bubble))
/** Attentive while the visitor is near or asking, or while she waits for her reply. */
export const isAttentive = (state: CharacterState, attentive?: boolean) => !!attentive || state.pose === 'listening'

/** Unit direction for a compass azimuth / elevation (degrees) in the surface frame: x east, y up, z south. */
export function skyDirection(azDeg: number, elDeg: number): Vec3 {
  const az = azDeg * Math.PI / 180, el = elDeg * Math.PI / 180
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) }
}

/** Bearing (degrees from north, clockwise) of a horizontal offset in the surface frame. */
export const frameBearing = (x: number, z: number) => ((Math.atan2(x, -z) * 180 / Math.PI) % 360 + 360) % 360

/**
 * The small turn of her projection toward what she attends to, as a yaw offset (degrees) from facing the visitor.
 * She always stays mostly facing the visitor (a flat projection seen edge-on would vanish): the offset is a fraction
 * of the angle between the visitor and the target, clamped to `maxDeg`.
 */
export function attentionYaw(visitorBearing: number, targetBearing: number | null, attentive: boolean, maxDeg = 18, idleDeg = 9) {
  if (targetBearing === null) return attentive ? 0 : idleDeg
  const delta = ((targetBearing - visitorBearing + 540) % 360) - 180
  return Math.max(-maxDeg, Math.min(maxDeg, delta * .5))
}

/**
 * A guide arc from `start` to `end`: a quadratic Bezier lifted by `liftM` at its middle, `segments` + 1 points,
 * flattened [x, y, z, ...]. For a sky target the end is a far point along the direction and the lift is small.
 */
export function guideArc(start: Vec3, end: Vec3, liftM: number, segments = 32): number[] {
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 + liftM, z: (start.z + end.z) / 2 }
  const out: number[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t
    out.push(a * start.x + b * mid.x + c * end.x, a * start.y + b * mid.y + c * end.y, a * start.z + b * mid.z + c * end.z)
  }
  return out
}

/** Materialise / dematerialise progress: moves `current` toward `target` (0 or 1) at the given durations. */
export function appearStep(current: number, target: 0 | 1, dtS: number, reduced: boolean, inS = 1.1, outS = .7) {
  if (reduced) return target
  const rate = target > current ? 1 / inS : 1 / outS
  const next = current + Math.sign(target - current) * Math.max(0, dtS) * rate
  return target > current ? Math.min(target, next) : Math.max(target, next)
}

/** Speaking glow cadence in [0, 1]: an uneven, speech-like pulse; constant under reduced motion. */
export function speakingCadence(tS: number, reduced: boolean) {
  if (reduced) return .6
  const a = .5 + .5 * Math.sin(tS * 6.1), b = .5 + .5 * Math.sin(tS * 2.3 + 1.1)
  return Math.min(1, Math.max(0, .35 + .65 * a * (.55 + .45 * b)))
}

/** Gentle idle hover (metres) for drawn frames; zero under reduced motion. */
export const idleHover = (tS: number, reduced: boolean) => reduced ? 0 : Math.sin(tS * 1.35) * .012 + Math.sin(tS * .53 + .7) * .005

// ---- Attention and activity cues (pure; FieldInterface derives the cue, BuriFigure stages it). ----

/** Within this distance (metres) she treats the visitor as addressing her and turns to face them. */
export const BURI_NEAR_M = 3.2
/** How long an activity pointing cue lasts (ms): short, then she only looks toward the target. */
export const CUE_POINT_MS = 7000

/**
 * Her yaw offset (degrees) from facing the visitor. Pointing wins (a partial turn toward the target, so the flat
 * projection never goes edge-on); then the visitor when they ask or stand near; then the selected object or activity
 * target she is attending to; otherwise a slight idle turn.
 */
export function attentionPose(i: { visitorBearing: number; pointBearing: number | null; lookBearing: number | null; attentive: boolean; near: boolean }) {
  if (i.pointBearing !== null) return attentionYaw(i.visitorBearing, i.pointBearing, false)
  if (i.attentive || i.near) return 0
  if (i.lookBearing !== null) return attentionYaw(i.visitorBearing, i.lookBearing, false, 24)
  return attentionYaw(i.visitorBearing, null, false)
}

/** Sky targets are aimed no lower than this (degrees), so a body just under the skyline never sends the arc into the ground. */
export const aimElevation = (elDeg: number, minDeg = 2) => Math.max(minDeg, elDeg)

export type ActivityCueInput = {
  /** Earth objective step while the objective card is showing, else null. */
  objective: 'find' | 'walk' | 'point' | 'done' | null
  /** The running field activity and, for sunlight, its stage. */
  activity: 'earth' | 'sunlight' | 'time' | 'record' | null
  sunlight?: 'deploy' | 'orient' | 'done' | null
  /** The object whose card is open (payloads count as the lander). */
  selection: 'lander' | 'panel' | 'antenna' | 'payload' | null
}
export type ActivityCue = { point: PointTarget | null; look: PointTarget | null; key: string }

/**
 * What the current activity asks her to show: Earth while finding Earth, the antenna while walking to and pointing it,
 * the panel then the Sun while investigating sunlight. `key` changes once per step, so the field points once per step
 * (for CUE_POINT_MS) instead of continuously; `look` is what she keeps facing afterwards (an open card wins).
 */
export function activityCue(i: ActivityCueInput): ActivityCue {
  const sel = i.selection === 'payload' ? 'lander' : i.selection
  let point: PointTarget | null = null, key = 'none'
  if (i.activity === 'sunlight') {
    if (i.sunlight === 'deploy') { point = 'panel'; key = 'sunlight:deploy' }
    else if (i.sunlight === 'orient') { point = 'sun'; key = 'sunlight:orient' }
    else key = 'sunlight:done'
  } else if ((!i.activity || i.activity === 'earth') && i.objective && i.objective !== 'done') {
    point = i.objective === 'find' ? 'earth' : 'antenna'; key = 'objective:' + i.objective
  } else if (i.activity) key = i.activity
  const hardware = (t: PointTarget | null) => t === 'lander' || t === 'antenna' || t === 'panel' ? t : null
  return { point, look: sel ?? hardware(point) ?? (i.activity === 'sunlight' ? 'panel' : null), key }
}
