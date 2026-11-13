// "Ask about this": what the visitor is dealing with right now, and a few questions about it that
// Chader Buri answers from the values already on screen (deterministic; no AI). Pure, checked by verify:field.
import type { SurfaceObject } from '../lib/surfaceMission.ts'
import { ALIGN_TOLERANCE_DEG, type ObjectiveStage } from './fieldObjective.ts'
import { distanceText, formatEta, relativeDirectionText } from './fieldMath.ts'

export type AskSubjectKind = SurfaceObject | 'ground' | 'map' | 'sky' | 'time' | 'journal' | 'weather' | 'earth' | 'site'
export type AskSubject = { kind: AskSubjectKind; title: string; why: 'selected' | 'inspected' | 'tool' | 'looking' | 'objective' | 'here' }
export type AskSuggestion = { id: string; question: string; answer: string }
type Tool = 'map' | 'sky' | 'time' | 'journal' | 'weather'
const TOOL_SUBJECT: Record<Tool, string> = { map: 'Terrain map', sky: 'Sun & Earth', time: 'Time', journal: 'Field journal', weather: 'NASA space weather' }
const OBJECT_TITLE: Record<SurfaceObject, string> = { lander: 'Lander (illustrative)', payload: 'Payload (illustrative)', panel: 'Solar panel (illustrative example equipment)', antenna: 'Antenna (illustrative example equipment)' }

/** The open card first, then the inspected ground, an open tool, what the reticle is on, then the objective step. */
export function askSubject(s: { selection: SurfaceObject | null; ground: boolean; tool: Tool | null; focus: SurfaceObject | null; objective: ObjectiveStage | null }): AskSubject {
  if (s.selection) return { kind: s.selection, title: OBJECT_TITLE[s.selection], why: 'selected' }
  if (s.ground) return { kind: 'ground', title: 'Ground under the reticle', why: 'inspected' }
  if (s.tool) return { kind: s.tool, title: TOOL_SUBJECT[s.tool], why: 'tool' }
  if (s.focus) return { kind: s.focus, title: OBJECT_TITLE[s.focus], why: 'looking' }
  if (s.objective === 'find') return { kind: 'earth', title: 'Finding Earth', why: 'objective' }
  if (s.objective === 'walk' || s.objective === 'point') return { kind: 'antenna', title: OBJECT_TITLE.antenna, why: 'objective' }
  return { kind: 'site', title: 'Where you are', why: 'here' }
}

export type AskValues = {
  siteName: string
  sceneUTC: string
  heading: number
  earth: { az: number; el: number; skylineEl: number; nextCrossingH: number | null }
  sun: { az: number; el: number; skylineEl: number; state: 'above' | 'partial' | 'below'; nextCrossingH: number | null }
  distanceFromLandingM: number
  explorationRadiusM: number
  lander: { name: string; mission: string | null; distanceM: number; bearingDeg: number }
  payload: { name: string; purpose: string | null } | null
  antenna: { deployed: boolean; pointingErrorDeg: number; earthVisible: boolean; azDeg: number; elDeg: number; distanceM: number; bearingDeg: number }
  panel: { deployed: boolean; watts: number; sunFraction: number; azDeg: number; tiltDeg: number }
  ground: { slopeDeg: number; elevationM: number; resolutionM: number } | null
  decorative: boolean
}

const deg = (v: number) => `${v.toFixed(1)}°`
const az = (v: number) => `${Math.round(((v % 360) + 360) % 360)}°`
function earthGeometry(v: AskValues) {
  const clear = v.earth.el - v.earth.skylineEl
  return clear > 0
    ? `Earth’s centre is ${deg(v.earth.el)} high at azimuth ${az(v.earth.az)}, ${deg(clear)} above the measured skyline in that direction.`
    : `Earth’s centre is ${deg(v.earth.el)} high at azimuth ${az(v.earth.az)}, but the measured skyline there rises to ${deg(v.earth.skylineEl)}, so the terrain hides it by ${deg(-clear)}.`
}
const earthNext = (v: AskValues) => v.earth.el > v.earth.skylineEl ? `It next drops behind the skyline ${formatEta(v.earth.nextCrossingH)}.` : `It clears the skyline again ${formatEta(v.earth.nextCrossingH)}.`
const sunNext = (v: AskValues) => v.sun.state === 'below' ? `Sunrise over the skyline ${formatEta(v.sun.nextCrossingH)}.` : `The Sun next crosses the skyline ${formatEta(v.sun.nextCrossingH)}.`
const atLanding = 'These are measured at the landing point (JPL Horizons positions against the LOLA skyline).'

function antennaQuestions(v: AskValues): AskSuggestion[] {
  const a = v.antenna, visible = v.earth.el > v.earth.skylineEl
  return [
    visible
      ? { id: 'antenna-see', question: 'Can the antenna see Earth from here?', answer: `In geometry, yes: ${earthGeometry(v)} ${earthNext(v)} Pointing alone does not establish a radio link; the link budget isn’t modelled in this view. ${atLanding}` }
      : { id: 'antenna-why-not', question: 'Why can’t the antenna see Earth?', answer: `${earthGeometry(v)} No aim can reach it through the terrain. ${earthNext(v)} ${atLanding}` },
    { id: 'antenna-aim', question: 'How far off is my aim?', answer: a.deployed
      ? `The antenna points to azimuth ${az(a.azDeg)}, elevation ${deg(a.elDeg)}. Earth’s centre is at ${az(v.earth.az)}, ${deg(v.earth.el)}, so the error is ${deg(a.pointingErrorDeg)}. For this activity, within ${ALIGN_TOLERANCE_DEG}° counts as aligned.`
      : 'It isn’t set up yet. Open the antenna card, then press “Aim at Earth” or drag the antenna; the card shows the error from Earth’s centre.' },
    { id: 'antenna-where', question: 'Where is the antenna?', answer: `It stands ${distanceText(a.distanceM)} from you, ${relativeDirectionText(v.heading, a.bearingDeg)}, beside the landing point. It’s illustrative example equipment, not hardware from a real mission.` },
  ]
}

/** Two or three questions about the subject, each answered only from the values given. */
export function askSuggestions(subject: AskSubject, v: AskValues): AskSuggestion[] {
  switch (subject.kind) {
    case 'antenna': return antennaQuestions(v)
    case 'earth': return [
      { id: 'earth-where', question: 'Where is Earth?', answer: `Earth is ${relativeDirectionText(v.heading, v.earth.az)}. ${earthGeometry(v)}` },
      { id: 'earth-still', question: 'Why does Earth barely move?', answer: `The Moon keeps the same face toward Earth, so from one spot Earth only wobbles a few degrees in the sky (libration) instead of crossing it each day. Near the south pole it sits low, so that wobble can hide it behind terrain. ${earthNext(v)}` },
    ]
    case 'panel': return [
      { id: 'panel-power', question: 'How much power is it making?', answer: v.panel.deployed
        ? `${v.panel.watts.toFixed(1)} W modelled right now for the 2 m², 28% example panel, facing azimuth ${az(v.panel.azDeg)} at ${deg(v.panel.tiltDeg)} tilt. ${Math.round(v.panel.sunFraction * 100)}% of the Sun’s disc is unblocked by the skyline or Earth.`
        : 'It isn’t set up yet. Open the panel card to deploy and turn it; the card shows the modelled output.' },
      { id: 'panel-sun', question: 'Where is the Sun?', answer: `The Sun is ${relativeDirectionText(v.heading, v.sun.az)}, ${deg(v.sun.el)} high; the measured skyline under it is at ${deg(v.sun.skylineEl)}. ${sunNext(v)}` },
    ]
    case 'lander': return [
      { id: 'lander-what', question: 'What is this lander?', answer: `${v.lander.mission ? `It stands in for ${v.lander.mission} (${v.lander.name}).` : `It’s ${v.lander.name}, an illustrative station for this site.`} The model and its placement are simplified for learning; vehicle condition and real hardware positions aren’t reconstructed.` },
      { id: 'lander-where', question: 'How far away is it?', answer: `${distanceText(v.lander.distanceM)}, ${relativeDirectionText(v.heading, v.lander.bearingDeg)}.` },
    ]
    case 'payload': return [
      { id: 'payload-what', question: 'What does this instrument do?', answer: v.payload ? `${v.payload.name}: ${v.payload.purpose ?? 'the catalogue gives no purpose for it.'} The model and placement are illustrative.` : 'This is an illustrative survey instrument; no catalogue payload is linked to it.' },
      { id: 'payload-earth', question: 'Can it see Earth from here?', answer: `${earthGeometry(v)} ${atLanding}` },
    ]
    case 'ground': return [
      ...(v.ground ? [{ id: 'ground-slope', question: 'What does this slope mean?', answer: `The rendered elevation-model facet here slopes ${deg(v.ground.slopeDeg)} at ${v.ground.elevationM.toFixed(1)} m elevation. The LOLA model has ${v.ground.resolutionM} m pixels, so smaller bumps and individual rocks aren’t resolved.` }] : []),
      ...(v.decorative ? [{ id: 'ground-rock', question: 'Is this rock real?', answer: 'No. Rocks are placed for scale and texture; the elevation model does not resolve individual rocks.' }] : []),
      { id: 'ground-unknown', question: 'What isn’t measured here?', answer: 'Composition, grain size, temperature and hazards. This view only knows the terrain relief from the LOLA elevation model.' },
    ]
    case 'map': return [
      { id: 'map-range', question: 'How far can I walk?', answer: `Inside a ${v.explorationRadiusM} m circle around the landing point, where the terrain is rendered. You’re ${distanceText(v.distanceFromLandingM)} from its centre.` },
      { id: 'map-lander', question: 'Where is the lander?', answer: `${distanceText(v.lander.distanceM)}, ${relativeDirectionText(v.heading, v.lander.bearingDeg)}.` },
    ]
    case 'sky': return [
      { id: 'sky-earth', question: 'How high is Earth above the skyline?', answer: `${earthGeometry(v)} ${earthNext(v)}` },
      { id: 'sky-sun', question: 'How high is the Sun above the skyline?', answer: `The Sun is ${deg(v.sun.el)} high at azimuth ${az(v.sun.az)}; the measured skyline under it is at ${deg(v.sun.skylineEl)}. ${sunNext(v)}` },
    ]
    case 'time': return [
      { id: 'time-move', question: 'Does changing time move me?', answer: `No. Time moves the Sun and Earth along their JPL Horizons paths; where you stand stays the same. The scene is at ${v.sceneUTC}.` },
      { id: 'time-sun', question: 'When does the light change next?', answer: `${sunNext(v)} Earth: ${earthNext(v).replace(/^It /, 'it ')}` },
    ]
    case 'weather': return [
      { id: 'weather-date', question: 'Are these reports for my arrival date?', answer: 'They describe the recent real-world UTC dates shown in the report, separate from the simulation clock. They are not a forecast for a future landing. Check the report time and the last successful NASA response.' },
      { id: 'weather-site', question: 'Does this change which site I should choose?', answer: 'The reports provide wider space-environment context. They do not establish a local radiation dose or change the site ranking. Your site comparison still uses the same sunlight, Earth visibility, lander and mission requirements.' },
    ]
    case 'journal': return [
      { id: 'journal-where', question: 'Where are my notes kept?', answer: 'On this device only, in your browser’s storage. “Export” saves them, with your photos’ details, as a JSON file.' },
      { id: 'journal-what', question: 'What is recorded with a photo?', answer: 'The site, your position relative to the landing point, the scene time and the view direction. The picture is a rendered simulation, not lunar photography.' },
    ]
    default: return [
      { id: 'site-where', question: 'Where am I?', answer: `At ${v.siteName}, ${distanceText(v.distanceFromLandingM)} from the landing point. The scene is at ${v.sceneUTC}.` },
      { id: 'site-earth', question: 'Can I see Earth from here?', answer: `${earthGeometry(v)} ${atLanding}` },
    ]
  }
}

/** Chader Buri's context for the question: the subject and its key on-screen values (each value fits the 80-character digest limit). */
export function askDigestItems(subject: AskSubject, v: AskValues): { id: string; label: string; value: string }[] {
  const items = [{ id: 'field-ask', label: 'Visitor is asking about', value: `${subject.title} (${subject.why})`.slice(0, 80) }]
  if (subject.kind === 'antenna') items.push({ id: 'field-ask-antenna', label: 'Illustrative antenna pointing error from Earth centre', value: v.antenna.deployed ? deg(v.antenna.pointingErrorDeg) : 'antenna not set up' })
  if (subject.kind === 'panel') items.push({ id: 'field-ask-panel', label: 'Illustrative panel modelled output', value: v.panel.deployed ? `${v.panel.watts.toFixed(1)} W` : 'panel not set up' })
  if (subject.kind === 'ground' && v.ground) items.push({ id: 'field-ask-ground', label: 'Rendered DEM facet slope / DEM pixel size', value: `${deg(v.ground.slopeDeg)} / ${v.ground.resolutionM} m` })
  if (subject.kind === 'lander') items.push({ id: 'field-ask-lander', label: 'Illustrative lander distance', value: distanceText(v.lander.distanceM) })
  if (subject.kind !== 'ground' && subject.kind !== 'journal' && subject.kind !== 'time') items.push({ id: 'field-ask-earth', label: 'Earth elevation / measured skyline at its azimuth (landing point)', value: `${deg(v.earth.el)} / ${deg(v.earth.skylineEl)} at azimuth ${az(v.earth.az)}` })
  return items
}
