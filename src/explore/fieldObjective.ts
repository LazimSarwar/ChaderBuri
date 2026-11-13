// The first field activity: "Find Earth, then test the antenna".
// Pure logic (no React): step state, live step text from real values, Chader Buri's lines and storage.
// The antenna is illustrative example equipment; its pointing error comes from equipmentAssessment().
import { EQUIPMENT_POSITIONS } from '../lib/surfaceMission.ts'
import { bearingFromTo, distanceText, formatEta, formatSimUTC, relativeDirectionText, relativeTurn } from './fieldMath.ts'

export const OBJECTIVE_TITLE = 'Find Earth, then test the antenna'
export const OBJECTIVE_STORAGE_KEY = 'chader-buri.field-objective-v1'
/** Facing Earth: heading within this many degrees of Earth's azimuth. */
export const FACE_TOLERANCE_DEG = 10
/** Reaching the antenna: standing within this distance of its spot. */
export const ANTENNA_REACH_M = 1.5
/** Guided walks in the scene end within this distance of their target (SpaceScene's arrival tolerance). */
export const GUIDED_ARRIVAL_M = 1.5
/** So a guided walk to the antenna aims this far past it, and stops about 1 m from it. */
export const ANTENNA_OVERSHOOT_M = 0.5
/** Pointing: the antenna's error from Earth's centre must be at most this, with Earth above the measured skyline. */
export const ALIGN_TOLERANCE_DEG = 5
const MAX_SITES = 40

export type ObjectiveStepId = 'find' | 'walk' | 'point'
export type ObjectiveStage = ObjectiveStepId | 'done'
export type ObjectiveSummary = { sceneUTC: string; completedUTC: string; earthAzDeg: number; earthElDeg: number; skylineElDeg: number; pointingErrorDeg: number }
export type ObjectiveProgress = { found: boolean; reached: boolean; aligned: boolean; free: boolean; collapsed: boolean; summary: ObjectiveSummary | null }
export type ObjectiveStore = Record<string, ObjectiveProgress>
export type ObjectiveInput = {
  heading: number
  earth: { az: number; el: number }
  /** Measured (LOLA) skyline elevation at Earth's azimuth, at the landing point. */
  skylineEl: number
  visitor: { eastM: number; northM: number }
  antenna: { deployed: boolean; pointingErrorDeg: number; earthVisible: boolean }
}
export type ObjectiveStep = { id: ObjectiveStepId; label: string; done: boolean; current: boolean; detail: string }

export const newObjective = (): ObjectiveProgress => ({ found: false, reached: false, aligned: false, free: false, collapsed: false, summary: null })

export const facingEarth = (heading: number, earthAz: number) => Math.abs(relativeTurn(heading, earthAz)) <= FACE_TOLERANCE_DEG
export const antennaDistanceM = (visitor: { eastM: number; northM: number }) => Math.hypot(EQUIPMENT_POSITIONS.antenna.eastM - visitor.eastM, EQUIPMENT_POSITIONS.antenna.northM - visitor.northM)
export const antennaBearing = (visitor: { eastM: number; northM: number }) => bearingFromTo(visitor.eastM, visitor.northM, EQUIPMENT_POSITIONS.antenna.eastM, EQUIPMENT_POSITIONS.antenna.northM)
/** With Earth's azimuth known, a guided walk stops this far from the antenna, side-on to Earth. */
export const ANTENNA_SIDE_M = 1.0
/**
 * Where a guided walk to the antenna should head. With Earth's azimuth, the walk ends beside the antenna,
 * side-on to Earth (the closer side), so the dish never stands between the visitor and Earth.
 * Otherwise it aims just past the antenna on the visitor's line, so the walk ends beside it.
 */
export function antennaWalkTarget(visitor: { eastM: number; northM: number }, earthAzDeg?: number) {
  const a = EQUIPMENT_POSITIONS.antenna, d = antennaDistanceM(visitor)
  if (earthAzDeg != null && Number.isFinite(earthAzDeg)) {
    const spot = (b: number) => ({ eastM: a.eastM + ANTENNA_SIDE_M * Math.sin(b * Math.PI / 180), northM: a.northM + ANTENNA_SIDE_M * Math.cos(b * Math.PI / 180) })
    const l = spot(earthAzDeg - 90), r = spot(earthAzDeg + 90)
    const s = Math.hypot(l.eastM - visitor.eastM, l.northM - visitor.northM) <= Math.hypot(r.eastM - visitor.eastM, r.northM - visitor.northM) ? l : r
    const ds = Math.hypot(s.eastM - visitor.eastM, s.northM - visitor.northM)
    if (ds < 0.05) return s
    // The scene ends a walk GUIDED_ARRIVAL_M short of its target, so aim that far past the spot (less a margin).
    const k = (GUIDED_ARRIVAL_M - 0.1) / ds
    return { eastM: s.eastM + (s.eastM - visitor.eastM) * k, northM: s.northM + (s.northM - visitor.northM) * k }
  }
  if (d < 0.01) return { eastM: a.eastM, northM: a.northM }
  const k = ANTENNA_OVERSHOOT_M / d
  return { eastM: a.eastM + (a.eastM - visitor.eastM) * k, northM: a.northM + (a.northM - visitor.northM) * k }
}
export const antennaAligned = (a: ObjectiveInput['antenna']) => a.deployed && a.earthVisible && Number.isFinite(a.pointingErrorDeg) && a.pointingErrorDeg <= ALIGN_TOLERANCE_DEG

export function objectiveStage(p: ObjectiveProgress): ObjectiveStage {
  return !p.found ? 'find' : !p.reached ? 'walk' : !p.aligned ? 'point' : 'done'
}
export const objectiveDoneCount = (p: ObjectiveProgress) => [p.found, p.reached, p.aligned].filter(Boolean).length

/**
 * Steps complete in order, each from a live condition, and stay complete once reached.
 * Returns the same object when nothing changed (so React state does not churn).
 */
export function advanceObjective(p: ObjectiveProgress, input: ObjectiveInput, sceneUTC: string, nowUTC = new Date().toISOString()): ObjectiveProgress {
  if (p.free || p.aligned) return p
  const ok = [input.heading, input.earth.az, input.earth.el, input.skylineEl, input.visitor.eastM, input.visitor.northM].every(Number.isFinite)
  if (!ok) return p
  let found: boolean = p.found, reached: boolean = p.reached, aligned: boolean = p.aligned
  // Finding Earth means seeing it: facing its direction counts only while it stands above the measured skyline.
  if (!found && facingEarth(input.heading, input.earth.az) && input.earth.el > input.skylineEl) found = true
  if (found && !reached && antennaDistanceM(input.visitor) <= ANTENNA_REACH_M) reached = true
  if (found && reached && !aligned && antennaAligned(input.antenna)) aligned = true
  if (found === p.found && reached === p.reached && aligned === p.aligned) return p
  const summary = aligned && !p.aligned ? { sceneUTC, completedUTC: nowUTC, earthAzDeg: input.earth.az, earthElDeg: input.earth.el, skylineElDeg: input.skylineEl, pointingErrorDeg: input.antenna.pointingErrorDeg } : p.summary
  return { ...p, found, reached, aligned, summary }
}

const deg = (v: number) => `${v.toFixed(1)}°`
/** Presentation only; the visibility/pointing tests keep their unrounded values. */
export const earthSkylineText = (clearance: number) => Math.abs(clearance) < 0.05
  ? 'right at the measured skyline'
  : `${deg(Math.abs(clearance))} ${clearance > 0 ? 'above' : 'below'} the measured skyline`
/** "0.0° below" reads as a contradiction: a difference under 0.05° is "right at" the measured skyline. */
const belowSkyline = (input: ObjectiveInput) => {
  const d = input.skylineEl - input.earth.el
  return d < 0.05 ? 'right at the measured skyline' : `${deg(d)} below the measured skyline`
}
const earthWhere = (input: ObjectiveInput) => {
  const up = input.earth.el > input.skylineEl
  return up ? `${relativeDirectionText(input.heading, input.earth.az)}, ${earthSkylineText(input.earth.el - input.skylineEl)} (elevation ${deg(input.earth.el)})`
    : `${relativeDirectionText(input.heading, input.earth.az)}, behind the terrain: ${belowSkyline(input)} there`
}
/**
 * Her captions stay on screen while the visitor turns, so they use the compass bearing (which does not change
 * when you turn) instead of "to your left", which went stale. The objective card keeps the live relative direction.
 */
const earthFixed = (input: ObjectiveInput) => {
  const at = `at compass bearing ${Math.round(((input.earth.az % 360) + 360) % 360)}°`
  return input.earth.el > input.skylineEl ? `${at}, ${earthSkylineText(input.earth.el - input.skylineEl)} (elevation ${deg(input.earth.el)})`
    : `${at}, behind the terrain: ${belowSkyline(input)} there`
}

/** The three steps with live text built only from the values passed in. */
export function objectiveSteps(p: ObjectiveProgress, input: ObjectiveInput): ObjectiveStep[] {
  const stage = objectiveStage(p), d = antennaDistanceM(input.visitor)
  const a = input.antenna
  return [
    { id: 'find', label: 'Find Earth', done: p.found, current: stage === 'find',
      detail: p.found ? `Found · azimuth ${Math.round(input.earth.az)}°` : `Earth is ${earthWhere(input)}. ${input.earth.el > input.skylineEl ? `Face it within ${FACE_TOLERANCE_DEG}°.` : 'Choose another time before continuing.'}` },
    { id: 'walk', label: 'Walk to the antenna', done: p.reached, current: stage === 'walk',
      detail: p.reached ? 'You reached the antenna spot' : `${distanceText(d)} away, ${relativeDirectionText(input.heading, antennaBearing(input.visitor))}. Get within ${ANTENNA_REACH_M} m.` },
    { id: 'point', label: 'Point the antenna at Earth', done: p.aligned, current: stage === 'point',
      detail: p.aligned && p.summary ? `Aligned · ${deg(p.summary.pointingErrorDeg)} from Earth’s centre`
        : !a.deployed ? 'Open the antenna card, then aim it at Earth.'
        : !a.earthVisible ? `Earth is ${belowSkyline(input)}, so no aim reaches it now. Move time forward until it rises.`
        : `Pointing error ${deg(a.pointingErrorDeg)} · get within ${ALIGN_TOLERANCE_DEG}°.` },
  ]
}

/** What the visitor learned, from the values captured when the antenna was aligned. */
export function objectiveSummaryText(s: ObjectiveSummary) {
  const clearance = s.earthElDeg - s.skylineElDeg
  return `Earth stood ${deg(s.earthElDeg)} high at azimuth ${Math.round(s.earthAzDeg)}°. The measured skyline in that direction is at ${deg(s.skylineElDeg)}; Earth was ${earthSkylineText(clearance)}. Your antenna pointed ${deg(s.pointingErrorDeg)} from Earth’s centre. Pointing alone does not establish a radio link.`
}

export type ObjectiveLine = { key: string; text: string; brief?: string; offer: 'face-earth' | 'walk-antenna' | 'open-antenna' | 'open-time' | null }
/** Chader Buri's caption for the current stage (deterministic; no AI). The key changes when the advice changes. */
export function objectiveLine(p: ObjectiveProgress, input: ObjectiveInput, siteName: string, nextEarthriseH: number | null): ObjectiveLine | null {
  if (p.free) return null
  const stage = objectiveStage(p)
  if (stage === 'find') return input.earth.el > input.skylineEl
    ? { key: 'objective:find', offer: 'face-earth', brief: 'Earth is visible. Let’s turn toward it.', text: `First job: find Earth. It’s ${earthFixed(input)}. The compass and the objective card show which way to turn.` }
    : { key: 'objective:find-hidden', offer: 'open-time', brief: 'Earth is behind the terrain. Choose another time to find it.', text: `Earth is ${earthFixed(input)}. Turning cannot reveal it now. It clears the skyline ${formatEta(nextEarthriseH)}. Open Time to preview Earthrise or return to your arrival.` }
  if (stage === 'walk') return { key: 'objective:walk', offer: 'walk-antenna', brief: 'There’s Earth. Let’s walk to the antenna next.',
    text: `There’s Earth. The antenna is illustrative example equipment. At the start of this step it was ${distanceText(antennaDistanceM(input.visitor))} away at compass bearing ${Math.round(antennaBearing(input.visitor))}°. The objective card shows the live distance and turn direction.` }
  if (stage === 'point') {
    if (!input.antenna.earthVisible) return { key: 'objective:point-hidden', offer: 'open-time', brief: 'Earth is hidden now. Preview Earthrise before aiming the antenna.',
      text: `Earth is behind the terrain right now, so the antenna can’t see it from here. It clears the skyline ${formatEta(nextEarthriseH)}.` }
    return { key: input.antenna.deployed ? 'objective:point-aim' : 'objective:point', offer: 'open-antenna',
      text: input.antenna.deployed ? `Aim it at Earth: the card shows the error from Earth’s centre. Get within ${ALIGN_TOLERANCE_DEG}°.` : 'Open the antenna card and aim it at Earth. The card shows how far off you are.' }
  }
  return p.summary ? { key: 'objective:done', offer: null, text: `Well done. Observation recorded ${formatSimUTC(new Date(p.summary.sceneUTC))}. From ${siteName}, Earth was ${earthSkylineText(p.summary.earthElDeg - p.summary.skylineElDeg)} and your antenna pointed ${deg(p.summary.pointingErrorDeg)} from its centre. The objective card has the full summary.` } : null
}

const bool = (v: unknown) => v === true
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : null
const iso = (v: unknown) => typeof v === 'string' && v.length <= 40 && Number.isFinite(Date.parse(v)) ? v : null
function cleanSummary(raw: unknown): ObjectiveSummary | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const sceneUTC = iso(r.sceneUTC), completedUTC = iso(r.completedUTC), earthAzDeg = finite(r.earthAzDeg), earthElDeg = finite(r.earthElDeg), skylineElDeg = finite(r.skylineElDeg), pointingErrorDeg = finite(r.pointingErrorDeg)
  if (!sceneUTC || !completedUTC || earthAzDeg === null || earthElDeg === null || skylineElDeg === null || pointingErrorDeg === null) return null
  if (Math.abs(earthElDeg) > 90 || Math.abs(skylineElDeg) > 90 || pointingErrorDeg < 0 || pointingErrorDeg > 180) return null
  return { sceneUTC, completedUTC, earthAzDeg: ((earthAzDeg % 360) + 360) % 360, earthElDeg, skylineElDeg, pointingErrorDeg }
}
function cleanProgress(raw: unknown): ObjectiveProgress | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  // Steps are sequential: a later step never stands without the earlier ones.
  const found = bool(r.found), reached = found && bool(r.reached), summary = cleanSummary(r.summary)
  const aligned = reached && bool(r.aligned) && summary !== null
  return { found, reached, aligned, free: bool(r.free), collapsed: bool(r.collapsed), summary: aligned ? summary : null }
}
/** Progress per site from storage. Anything malformed is dropped; nothing here can break the visit. */
export function parseObjectiveStore(raw: unknown): ObjectiveStore {
  let value = raw
  if (typeof raw === 'string') { try { value = JSON.parse(raw) } catch { return {} } }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ObjectiveStore = {}
  for (const [slug, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_SITES)) {
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) continue
    const p = cleanProgress(entry)
    if (p) out[slug] = p
  }
  return out
}
