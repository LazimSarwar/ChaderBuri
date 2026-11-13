// Pure checks for the field interface (src/explore): arrival-time search, directions,
// clock text, notes storage, map transforms, the terrain grid / contours, the first objective,
// caption timing, phone tool grouping and "Ask about this".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { EphRow, Horizon } from '../src/data.ts'
import { horizonAt } from '../src/data.ts'
import { sampleSky, sunVerdict } from '../src/lib/science.ts'
import { approachPoint, bearingFromTo, bodyState, clampToRadius, compassTicks, findArrivalRow, formatEta, formatOffsetHours, formatSimUTC, mapProject, mapUnproject, relativeDirectionText, relativeTurn, scaleBarMetres, skyClear, wrap180, localOffsetM } from '../src/explore/fieldMath.ts'
import { viewpointCoordinates } from '../src/lib/surfaceExplorer.ts'
import { addFieldNote, formatLatLon, MAX_FIELD_NOTES, noteId, parseFieldNotes, removeFieldNote, updateFieldNote, type FieldNote } from '../src/explore/fieldNotes.ts'
import { contourInterval, contourSegments, createGrid, fillGridRows, hillshade, sampleGrid } from '../src/explore/terrainGrid.ts'
import { BURI_MAP_POSITION, fieldPlaces } from '../src/explore/fieldPlaces.ts'
import { EQUIPMENT_POSITIONS } from '../src/lib/surfaceMission.ts'
import { advanceObjective, ANTENNA_REACH_M, antennaDistanceM, antennaWalkTarget, GUIDED_ARRIVAL_M, facingEarth, newObjective, objectiveDoneCount, objectiveLine, objectiveStage, objectiveSteps, objectiveSummaryText, earthSkylineText, parseObjectiveStore, type ObjectiveInput } from '../src/explore/fieldObjective.ts'
import { ambientHoldMs, dropGroup, emptyCaptions, expireAmbient, lineKind, MAX_PENDING, receiveLine, resolvePinned } from '../src/explore/fieldCaptions.ts'
import { groupTools, NARROW_TOOLS_MAX_WIDTH } from '../src/explore/fieldTools.ts'
import { askDigestItems, askSubject, askSuggestions, type AskValues } from '../src/explore/fieldAsk.ts'
import { isRepeat, REPEAT_WINDOW_MS, waitingCount } from '../src/explore/fieldCaptions.ts'
import { equipmentDragAllowed } from '../src/lib/equipmentGesture.ts'
import { ACTIVITIES, arrangeSurfaces, arrivalFacts, completeActivity, demProductText, eventTargetRow, EVENT_SETTLE_H, fieldEvents, journeyDigest, newJourney, nextActivities, panelTurned, poleDistanceM, qualityText, sunlightConclusion, sunlightStage, whatChanged, type PanelReading, type SkySnapshot } from '../src/explore/fieldJourney.ts'
import { DEFAULT_SURFACE_PREFERENCES, effectiveMotionScale, parseSurfacePreferences } from '../src/lib/surfacePolish.ts'

let checks = 0
assert.equal(earthSkylineText(0.01),'right at the measured skyline')
assert.equal(earthSkylineText(-0.01),'right at the measured skyline')
assert.equal(earthSkylineText(4.5),'4.5° above the measured skyline')
const check = (x: unknown, message: string) => { assert.ok(x, message); checks++ }
const close = (a: number, b: number, eps = 1e-6, message = `${a} ≈ ${b}`) => check(Math.abs(a - b) <= eps, message)

// Directions
close(wrap180(190), -170); close(wrap180(-190), 170); close(wrap180(180), 180); close(wrap180(-180), 180); close(wrap180(720), 0)
close(bearingFromTo(0, 0, 0, 10), 0); close(bearingFromTo(0, 0, 10, 0), 90); close(bearingFromTo(0, 0, 0, -10), 180); close(bearingFromTo(0, 0, -10, 0), 270)
close(relativeTurn(350, 10), 20, 1e-9, 'Turning across north takes the short way')
check(relativeDirectionText(100, 62) === '38° to your left', 'Left turn text')
check(relativeDirectionText(10, 50) === '40° to your right', 'Right turn text')
check(relativeDirectionText(359, 2) === 'straight ahead', 'Within 5° is straight ahead')
check(relativeDirectionText(0, 178) === 'behind you', 'Opposite direction is behind you')
const ticks = compassTicks(10, 60, 15)
check(ticks.some(t => t.label === 'N' && t.offset === -10), 'North tick sits 10° left of a 10° heading')
check(ticks.every(t => Math.abs(t.offset) <= 60), 'Ticks stay inside the tape')

// Body state uses the existing Sun disc verdict
check(bodyState('sun', 5, 1, 0.27) === 'above' && bodyState('sun', 1.1, 1, 0.27) === 'partial' && bodyState('sun', 0, 1, 0.27) === 'below', 'Sun uses the lit / grazing / shadowed verdict')
check(bodyState('earth', 1.01, 1) === 'above' && bodyState('earth', 0.99, 1) === 'below', 'Earth uses the centre above the skyline, as the dashboard does')

// Arrival-time search on synthetic rows: flat 2° horizon, Sun up from row 30, Earth up from row 50.
const flat: Horizon = { site: 'x', lat: -89, lonEast: 0, dem: '', demSource: '', siteHeightM: 0, maxHorizonDeg: 2, profile: new Array(360).fill(2) }
const rows = (f: (r: number) => number, radius?: number): EphRow[] => Array.from({ length: 200 }, (_, r) => ({ t: `2026-Nov-14 ${r}`, az: 90, el: f(r), ...(radius ? { radiusDeg: radius } : {}) }))
const sunRows = rows(r => r >= 30 ? 5 : -1, 0.27), earthRows = rows(r => r >= 50 && r < 52 ? 4 : r >= 60 ? 4 : -2)
check(findArrivalRow(sunRows, earthRows, flat, 0) === 60, 'Waits until both stay above the horizon for the hold period (a 2-hour Earth gap is skipped)')
check(findArrivalRow(sunRows, earthRows, flat, 0, { holdHours: 0 }) === 50, 'Without a hold the first clear hour is chosen')
check(findArrivalRow(sunRows, earthRows, flat, 70) === 70, 'An already clear sky keeps the current time')
check(findArrivalRow(sunRows, earthRows, flat, 0, { maxHours: 20 }) === null, 'Nothing in the search window returns null (fallback to the current time)')
check(findArrivalRow(sunRows, rows(() => -5), flat, 0) === null, 'Earth never up returns null')
check(skyClear(sunRows, earthRows, flat, 65) && !skyClear(sunRows, earthRows, flat, 55), 'skyClear agrees with the horizon')
const risingSun = rows(r => r >= 30 ? 2.3 + (r >= 80 ? 4 : 0) : -1, 0.27)
check(findArrivalRow(risingSun, earthRows, flat, 0, { preferSunClearanceDeg: 3 }) === 80, 'Preferring a lit foreground waits for the Sun to stand 3° clear of the skyline')
check(findArrivalRow(rows(r => r >= 30 ? 2.5 : -1, 0.27), earthRows, flat, 0, { preferSunClearanceDeg: 3 }) === 60, 'With no well-lit time in range, the first clear time is still used')

// Real data: Malapert arrival satisfies the dashboard's own visibility rules.
const index = JSON.parse(readFileSync('public/data/prediction-index.json', 'utf8'))
const load = (p: string) => JSON.parse(readFileSync('public/data/' + p, 'utf8'))
try {
  const horizon = load('horizons/malapert-massif.json') as Horizon
  const sun = load('ephemeris/malapert-massif.sun.json').rows, earth = load('ephemeris/malapert-massif.earth.json').rows
  if (Array.isArray(sun) && Array.isArray(earth) && Array.isArray(horizon.profile)) {
    const start = Math.max(0, Math.floor((Date.parse('2026-11-14T00:00:00Z') - Date.parse(index.coverage.start)) / 3600000))
    const row = findArrivalRow(sun, earth, horizon, start, { preferSunClearanceDeg: 5 })
    if (row !== null) {
      const lit = sampleSky(sun, row)
      console.log(`Malapert arrival from 14 Nov 2026: row ${row} (${sun[row]?.t}), Sun ${(lit.el - horizonAt(horizon, lit.az)).toFixed(1)}° above the skyline`)
      const s = sampleSky(sun, row), e = sampleSky(earth, row)
      check(row >= start && row <= start + 45 * 24, 'Malapert arrival is inside the 45-day window')
      check(sunVerdict(s.el, horizonAt(horizon, s.az), s.radiusDeg) === 'lit', 'Malapert arrival: Sun disc clear of the measured horizon')
      check(e.el > horizonAt(horizon, e.az), 'Malapert arrival: Earth above the measured horizon')
    } else console.log('note: no Malapert arrival within 45 days of 14 Nov 2026 in the loaded data')
  }
} catch (error) { console.log('note: Malapert products not readable here, real-data arrival check skipped:', String(error).slice(0, 80)) }

// Clock text
check(formatSimUTC(new Date(Date.UTC(2026, 10, 14, 5, 7))) === '14 Nov 2026 · 05:07 UTC', 'Simulation clock text')
check(formatOffsetHours(28) === '+1 d 4 h' && formatOffsetHours(-3) === '−3 h' && formatOffsetHours(0) === '+0 h', 'Offset text')
check(formatEta(3.44) === 'in 3.4 h' && formatEta(50) === 'in 2.1 d' && formatEta(null).includes('not within'), 'ETA text')

// Map transforms
const view = { centreE: 0, centreN: 0, halfM: 260, sizePx: 520 }
const p = mapProject(100, 50, view)
close(p.x, 360); close(p.y, 210)
const back = mapUnproject(p.x, p.y, view)
close(back.eastM, 100); close(back.northM, 50)
const north = mapProject(0, 100, view); check(north.y < view.sizePx / 2, 'North is up on the map')
const c = clampToRadius(300, 400, 250); close(Math.hypot(c.eastM, c.northM), 250); check(c.clamped, 'Targets outside the boundary are pulled inside')
check(!clampToRadius(10, 10, 250).clamped, 'Targets inside are unchanged')
const a = approachPoint({ eastM: 0, northM: 0 }, { eastM: 10, northM: 0 }, 3); close(a.eastM, 7); close(a.northM, 0)
const near = approachPoint({ eastM: 9, northM: 0 }, { eastM: 10, northM: 0 }, 3); close(near.eastM, 9, 1e-9, 'Already beside the object: stay put')
check(scaleBarMetres(520) === 100 && scaleBarMetres(200) === 50, 'Scale bar picks a round length')

// Flags and photos saved as lat/lon map back to the same metres east/north of the landing point
for (const site of [{ lat: -85.95, lonEast: 2.9 }, { lat: -89.45, lonEast: -137.1 }, { lat: -89.9, lonEast: 45 }]) for (const [e, n] of [[0, 0], [120, -80], [-240, 30], [5, 249]]) {
  const geo = viewpointCoordinates(site, { eastM: e, northM: n }), back = localOffsetM(site, geo.lat, geo.lonEast)
  close(back.eastM, e, 0.05, `east round trip at ${site.lat}`); close(back.northM, n, 0.05, `north round trip at ${site.lat}`)
}

// Places on the map
check(BURI_MAP_POSITION.eastM === 4.6 && BURI_MAP_POSITION.northM === -0.2, 'Chader Buri map position')
const buriSource = readFileSync('src/space/BuriFigure.tsx', 'utf8').match(/BURI_POSITION\s*=\s*\{\s*eastM:\s*([-\d.]+),\s*northM:\s*([-\d.]+)/)
check(buriSource && Number(buriSource[1]) === BURI_MAP_POSITION.eastM && Number(buriSource[2]) === BURI_MAP_POSITION.northM, 'Map position matches the 3D figure (BuriFigure.tsx)')
const places = fieldPlaces({ eastM: 0, northM: 0 }, [{ id: 'm1', label: 'Marker 1', eastM: 30, northM: 40 }])
check(places[0].id === 'landing' && places.some(x => x.id === 'lander') && places.some(x => x.id === 'buri') && places.some(x => x.id === 'm1'), 'Places list includes landing point, lander, Chader Buri and markers')
check(places.find(x => x.id === 'm1')!.distanceM === 50, 'Place distance from the visitor')

// Notes store
const base = (i: number): FieldNote => ({ id: 'n' + i, kind: 'note', siteSlug: 'malapert-massif', siteName: 'Malapert Massif', eastM: i, northM: 0, lat: -85.9, lonEast: 2.5, sceneUTC: '2026-11-14T00:00:00.000Z', createdUTC: '2026-11-10T00:00:00.000Z', text: 'note ' + i })
check(parseFieldNotes(null).length === 0 && parseFieldNotes('not json').length === 0 && parseFieldNotes('{"a":1}').length === 0, 'Malformed storage parses to an empty list')
check(parseFieldNotes(JSON.stringify([base(1), { id: 'bad' }, null, 7, { ...base(2), eastM: 'x' }, base(1)])).length === 1, 'Malformed and duplicate entries are dropped')
check(parseFieldNotes([{ ...base(3), text: 'x'.repeat(2000) }])[0].text.length === 500, 'Long text is clipped')
check(parseFieldNotes([{ ...base(4), lat: 400 }])[0].lat === null, 'Impossible coordinates are discarded, not trusted')
let list: FieldNote[] = []
for (let i = 0; i < MAX_FIELD_NOTES + 7; i++) list = addFieldNote(list, base(i))
check(list.length === MAX_FIELD_NOTES && list[0].id === 'n7' && list.at(-1)!.id === 'n56', 'Notes are capped; oldest dropped first')
check(parseFieldNotes(JSON.stringify(Array.from({ length: 80 }, (_, i) => base(i)))).length === MAX_FIELD_NOTES, 'Parsing also caps')
list = updateFieldNote(list, 'n10', 'changed'); check(list.find(n => n.id === 'n10')!.text === 'changed', 'Notes can be edited')
list = removeFieldNote(list, 'n10'); check(!list.some(n => n.id === 'n10'), 'Notes can be removed')
check(addFieldNote(list, { ...base(99), kind: 'other' as 'note' }) === list, 'Invalid notes are not added')
check(noteId(1) !== noteId(1), 'Note ids are unique within a session')
check(formatLatLon(-85.912345, 2.5) === '-85.91235°, 2.50000° E' && formatLatLon(undefined, 2) === 'position unavailable', 'Coordinate text')

// Terrain grid and contours on a synthetic cone: 100 m at the centre, falling 1 m per metre
const cone = (e: number, n: number) => Math.hypot(e, n) > 145 ? null : 100 - Math.hypot(e, n)
const g = sampleGrid(cone, 0, 0, 100, 2)
check(g.n === 101 && g.known === g.n * g.n, 'Grid covers ±100 m at 2 m')
close(g.max, 100, 1e-6); check(g.min < -30, 'Grid height range')
const chunked = createGrid(0, 0, 100, 2); let next = 0
while (next < chunked.n) next = fillGridRows(chunked, cone, next, next + 17)
check(chunked.known === g.known && chunked.min === g.min, 'Chunked filling equals one pass')
const partial = sampleGrid(cone, 0, 0, 150, 5)
check(partial.known < partial.n * partial.n && Number.isNaN(partial.heights[0]), 'Unknown samples stay NaN')
const interval = contourInterval(g.min, g.max); check(interval === 10, 'Contour interval gives at most ~16 lines')
const lines = contourSegments(g, 10)
check(lines.length >= 6 && lines.every(l => l.segments.length % 4 === 0), 'Contours produce segments')
const ring = lines.find(l => l.level === 50)!
for (let k = 0; k < ring.segments.length; k += 2) {
  const e = g.westM + ring.segments[k] * g.stepM, n = g.northM - ring.segments[k + 1] * g.stepM
  close(Math.hypot(e, n), 50, 1.5, 'The 50 m contour of the cone is a 50 m circle')
}
const shade = hillshade(g)
const iN = 50, jN = 25 // north slope faces north, away from a north-west light only partly
check(shade[jN * g.n + 25] > shade[75 * g.n + 75], 'North-west slopes are brighter than south-east slopes under north-west light')
check(Number.isNaN(hillshade(partial)[0]), 'Hillshade keeps unknown samples unknown')
void iN

// First objective: find Earth, walk to the antenna, point it at Earth (sequential, latched, real values only)
{
  const antenna = EQUIPMENT_POSITIONS.antenna
  const base: ObjectiveInput = { heading: 200, earth: { az: 10, el: 6 }, skylineEl: 1.5, visitor: { eastM: 0, northM: 0 }, antenna: { deployed: false, pointingErrorDeg: 40, earthVisible: true } }
  let o = newObjective()
  check(objectiveStage(o) === 'find' && objectiveDoneCount(o) === 0, 'A new objective starts at Find Earth')
  check(advanceObjective(o, base, '2026-11-14T00:00:00.000Z') === o, 'Nothing changes while the visitor faces away (same object back)')
  check(facingEarth(15, 10) && facingEarth(1, 10) && !facingEarth(21, 10) && facingEarth(355, 3), 'Facing Earth: within 10° of its azimuth, across north too')
  check(antennaDistanceM({ eastM: 0, northM: 0 }) > ANTENNA_REACH_M, 'The landing point is not already “at” the antenna')
  // Being at the antenna before finding Earth does not skip step 1.
  o = advanceObjective(o, { ...base, visitor: { ...antenna } }, '2026-11-14T00:00:00.000Z')
  check(!o.found && !o.reached, 'Steps complete in order')
  check(!advanceObjective(o, { ...base, heading: 12, earth: { az: 10, el: 1.4 } }, 'x').found, 'Facing Earth while it is behind the measured skyline does not count as finding it')
  o = advanceObjective(o, { ...base, heading: 12 }, 'x')
  check(o.found && !o.reached && objectiveStage(o) === 'walk', 'Facing Earth completes step 1')
  o = advanceObjective(o, { ...base, heading: 200 }, 'x')
  check(o.found, 'Step 1 stays complete after turning away')
  const near = { eastM: antenna.eastM + 1.0, northM: antenna.northM }
  o = advanceObjective(o, { ...base, visitor: near }, 'x')
  check(o.reached && objectiveStage(o) === 'point', 'Standing within 1.5 m of the antenna completes step 2')
  for (const from of [{ eastM: 0, northM: 0 }, { eastM: 30, northM: -12 }, { eastM: -1.4, northM: -3 }]) {
    const target = antennaWalkTarget(from), d = Math.hypot(target.eastM - from.eastM, target.northM - from.northM)
    // The scene ends a guided walk once within GUIDED_ARRIVAL_M of its target, on the line from the visitor.
    const stop = { eastM: target.eastM - (target.eastM - from.eastM) / d * GUIDED_ARRIVAL_M, northM: target.northM - (target.northM - from.northM) / d * GUIDED_ARRIVAL_M }
    check(d > GUIDED_ARRIVAL_M && antennaDistanceM(stop) <= ANTENNA_REACH_M - 0.4, 'A guided walk to the antenna really moves and ends beside it')
  }
  // With Earth's azimuth, the walk ends side-on to Earth so the dish never blocks the view of Earth.
  for (const earthAz of [351, 90, 200]) for (const from of [{ eastM: 0, northM: 0 }, { eastM: 30, northM: -12 }, { eastM: -6, northM: 9 }]) {
    const target = antennaWalkTarget(from, earthAz), d = Math.hypot(target.eastM - from.eastM, target.northM - from.northM)
    const stop = { eastM: target.eastM - (target.eastM - from.eastM) / d * GUIDED_ARRIVAL_M, northM: target.northM - (target.northM - from.northM) / d * GUIDED_ARRIVAL_M }
    const side = Math.abs(relativeTurn(bearingFromTo(antenna.eastM, antenna.northM, stop.eastM, stop.northM), earthAz))
    check(d > GUIDED_ARRIVAL_M && antennaDistanceM(stop) <= ANTENNA_REACH_M - 0.3 && side >= 70 && side <= 110, `Guided walk (Earth az ${earthAz}°) ends beside the antenna, side-on to Earth (${antennaDistanceM(stop).toFixed(2)} m, ${side.toFixed(0)}° off Earth's line)`)
  }
  const scene = readFileSync('src/space/SpaceScene.tsx', 'utf8').match(/if\(remaining<=([\d.]+)\)endGoTo\('arrived'\)/)
  check(!!scene && Number(scene[1]) === GUIDED_ARRIVAL_M, 'Arrival tolerance matches the scene')
  o = advanceObjective(o, { ...base, visitor: near, antenna: { deployed: true, pointingErrorDeg: 12, earthVisible: true } }, 'x')
  check(!o.aligned, 'A 12° pointing error is not aligned')
  o = advanceObjective(o, { ...base, visitor: near, antenna: { deployed: true, pointingErrorDeg: 0.4, earthVisible: false } }, 'x')
  check(!o.aligned, 'Aiming at an Earth hidden by the measured skyline never completes the objective')
  check(objectiveSteps(o, { ...base, earth: { az: 10, el: 0.5 }, skylineEl: 1.5, antenna: { deployed: true, pointingErrorDeg: 0.4, earthVisible: false } })[2].detail.includes('below the measured skyline'), 'Step 3 explains a hidden Earth')
  o = advanceObjective(o, { ...base, visitor: near, antenna: { deployed: false, pointingErrorDeg: 0, earthVisible: true } }, 'x')
  check(!o.aligned, 'An antenna that is not set up cannot be aligned')
  o = advanceObjective(o, { ...base, visitor: near, antenna: { deployed: true, pointingErrorDeg: 3.2, earthVisible: true } }, '2026-11-14T05:00:00.000Z', '2026-11-10T00:00:00.000Z')
  check(o.aligned && objectiveStage(o) === 'done' && objectiveDoneCount(o) === 3, 'Within 5° with Earth in view completes the objective')
  check(o.summary?.earthElDeg === 6 && o.summary.skylineElDeg === 1.5 && o.summary.pointingErrorDeg === 3.2 && o.summary.sceneUTC === '2026-11-14T05:00:00.000Z', 'The summary keeps the computed values at completion')
  const text = objectiveSummaryText(o.summary!)
  check(text.includes('6.0°') && text.includes('1.5°') && text.includes('4.5°') && text.includes('3.2°') && /does not establish a radio link/.test(text), 'Summary text: Earth elevation, skyline, clearance and pointing error, with the radio-link caveat')
  check(!/\bsafe|success|guarantee/i.test(text), 'Summary never claims safety or success')
  check(advanceObjective(o, { ...base, heading: 0 }, 'y') === o, 'A completed objective is final')
  const free = { ...newObjective(), free: true }
  check(advanceObjective(free, { ...base, heading: 10 }, 'x') === free && objectiveLine(free, base, 'X', null) === null, 'Free exploration pauses the objective and her objective captions')
  check(advanceObjective(newObjective(), { ...base, heading: NaN }, 'x').found === false, 'Non-finite input never completes a step')
  // Her captions follow the stage, from the same values
  const l1 = objectiveLine(newObjective(), base, 'Malapert Massif', 5)!
  check(l1.key === 'objective:find' && l1.offer === 'face-earth' && l1.text.includes('6.0°'), 'Find step line names Earth’s elevation and offers to turn')
  const hidden = objectiveLine(newObjective(), { ...base, earth: { az: 10, el: 0.2 } }, 'X', 3.4)!
  check(hidden.text.includes('behind the terrain') && hidden.text.includes('in 3.4 h'), 'A hidden Earth: direction and when it clears the skyline')
  const walk = objectiveLine({ ...newObjective(), found: true }, base, 'X', null)!
  check(walk.offer === 'walk-antenna' && /illustrative example equipment/.test(walk.text), 'Walk step labels the antenna as illustrative and offers the walk')
  const point = objectiveLine({ ...newObjective(), found: true, reached: true }, base, 'X', null)!
  check(point.offer === 'open-antenna', 'Point step offers to open the antenna card')
  const pointHidden = objectiveLine({ ...newObjective(), found: true, reached: true }, { ...base, antenna: { deployed: true, pointingErrorDeg: 1, earthVisible: false } }, 'X', 7)!
  check(pointHidden.offer === 'open-time' && pointHidden.key !== point.key, 'A hidden Earth at the antenna step offers Time instead')
  check(objectiveLine(o, base, 'X', null)?.key === 'objective:done', 'Completion line')
  // Her caption stays up while the visitor turns: it names the compass bearing, not a direction relative to the view.
  const turned = (h: number) => objectiveLine(newObjective(), { ...base, heading: h }, 'X', 5)!.text
  check(turned(0) === turned(120) && /compass bearing \d+°/.test(turned(0)) && !/to your (left|right)/.test(turned(0)), 'Find caption does not go stale when the visitor turns')
  const atSkyline = { ...base, earth: { az: 10, el: 1.48 }, skylineEl: 1.5 }
  check(objectiveLine(newObjective(), atSkyline, 'X', 2)!.text.includes('right at the measured skyline') && !objectiveSteps(newObjective(), atSkyline)[0].detail.includes('0.0°'), 'A hidden Earth within 0.05° reads "right at the skyline", never "0.0° below"')
  // Storage per site: robust parse
  check(Object.keys(parseObjectiveStore(null)).length === 0 && Object.keys(parseObjectiveStore('{oops')).length === 0 && Object.keys(parseObjectiveStore('[1,2]')).length === 0, 'Malformed objective storage parses to nothing')
  const stored = parseObjectiveStore(JSON.stringify({ 'malapert-massif': o, 'shackleton-rim': { found: true, reached: 'yes', aligned: true, free: 1 }, 'BAD SLUG': o, 'nobile-rim': null, 'faustini-rim': { found: false, reached: true, aligned: true, summary: o.summary } }))
  check(stored['malapert-massif']?.aligned === true && stored['malapert-massif'].summary?.pointingErrorDeg === 3.2, 'A completed objective survives a round trip')
  check(stored['shackleton-rim']?.found === true && stored['shackleton-rim'].reached === false && stored['shackleton-rim'].aligned === false && stored['shackleton-rim'].free === false, 'Non-boolean fields are not trusted; aligned needs reached and a summary')
  check(!('BAD SLUG' in stored) && !('nobile-rim' in stored), 'Unknown keys and null entries are dropped')
  check(stored['faustini-rim']?.reached === false && stored['faustini-rim'].aligned === false, 'Later steps never stand without earlier ones')
  check(parseObjectiveStore({ 'x-site': { ...o, summary: { ...o.summary, pointingErrorDeg: 900 } } })['x-site'].aligned === false, 'An impossible stored summary does not count as complete')
}

// Caption timing: actionable lines wait for the visitor; ambient remarks fade and never evict them
{
  type L = { key: string; text: string; offer?: { label: string }; kind?: 'action' | 'ambient'; group?: string }
  const welcome: L = { key: 'w', text: 'Welcome', offer: { label: 'Show me Earth' }, kind: 'action', group: 'objective' }
  const tip: L = { key: 't', text: 'Map tip' }
  check(lineKind(welcome) === 'action' && lineKind(tip) === 'ambient' && lineKind({ key: 'o', text: '', offer: { label: 'x' } }) === 'action' && lineKind({ key: 'k', text: '', kind: 'action' }) === 'action', 'Offers and explicit kinds are actionable; plain remarks are ambient')
  let c = receiveLine(emptyCaptions<L>(), welcome)
  c = receiveLine(c, tip)
  check(c.pinned?.key === 'w' && c.ambient?.key === 't', 'A newer ambient remark does not evict the pending welcome')
  c = expireAmbient(c, 't')
  check(c.pinned?.key === 'w' && c.ambient === null, 'Only the remark times out; the welcome stays')
  check(ambientHoldMs('x'.repeat(100)) > 6500, 'Ambient hold grows with length')
  const sky: L = { key: 's', text: 'Earth set', offer: { label: 'Show me where' }, group: 'sky' }
  c = receiveLine(c, sky)
  check(c.pinned?.key === 'w' && c.queue.length === 1, 'A second actionable line queues instead of replacing the first')
  const step2: L = { key: 'o2', text: 'Walk', offer: { label: 'Walk there' }, kind: 'action', group: 'objective' }
  c = receiveLine(c, step2)
  check(c.pinned?.key === 'o2' && c.queue.length === 1, 'The next objective step replaces the previous step’s line')
  c = resolvePinned(c)
  check(c.pinned?.key === 's' && c.queue.length === 0, 'Acting on or dismissing the pinned line brings the next one')
  c = receiveLine(receiveLine(c, step2), { key: 'r', text: 'reaction', offer: { label: 'x' }, group: 'reaction' })
  c = dropGroup(c, 'objective')
  check(!c.queue.some(l => l.group === 'objective') && c.pinned?.group !== 'objective', 'Free exploration retires objective lines')
  let many = emptyCaptions<L>()
  for (let i = 0; i < 8; i++) many = receiveLine(many, { key: 'a' + i, text: '', offer: { label: 'x' }, group: 'g' + i })
  check(many.pinned?.key === 'a0' && many.queue.length === MAX_PENDING && many.queue.at(-1)!.key === 'a7', 'Pending actionable lines are capped, newest kept')
  const companionSource = readFileSync('src/explore/FieldCompanion.tsx', 'utf8')
  check(/expireAmbient\(s, ambient\.key\)\), ambientHoldMs/.test(companionSource) && !/setTimeout\(\(\) => setState\(resolvePinned/.test(companionSource), 'Only ambient remarks have a timer in the companion')
}

// Phone tools: the most-used tools on the strip, every other tool under a labelled More
{
  const ids = ['map', 'sky', 'time', 'photo', 'journal', 'inspect', 'ask', 'menu'].map(id => ({ id }))
  const wide = groupTools(ids, false)
  check(wide.primary.length === 8 && wide.more.length === 0, 'Desktop keeps every tool on the strip')
  const narrow = groupTools(ids, true)
  check(narrow.primary.map(t => t.id).join() === 'map,sky,time,ask', 'Phones keep Map, Sun & Earth, Time and Ask on the strip')
  check(narrow.more.map(t => t.id).join() === 'photo,journal,inspect,menu', 'Photo, Journal, Inspect and Menu are under More')
  check([...narrow.primary, ...narrow.more].length === ids.length && new Set([...narrow.primary, ...narrow.more].map(t => t.id)).size === ids.length, 'Every tool is reachable exactly once')
  check(NARROW_TOOLS_MAX_WIDTH >= 520, 'Narrow grouping covers a 390 px phone')
  const ui = readFileSync('src/explore/FieldInterface.tsx', 'utf8')
  check(/className="field-tool field-more-button"[^>]*aria-expanded=\{moreOpen\}/.test(ui) && /<span>More<\/span>/.test(ui), 'The More button is labelled and announces its state')
}

// Ask about this: the subject follows what is in front of the visitor; answers use only on-screen values
{
  check(askSubject({ selection: 'antenna', ground: true, tool: 'map', focus: 'lander', objective: 'find' }).kind === 'antenna', 'An open card wins')
  check(askSubject({ selection: null, ground: true, tool: 'map', focus: 'lander', objective: 'find' }).kind === 'ground', 'Then the inspected ground')
  check(askSubject({ selection: null, ground: false, tool: 'sky', focus: 'lander', objective: 'find' }).kind === 'sky', 'Then an open tool')
  check(askSubject({ selection: null, ground: false, tool: null, focus: 'panel', objective: 'find' }).kind === 'panel', 'Then what the reticle is on')
  check(askSubject({ selection: null, ground: false, tool: null, focus: null, objective: 'find' }).kind === 'earth' && askSubject({ selection: null, ground: false, tool: null, focus: null, objective: 'point' }).kind === 'antenna', 'Then the objective step')
  check(askSubject({ selection: null, ground: false, tool: null, focus: null, objective: null }).kind === 'site', 'Otherwise: where you are (the full chat)')
  const values: AskValues = {
    siteName: 'Malapert Massif', sceneUTC: '14 Nov 2026 · 05:00 UTC', heading: 0,
    earth: { az: 10, el: 0.8, skylineEl: 2.3, nextCrossingH: 12.5 }, sun: { az: 120, el: 1.5, skylineEl: 0.4, state: 'above', nextCrossingH: 30 },
    distanceFromLandingM: 3, explorationRadiusM: 250, lander: { name: 'Concept field station', mission: null, distanceM: 8.4, bearingDeg: 107 }, payload: null,
    antenna: { deployed: true, pointingErrorDeg: 0, earthVisible: false, azDeg: 10, elDeg: 0.8, distanceM: 1, bearingDeg: 315 },
    panel: { deployed: false, watts: 0, sunFraction: 1, azDeg: 0, tiltDeg: 0 }, ground: { slopeDeg: 7.25, elevationM: 4980.4, resolutionM: 5 }, decorative: true,
  }
  const why = askSuggestions({ kind: 'antenna', title: 'Antenna', why: 'selected' }, values)
  check(why.length >= 2 && why.length <= 3, 'Two or three suggestions')
  const whyNot = why.find(q => q.id === 'antenna-why-not')
  check(!!whyNot && whyNot.answer.includes('0.8°') && whyNot.answer.includes('2.3°') && whyNot.answer.includes('1.5°') && whyNot.answer.includes('in 12.5 h'), '“Why can’t the antenna see Earth?” uses the Earth clearance against the measured skyline')
  const up = askSuggestions({ kind: 'antenna', title: 'Antenna', why: 'objective' }, { ...values, earth: { ...values.earth, el: 6 }, antenna: { ...values.antenna, earthVisible: true, pointingErrorDeg: 4.25 } })
  check(up.some(q => q.id === 'antenna-see' && /does not establish a radio link/.test(q.answer)) && up.some(q => q.answer.includes('4.3°')), 'With Earth up: geometry answer with the radio-link caveat, and the real pointing error')
  const ground = askSuggestions({ kind: 'ground', title: 'Ground', why: 'inspected' }, values)
  check(ground.some(q => q.answer.includes('7.3°') && q.answer.includes('5 m pixels')) && ground.some(q => q.id === 'ground-rock'), 'Ground answers use the rendered DEM facet slope and pixel size, and label rocks illustrative')
  const all = (['antenna', 'earth', 'panel', 'lander', 'payload', 'ground', 'map', 'sky', 'time', 'journal', 'site'] as const).flatMap(kind => askSuggestions({ kind, title: kind, why: 'here' }, values))
  check(all.every(q => q.question && q.answer && !/\bsafe\b|\bsafety\b|guarantee|will succeed|oxygen|suit telemetry/i.test(q.answer.replace(/hazards aren’t measured|and hazards\. This view/g, ''))), 'No answer claims safety or success, or invents suit readings')
  check(all.every(q => !/NaN|undefined|Infinity/.test(q.answer)), 'Every answer is fully formed')
  const digest = askDigestItems({ kind: 'antenna', title: 'Antenna (illustrative example equipment)', why: 'selected' }, values)
  check(digest.every(d => d.value.length <= 80 && d.label.length <= 80) && digest.some(d => d.id === 'field-ask-antenna' && d.value === '0.0°') && digest.some(d => d.id === 'field-ask-earth' && d.value.includes('2.3°')), 'Her context names the subject and its on-screen values, within the digest limits')
}

// ---- Journey pass: arrival, activities, events, captions, phone surfaces, settings ----------------
{
  const cd = (x: unknown, m: string, d: string) => check(x, `${m} (${d})`)
  // Arrival: distance to the pole from the catalogue latitude (reference sphere), the lander, the time.
  close(poleDistanceM(-90), 0, 1e-9, 'At the pole the distance is zero')
  close(poleDistanceM(-89) / 1000, 30.32, 0.01, 'One degree of latitude is about 30.3 km on the lunar reference sphere')
  const facts = arrivalFacts({ siteName: 'Test site', lat: -86, lonEast: 0, heading: 0, landerDistanceM: 8.4, landerBearingDeg: 107, landerName: 'Concept field station', epoch: new Date(Date.UTC(2026, 10, 14, 12)), radiusM: 250 })
  cd(/121 km from the lunar south pole/.test(facts.pole) && /due south/.test(facts.pole) && /behind you/.test(facts.pole), 'Arrival names the pole distance and direction from where you face', facts.pole)
  check(facts.lander === 'Concept field station 8 m away, 107° to your right' && facts.time === '14 Nov 2026 · 12:00 UTC' && /250 m/.test(facts.scale), 'Arrival names the lander, the time and the walkable area')

  // Sunlight: the two readings come from the panel calculation; the conclusion only restates them.
  const before: PanelReading = { watts: 49.7, azDeg: 0, tiltDeg: 0, sunFraction: 1, sunElDeg: 4.2, skylineElDeg: 1.0 }
  const after: PanelReading = { watts: 778.7, azDeg: 132, tiltDeg: 85.8, sunFraction: 1, sunElDeg: 4.2, skylineElDeg: 1.0 }
  check(!panelTurned(before, { ...before, watts: 49.9 }) && panelTurned(before, after) && panelTurned(before, { ...before, azDeg: 8 }), 'A turn counts after 1 W or 5° of change')
  check(sunlightStage({ before: null, after: null }) === 'deploy' && sunlightStage({ before, after: null }) === 'orient' && sunlightStage({ before, after }) === 'done', 'Sunlight stages follow the readings')
  const found = sunlightConclusion({ before, after })
  cd(found.includes('49.7 W') && found.includes('778.7 W') && found.includes('15.7×') && found.includes('4.2°'), 'The sunlight conclusion uses both calculated readings and the Sun height', found)
  check(!/\bsafe|success|guarantee/i.test(found), 'No success or safety claim in the sunlight conclusion')
  check(/behind the measured skyline/.test(sunlightConclusion({ before, after: { ...after, sunElDeg: 0.2 } })), 'With the Sun hidden, the conclusion says no orientation catches direct light')

  // Events: next set and rise of each body over the measured skyline, from the existing crossing helper.
  const t = (r: number) => { const d = new Date(Date.UTC(2026, 10, 14) + r * 3_600_000); return `${d.getUTCFullYear()}-${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}-${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:00` }
  const series = (f: (r: number) => number): EphRow[] => Array.from({ length: 120 }, (_, r) => ({ t: t(r), az: 90, el: f(r), radiusDeg: 0.27 }))
  const sunUp = series(r => r < 20 || r >= 70 ? 5 : -3), earthUp = series(r => r >= 40 && r < 90 ? 4 : -1)
  const epoch = new Date(Date.UTC(2026, 10, 14, 10))
  const ev = fieldEvents(sunUp, earthUp, flat, epoch, 10, 119)
  const kinds = ev.map(e => e.kind)
  cd(kinds.join(',') === 'sunset,earthrise,sunrise,earthset', 'Events come soonest first: sunset, earthrise, sunrise, earthset', kinds.join(','))
  check(ev.every(e => e.hours > 0 && Math.abs(e.row - 10 - e.hours) < 1e-9), 'Event rows sit the stated hours ahead')
  const sunset = ev[0]
  cd(sunset.row > 19 && sunset.row < 20 && /14 Nov 2026 19:/.test(sunset.atUTC), 'Sunset falls between the last lit hour and the first dark one', sunset.atUTC)
  close(eventTargetRow(sunset, 119), sunset.row + EVENT_SETTLE_H, 1e-9, 'A jump lands 15 minutes after the crossing')
  check(fieldEvents(sunUp, earthUp, flat, epoch, 10, 25).every(e => e.row + EVENT_SETTLE_H <= 25), 'Events beyond the loaded rows are left out')
  check(fieldEvents(series(() => 5), series(() => 5), flat, epoch, 10, 119).length === 0, 'A body that never crosses gives no event')

  // What changed: state words and clearances from snapshots; the position is said to be unchanged.
  const snap = (row: number, sunEl: number, earthEl: number, panelW: number | null): SkySnapshot => ({ row, epoch: new Date(Date.UTC(2026, 10, 14) + row * 3_600_000), sun: { el: sunEl, skylineEl: 2, state: sunEl > 2.3 ? 'above' : 'below' }, earth: { el: earthEl, skylineEl: 2, state: earthEl > 2 ? 'above' : 'below' }, panelW })
  const lines = whatChanged(snap(10, 5, -1, 778.7), snap(19.25, -3, -1, 0))
  cd(/forward 9\.3 hours/.test(lines[0]) && /You stayed where you were/.test(lines[0]), 'Time span and unchanged position are stated', lines[0])
  cd(/Sun: above the skyline → behind the terrain; clearance \+3\.0° → −5\.0°/.test(lines[1]) && /Earth: still behind the terrain/.test(lines[2]), 'Each body says what changed with clearances', lines.slice(1, 3).join(' | '))
  check(lines[3] === 'Example panel at the same orientation: 778.7 W → 0.0 W.', 'The panel line appears when the panel is set up')
  check(whatChanged(snap(10, 5, 4, null), snap(5, 5, 4, null)).length === 3 && /back 5\.0 hours/.test(whatChanged(snap(10, 5, 4, null), snap(5, 5, 4, null))[0]), 'Going back in time is described, and no panel line without a panel')

  // Journey state and next activities.
  let j = newJourney()
  check(nextActivities(j, false).map(a => a.id).join(',') === 'earth,sunlight,time,record', 'All activities are offered at first')
  j = completeActivity({ ...j, active: 'sunlight' }, 'sunlight')
  check(completeActivity(j, 'sunlight') === j && nextActivities(j, true).map(a => a.id).join(',') === 'time,record', 'Done and current activities are not offered again')
  check(ACTIVITIES.length === 4 && ACTIVITIES.every(a => a.title && a.question), 'Every activity states its question')

  // Captions: de-duplication and the waiting count.
  const history = new Map<string, number>()
  check(!isRepeat(history, 'Earth is in view.', 0) && isRepeat(history, 'earth is in view', 1000) && !isRepeat(history, 'Earth is in view.', REPEAT_WINDOW_MS + 1), 'The same words are not repeated within the window, and can return after it')
  check(!isRepeat(history, 'The Sun is behind the terrain.', 2000) && !isRepeat(history, 'Earth is 2.5° high.', 2000) && !isRepeat(history, 'Earth is 2.6° high.', 2000), 'Different words, and different numbers, are never treated as repeats')
  check(waitingCount({ pinned: { key: 'a', text: 'a' }, queue: [{ key: 'b', text: 'b' }], ambient: null }) === 2 && waitingCount(emptyCaptions()) === 0, 'Waiting count covers the pinned line and the queue')

  // Phones: exactly one expanded surface; wider screens keep everything.
  const phone = arrangeSurfaces({ tool: true, ask: true, objective: true, caption: true }, true)
  check(phone.primary === 'ask' && phone.hidden.includes('tool') && phone.hidden.includes('caption'), 'On a phone, Ask is the one expanded surface and the tool waits')
  check(arrangeSurfaces({ pause: true, inspect: true, caption: true }, true).primary === 'pause' && arrangeSurfaces({ objective: true, caption: true }, true).primary === 'objective', 'Pause outranks everything; with nothing open the objective leads')
  check(arrangeSurfaces({ tool: true, ask: true }, false).hidden.length === 0, 'Wider screens hide nothing')

  // Her context: every value fits the digest limit; values are labelled as calculated.
  const digest = journeyDigest({ activity: 'sunlight', activityStep: 'Turn it toward the Sun and keep going for a very long time indeed to test the clip', panel: { deployed: true, watts: 778.7 }, earthClearDeg: 2.34, sunClearDeg: -0.5, nextEvent: sunset, overlay: 'slope', markers: 3 })
  check(digest.every(d => d.value.length <= 80 && d.label.length <= 80), 'Journey digest items fit the 80-character limit')
  check(digest.some(d => d.id === 'field-panel' && d.value === '778.7 W' && d.source === 'calculated') && digest.some(d => d.id === 'field-clearance' && d.value === 'Sun −0.5° / Earth +2.3°'), 'Digest carries the calculated panel output and clearances')

  // Display: quality text and the DEM product name.
  check(qualityText(null).includes('not reported') && qualityText({ level: 'balanced', auto: true, frameMs: 21.4, dpr: 1.25 }) === 'Auto · Balanced now · 21 ms per frame · 1.25× pixel ratio', 'Quality text reports the scene’s level')
  check(demProductText('LOLA LDEM 87S 5 m', 5) === 'LOLA LDEM 87S 5 m, 5 m pixels' && demProductText('', null) === 'LOLA digital elevation model', 'Legend names the DEM product the scene reports')
  check(demProductText('ldem_85s_20m.img', 20) === 'LRO LOLA DEM (ldem_85s_20m.img), 20 m pixels', 'A bare product file name is introduced as the LRO LOLA DEM')

  // Preferences: motion strength, quality and the illustrative lamp.
  check(DEFAULT_SURFACE_PREFERENCES.motionScale === 1 && DEFAULT_SURFACE_PREFERENCES.quality === 'auto' && !DEFAULT_SURFACE_PREFERENCES.suitLamp && !DEFAULT_SURFACE_PREFERENCES.readAloud, 'Defaults: full designed motion, auto quality, lamp and read-aloud off')
  const parsed = parseSurfacePreferences({ motionScale: 3, quality: 'ultra', suitLamp: 'yes' })
  check(parsed.motionScale === 1 && parsed.quality === 'auto' && parsed.suitLamp === false, 'Malformed stored values fall back safely')
  check(parseSurfacePreferences({ motionScale: 0.3, quality: 'low' }).motionScale === 0.3 && parseSurfacePreferences({ quality: 'low' }).quality === 'low', 'Valid choices are kept')
  check(effectiveMotionScale({ motionScale: 0.7 }, true) === 0 && effectiveMotionScale({ motionScale: 0.7 }, false) === 0.7, 'Reduced motion sends no motion to the scene')
}

// Package script and fingerprint safety
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
check(typeof pkg.scripts['verify:field'] === 'string', 'verify:field is registered')

// ---- Equipment drag gate: ordinary look-drags must never aim the example equipment ----
{
  // The reported failure: standing at the deployed, visible antenna with its card CLOSED, a plain drag changed its
  // elevation to −87°. That press must be refused so it reaches the camera instead.
  const reported = { object: 'antenna' as const, button: 0, deployed: true, visible: true, active: null, adjusting: null, pointerLocked: false }
  check(!equipmentDragAllowed(reported), 'Card closed: a drag over the deployed antenna looks around and does not aim it (reported −87° failure)')
  check(!equipmentDragAllowed({ ...reported, active: 'antenna' }), 'Card open but aiming off: a drag still looks around')
  check(!equipmentDragAllowed({ ...reported, adjusting: 'antenna' }), 'Aiming flag without the open card does not aim')
  const aiming = { ...reported, active: 'antenna', adjusting: 'antenna' as const }
  check(equipmentDragAllowed(aiming), 'Card open and "Aim by dragging" on: the drag aims the antenna')
  check(!equipmentDragAllowed({ ...aiming, deployed: false }), 'Packed-away equipment never takes a drag')
  check(!equipmentDragAllowed({ ...aiming, visible: false }), 'Hidden or still-unfolding equipment never takes a drag')
  check(!equipmentDragAllowed({ ...aiming, pointerLocked: true }), 'Under pointer lock the mouse only turns the head')
  check(!equipmentDragAllowed({ ...aiming, button: 2 }), 'Only the primary button aims')
  check(!equipmentDragAllowed({ ...aiming, object: 'panel', active: 'antenna' }), 'Aiming the antenna does not make the panel draggable')
  check(!equipmentDragAllowed({ ...aiming, adjusting: 'panel' }), 'The panel\'s aiming mode does not make the antenna draggable')
  // Source checks: the scene handler returns before stopPropagation when the gate refuses, binds no handlers to
  // packed-away equipment, and releases pointer capture on up, cancel, lost capture, blur, hidden tab and pointer lock.
  const src = readFileSync('src/space/SurfaceEquipment.tsx', 'utf8')
  const down = src.slice(src.indexOf('onPointerDown:'), src.indexOf('onPointerMove:'))
  check(down.indexOf('if(!allowed(event.button))return') >= 0 && down.indexOf('if(!allowed(event.button))return') < down.indexOf('stopPropagation'), 'Refused presses return before stopPropagation, so the camera receives them')
  check(/\{\.\.\.\(p\.equipment\[object\]\?controls:\{\}\)\}/.test(src), 'Packed-away equipment has no pointer handlers')
  for (const ev of ["'pointerup'", "'pointercancel'", "'blur'", "'visibilitychange'", "'pointerlockchange'", 'onLostPointerCapture', 'releasePointerCapture']) check(src.includes(ev), `Equipment drag ends on ${ev}`)
  const card = readFileSync('src/SurfaceInteraction.tsx', 'utf8')
  check(/useEffect\(\(\)=>\(\)=>setEquipmentAdjust\(null\),\[\]\)/.test(card) && /useEffect\(\(\)=>\{setEquipmentAdjust\(null\)\},\[object\]\)/.test(card), 'Closing the card or switching instrument ends aiming mode')
  check(/aria-pressed=\{aiming\}/.test(card), 'Aiming mode is an explicit, accessible toggle in the card')
}

console.log(`Field interface checks passed: ${checks}`)
