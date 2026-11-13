// Spatial terrain overlay, observation markers and Chader Buri's in-scene presence: the pure helpers that decide
// contours, slope, label placement and her staging, plus source checks that keep the overlay DEM-only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  alongBearing, clampRadius, contourCrossings, contourStepFor, CONTOUR_WEIGHT, declutter, declutterCandidates, demLabel, formatDistance, formatElevation,
  HUD_SURFACES, LABEL_PRIORITY, labelOpacity, labelScale, lineOfSightClear, OVERLAY_INK, OVERLAY_LINE_PX, OVERLAY_RAMP, overlayLegend, placeLegend, reliefStats,
  ringsWithin, screenBounds, slopeBand, slopeDeg, trianglesWithin, DEFAULT_OVERLAY_RADIUS_M, OVERLAY_RINGS_M, SLOPE_BANDS_DEG, type HeightSample, type TerrainOverlayInfo,
} from '../src/lib/overlayMath.ts'
import {
  activityCue, aimElevation, appearStep, attentionPose, attentionYaw, BURI_NEAR_M, characterState, CUE_POINT_MS, frameBearing, guideArc, idleHover,
  isAttentive, isSpeaking, pointingTarget, skyDirection, speakingCadence,
} from '../src/lib/characterController.ts'

let checks = 0
const check = (x: unknown, label: string) => { assert.ok(x, label); checks++ }
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol

// --- Synthetic DEMs --------------------------------------------------------------------------
const base = -1800
const flat: HeightSample = () => base
// A plane rising 0.1 m per metre toward the east: slope atan(0.1) = 5.71 degrees.
const ramp: HeightSample = e => base + .1 * e
// A 30 m tall hill centred 40 m north.
const hill: HeightSample = (e, n) => base + 30 * Math.exp(-(e * e + (n - 40) ** 2) / (2 * 8 * 8))
// No data west of the landing point.
const patchy: HeightSample = e => e < 0 ? null : base
const throwing: HeightSample = () => { throw new Error('tile not loaded') }

// --- Radius, rings ----------------------------------------------------------------------------
check(clampRadius(undefined) === DEFAULT_OVERLAY_RADIUS_M && DEFAULT_OVERLAY_RADIUS_M === 120, 'Default overlay radius is 120 m')
check(clampRadius(5) === 20 && clampRadius(9999) === 250 && clampRadius(NaN) === 120, 'Radius is clamped to a sensible range')
check(OVERLAY_RINGS_M.join() === '10,25,50,100', 'Scale rings at 10, 25, 50 and 100 m')
check(ringsWithin(120).length === 4 && ringsWithin(60).join() === '10,25,50' && ringsWithin(20).join() === '10', 'Only rings inside the radius are drawn')

// --- Relief and contour interval ---------------------------------------------------------------
const flatStats = reliefStats(flat, 0, 0, 50, 11)
check(flatStats.min === base && flatStats.max === base && flatStats.known === flatStats.total && flatStats.centre === base, 'Flat DEM: one height, full coverage')
const rampStats = reliefStats(ramp, 0, 0, 100, 21)
check(near(rampStats.min, base - 10) && near(rampStats.max, base + 10), 'Ramp: relief spans the disc only (corners outside the circle are skipped)')
const patchyStats = reliefStats(patchy, 0, 0, 50, 11)
check(patchyStats.known > 0 && patchyStats.known < patchyStats.total, 'Unknown DEM samples are counted, never filled in')
check(reliefStats(throwing, 0, 0, 50, 5).known === 0 && reliefStats(throwing, 0, 0, 50, 5).centre === null, 'A failing sampler yields no data rather than an error')
check(contourStepFor(base, base + 20) === 2 && contourStepFor(base, base + 3) === .5 && contourStepFor(base, base + 300) === 50, 'Contour step follows the local relief (about ten lines)')
check(contourStepFor(base, base) === .5 && contourStepFor(NaN, NaN) === .5, 'Flat or unknown relief falls back to the finest supported step')
check(contourStepFor(base, base + 20, 4) === 4 && contourStepFor(base, base + 20, -1) === 2 && contourStepFor(base, base + 20, 0) === 2, 'A positive override wins; invalid overrides are ignored')

// --- Slope from neighbouring samples ------------------------------------------------------------
check(near(slopeDeg(ramp, 3, 7, 5)!, Math.atan(.1) * 180 / Math.PI), 'Slope of a 10% ramp is 5.71 degrees from central differences')
check(slopeDeg(flat, 0, 0, 5) === 0, 'Flat ground has zero slope')
check(slopeDeg(patchy, 0, 0, 5) === null, 'Slope is unknown where a neighbour has no DEM sample')
check(slopeBand(0) === 0 && slopeBand(5) === 1 && slopeBand(12) === 2 && slopeBand(19.9) === 3 && slopeBand(35) === 4, 'Slope bands at 5, 10, 15 and 20 degrees')
check(SLOPE_BANDS_DEG.join() === '5,10,15,20', 'Slope band edges')

// --- Labels: line of sight, crossings, declutter, size and fade -------------------------------------
const eye = { eastM: 0, northM: 0, h: base + 1.7 }
check(lineOfSightClear(flat, eye, { eastM: 0, northM: 80, h: base + .2 }), 'A label on flat ground is visible')
check(!lineOfSightClear(hill, eye, { eastM: 0, northM: 80, h: base + .2 }), 'A label behind the hill is hidden by the DEM')
check(lineOfSightClear(hill, eye, { eastM: 0, northM: 40, h: base + 31 }), 'A label on the hilltop is visible')
check(lineOfSightClear(patchy, { eastM: 30, northM: 0, h: base + 1.7 }, { eastM: -40, northM: 0, h: base + .2 }), 'Unknown ground never hides a label')
const profile = Array.from({ length: 60 }, (_, k) => { const d = 6 + k * 1.5; return { distM: d, h: ramp(d, 0) } })
const crossings = contourCrossings(profile, .5, 5, 12, 3)
check(crossings.length === 3 && crossings.every(c => near(Math.abs((c.level / 2.5) % 1), 0, 1e-9)), 'Index contour labels sit on multiples of five steps')
check(crossings.every((c, i) => i === 0 || c.distM - crossings[i - 1].distM >= 12) && near(ramp(crossings[0].distM, 0), crossings[0].level, 1e-9), 'Crossings are where the DEM equals the level, at least the minimum gap apart')
check(contourCrossings(profile.map(p => ({ ...p, h: null })), 1).length === 0 && contourCrossings(profile, 0).length === 0, 'No labels without data or without a step')
const boxes = [
  { x: 100, y: 100, w: 60, h: 16, priority: 1 },
  { x: 110, y: 104, w: 60, h: 16, priority: 4 },
  { x: 300, y: 100, w: 60, h: 16, priority: 1 },
]
check(declutter(boxes).join() === 'false,true,true', 'Overlapping labels: the higher priority one stays')
check(declutter([]).length === 0, 'Declutter of nothing is nothing')
check(labelScale(0) === 1 && labelScale(1000) === .78 && labelScale(60) < 1 && labelScale(60) > .78, 'Label size is clamped')
check(labelOpacity(10, 120) === 1 && labelOpacity(120, 120) === 0 && labelOpacity(105, 120) > 0 && labelOpacity(105, 120) < 1, 'Labels fade over the outer quarter of the radius')
const p = alongBearing(0, 0, 90, 10)
check(near(p.eastM, 10) && near(p.northM, 0) && near(alongBearing(0, 0, 0, 10).northM, 10), 'Bearings: 0 is north, 90 is east')

// --- Footprint: only the terrain triangles under the disc are drawn again --------------------------------
{
  // A 3 x 3 grid of 10 m cells (two triangles each), positions in "units" scaled by 10 to metres.
  const pos: number[] = [], idx: number[] = []
  for (let j = 0; j <= 3; j++) for (let i = 0; i <= 3; i++) pos.push(i, 0, j)
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const a = j * 4 + i; idx.push(a, a + 4, a + 1, a + 1, a + 4, a + 5) }
  const all = trianglesWithin(pos, idx, 10, 15, 15, 100), centre = trianglesWithin(pos, idx, 10, 15, 15, 2), none = trianglesWithin(pos, idx, 10, 200, 200, 5)
  check(all.length === idx.length && centre.length === 6 && none.length === 0, 'Footprint keeps triangles under the disc only (including a disc inside one cell)')
  check([...centre].every(v => [5, 6, 9, 10].includes(v)), 'Footprint reuses the terrain vertex indices unchanged')
}

// --- Formatting and source labelling ----------------------------------------------------------------
check(formatElevation(-1795.4) === '−1,795 m' && formatElevation(12) === '12 m' && formatElevation(-0.2) === '0 m', 'Elevations use a true minus sign and separators')
check(formatDistance(4.26) === '4.3 m' && formatDistance(12.6) === '13 m', 'Distances read naturally')
check(demLabel({ spacingM: 5, credit: 'NASA LRO LOLA; interpolated' }) === 'LRO LOLA DEM, 5 m/px', 'The DEM product and resolution are named')
check(demLabel({ spacingM: 1895.21, credit: 'NASA LRO LOLA' }) === 'LRO LOLA DEM, 1,895 m/px', 'Coarse products are named with their resolution')
const manifest = JSON.parse(readFileSync('public/data/terrain/manifest.json', 'utf8')) as { datasets: { key: string; spacingM: number; credit: string }[] }
check(manifest.datasets.every(d => /LOLA/.test(d.credit)) && manifest.datasets.some(d => d.spacingM === 5), 'Every shipped terrain product is LOLA-credited (5 m site DEM present)')

// --- Overlay source: DEM only, drawn as a pass over the terrain mesh --------------------------------
const overlay = readFileSync('src/space/TerrainOverlay.tsx', 'utf8'), markers = readFileSync('src/space/FieldMarkers.tsx', 'utf8')
const shared = readFileSync('src/space/overlayShared.ts', 'utf8')
check(/logdepthbuf_vertex/.test(overlay) && /logdepthbuf_fragment/.test(overlay) && /depthWrite: false/.test(overlay) && /LessEqualDepth/.test(overlay), 'The overlay shares the terrain depth (log depth, equal-depth test, no depth writes)')
check(/runtime\.terrainMesh/.test(overlay) && /terrain\.geometry/.test(overlay), 'The overlay drapes on the rendered DEM mesh itself')
check(/visitTerrainSampler/.test(shared) && /store\.choose/.test(shared), 'Overlay heights come from the existing sampler, pinned to the dataset the mesh is built from')
check(!/SurfaceRocks|rockLayout|SurfaceEquipment/.test(overlay + markers), 'Illustrative rocks and equipment are never read by the overlay or markers')
check(!/hazard|unsafe|safe to|composition|ilmenite|\bice\b|regolith type/i.test(overlay + markers), 'No hazard or composition claims in overlay or marker UI')
check(/product/.test(overlay) && /demLabel\(/.test(overlay), 'The legend names the DEM product and resolution')
check(/raycast = \(\) => \{\}/.test(overlay), 'The overlay never intercepts clicks or terrain probes')

// --- Chader Buri presence ---------------------------------------------------------------------------
const idle = characterState({ busy: false, reply: null, line: null, now: 0 })
const pointingSun = characterState({ busy: false, reply: { message: 'There.', focus: 'sun', at: 0 }, line: null, now: 100 })
check(pointingTarget(idle) === null && pointingTarget(pointingSun) === 'sun', 'She points while her reply is about a sky target')
check(pointingTarget(idle, 'earth') === 'earth' && pointingTarget(pointingSun, null) === null && pointingTarget(idle, 'lander') === 'lander', 'An explicit pointAt wins; null stops pointing')
check(isSpeaking(pointingSun) && !isSpeaking(idle) && isSpeaking(idle, true) && !isSpeaking(pointingSun, false), 'Speaking follows her bubble unless told otherwise')
check(isAttentive(characterState({ busy: true, reply: null, line: null, now: 0 })) && !isAttentive(idle) && isAttentive(idle, true), 'Attentive while asked or listening')
const up = skyDirection(0, 90), east = skyDirection(90, 0), north = skyDirection(0, 0)
check(near(up.y, 1) && near(east.x, 1) && near(north.z, -1), 'Sky directions: north is -z, east is +x in the surface frame')
check(near(frameBearing(1, 0), 90) && near(frameBearing(0, -1), 0) && near(frameBearing(0, 1), 180), 'Frame bearings match compass bearings')
check(attentionYaw(90, null, true) === 0 && attentionYaw(90, null, false) === 9, 'Attentive: she faces the visitor; otherwise a slight idle turn')
check(attentionYaw(0, 30, false) === 15 && attentionYaw(0, 170, false) === 18 && attentionYaw(10, 350, true) === -10, 'Pointing turn is half the angle, clamped, and wraps through north')
const arc = guideArc({ x: 0, y: 1, z: 0 }, { x: 10, y: 1, z: 0 }, 2, 10)
check(arc.length === 33 && arc[0] === 0 && arc[1] === 1 && near(arc[30], 10) && near(arc[16], 2) && near(arc[15], 5), 'Guide arc: ends on the target, lifted by half the lift at its middle')
check(appearStep(0, 1, .55, false) === .5 && appearStep(.5, 1, 10, false) === 1 && appearStep(1, 0, .35, false) === .5, 'Materialise and dematerialise run at their durations')
check(appearStep(0, 1, 0, true) === 1 && appearStep(1, 0, 0, true) === 0, 'Reduced motion: she appears and leaves without a transition')
check(speakingCadence(1.234, true) === speakingCadence(9.87, true) && speakingCadence(1, false) !== speakingCadence(1.3, false), 'Speaking glow is static under reduced motion')
check([0, .3, 1.7, 5.2, 11].every(t => speakingCadence(t, false) >= 0 && speakingCadence(t, false) <= 1), 'Speaking cadence stays in range')
check(idleHover(3.3, true) === 0 && Math.abs(idleHover(3.3, false)) <= .017, 'Idle hover is a few millimetres, none under reduced motion')

const figure = readFileSync('src/space/BuriFigure.tsx', 'utf8')
const position = figure.match(/BURI_POSITION\s*=\s*\{\s*eastM:\s*([-\d.]+),\s*northM:\s*([-\d.]+)/)
check(position && Number(position[1]) === 4.6 && Number(position[2]) === -.2, 'BURI_POSITION is unchanged')
check(/chader-buri-guide\.webp/.test(figure) && !/GLTFLoader|useGLTF|\.glb/.test(figure), 'She is still the approved artwork, not a new model')
check(/onSelect\?\.\(\)/.test(figure), 'Her click target still selects her')
check(!/invalidate\(\)\s*\n?\s*\}\s*$/.test(figure) && !/pose !== 'idle' && !reduced\) invalidate/.test(figure), 'She no longer forces continuous rendering while talking')

// --- Readability pass: lines, labels, legend ------------------------------------------------------
{
  // Lines: a light core over a dark under-stroke, never under 1.5 px; index contours wider; one ramp without red.
  check(OVERLAY_LINE_PX.minor >= 1.5 && OVERLAY_LINE_PX.index > OVERLAY_LINE_PX.minor && OVERLAY_LINE_PX.ring >= 1.5, 'Contour and ring cores stay at least 1.5 px wide; index contours are wider')
  check(OVERLAY_LINE_PX.minorHalo > OVERLAY_LINE_PX.minor + 2 && OVERLAY_LINE_PX.indexHalo > OVERLAY_LINE_PX.index + 2, 'Every line has a wider dark under-stroke')
  const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2] }
  const contrast = (a: string, b: string) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05) }
  check(contrast(OVERLAY_INK.index, OVERLAY_INK.halo) > 15 && contrast(OVERLAY_INK.minor, OVERLAY_INK.halo) > 12 && contrast(OVERLAY_INK.ring, OVERLAY_INK.halo) > 12, 'Line cores contrast strongly with their under-stroke')
  check(contrast(OVERLAY_INK.index, '#8a8a8a') > 3, 'Index contours stand out from mid-grey regolith')
  const hue = (hex: string) => { const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return 0; const h = mx === r ? (g - b) / (mx - mn) : mx === g ? 2 + (b - r) / (mx - mn) : 4 + (r - g) / (mx - mn); return (h * 60 + 360) % 360 }
  check(OVERLAY_RAMP.length === SLOPE_BANDS_DEG.length + 1 && OVERLAY_RAMP.every(c => hue(c) > 40 && hue(c) < 260), 'One five-step ramp (blue to pale yellow, no reds) serves slope bands and elevation')
  check(OVERLAY_RAMP.every((c, i) => i === 0 || lum(c) > lum(OVERLAY_RAMP[i - 1])), 'The ramp gets steadily lighter (readable without colour)')
  check(CONTOUR_WEIGHT.contours === 1 && CONTOUR_WEIGHT.slope > 0 && CONTOUR_WEIGHT.elevation > 0, 'Contours are drawn in every mode, lighter under a tint')

  // Labels: priority, alternatives, blocked areas.
  check(LABEL_PRIORITY.landmark > LABEL_PRIORITY.contour && LABEL_PRIORITY.contour > LABEL_PRIORITY.ring, 'Label priority: landmarks, then index contours, then rings')
  const lander = { x: 200, y: 200, w: 120, h: 160, owner: 'lander' }
  const items = [
    { candidates: [{ x: 210, y: 210 }, { x: 420, y: 210 }], w: 40, h: 14, priority: LABEL_PRIORITY.ring },
    { candidates: [{ x: 200, y: 110 }], w: 90, h: 18, priority: LABEL_PRIORITY.landmark },
    { candidates: [{ x: 230, y: 230 }], w: 50, h: 14, priority: LABEL_PRIORITY.contour },
    { candidates: [{ x: 425, y: 212 }], w: 50, h: 14, priority: LABEL_PRIORITY.contour },
  ]
  const chosen = declutterCandidates(items, 4, [lander], { width: 800, height: 600 }, [undefined, 'lander', undefined, undefined])
  check(chosen[1] === 0, 'The lander keeps its own pin even where it touches the lander')
  check(chosen[2] === -1, 'No label sits over the lander')
  check(chosen[3] === 0 && chosen[0] === -1, 'A higher-priority contour label wins the free spot; the ring label, blocked at both spots, hides')
  check(declutterCandidates([{ candidates: [{ x: 5, y: 300 }, { x: 60, y: 300 }], w: 40, h: 14, priority: 1 }], 4, [], { width: 800, height: 600, margin: 2 })[0] === 1, 'Labels never hang off the edge of the view')
  check(declutter([{ x: 10, y: 10, w: 10, h: 10, priority: 1 }], 4, [{ x: 12, y: 12, w: 30, h: 30 }]).join() === 'false', 'Declutter honours blocked HUD areas')
  const b = screenBounds([{ x: 10, y: 20 }, null, { x: 50, y: 80 }], 2)
  check(!!b && b.x === 30 && b.y === 50 && b.w === 44 && b.h === 64 && screenBounds([null]) === null, 'Screen bounds of projected corners')
  check(HUD_SURFACES.includes('.field-companion') && HUD_SURFACES.includes('.field-strip') && HUD_SURFACES.includes('.field-objective') && HUD_SURFACES.includes('.field-sheet'), 'Scene labels keep off captions, toolbar, cards and sheets')

  // Legend wording: DEM product and resolution; slope is the rendered facet slope, not a hazard.
  const info: TerrainOverlayInfo = { mode: 'slope', product: 'LRO LOLA DEM, 20 m/px', source: 'ldem', credit: 'NASA LRO LOLA', spacingM: 20, radiusM: 120, contourStepM: 1, minM: 5167.2, maxM: 5173.5, coverage: 1, slopeHereDeg: 1.5, coarse: false }
  const slope = overlayLegend('slope', info), elev = overlayLegend('elevation', info), cont = overlayLegend('contours', info)
  check([slope, elev, cont].every(l => l.source.includes('LRO LOLA DEM, 20 m/px') && l.lines.minor === 'every 1 m' && /every 5 m/.test(l.lines.index)), 'Every mode states the DEM product, resolution and contour interval')
  check(/rendered DEM facets/i.test(slope.title) && /20 m resolution/.test(slope.note) && /not a measured landing hazard/.test(slope.note), 'Slope is the rendered DEM facet slope at that resolution, not a measured landing hazard')
  check(slope.key.kind === 'bands' && slope.key.stops.map(s => s.label).join() === '0°,5°,10°,15°,20°' && slope.key.stops.every((s, i) => s.colour === OVERLAY_RAMP[i]), 'Slope bands use the shared ramp at 0, 5, 10, 15 and 20 degrees')
  check(elev.key.kind === 'ramp' && elev.key.from === '5,167 m' && elev.key.to === '5,174 m' && elev.key.colours === OVERLAY_RAMP, 'Elevation runs the same ramp over the DEM range in the disc')
  check(cont.key.kind === 'lines' && !/\bsafe|unsafe|trafficab/i.test([slope, elev, cont].map(l => l.title + l.note + l.source).join(' ')), 'No safety grading in any legend')
  check(overlayLegend('contours', null, 'LOLA LDEM, 5 m pixels').source.startsWith('LOLA LDEM, 5 m pixels'), 'Before the overlay reports, the legend names the DEM the field knows')
  check(/interpolated/.test(overlayLegend('elevation', { ...info, coarse: true }).source), 'A coarse DEM is called out as interpolated')

  // Legend placement: beside the toolbar on a wide desktop, above it on a tablet, beside a sheet, compact on phones.
  const legend = { full: { w: 272, h: 150 }, compact: { w: 196, h: 96 } }
  const hits = (s: { left: number; top: number; compact: boolean }, rects: { left: number; top: number; right: number; bottom: number }[]) => rects.some(o => s.left < o.right && s.left + (s.compact ? 196 : 272) > o.left && s.top < o.bottom && s.top + (s.compact ? 96 : 150) > o.top)
  const desk = { width: 1440, height: 900, edge: 16, ...legend, toolbar: { left: 414, top: 820, right: 1026, bottom: 884 }, corner: { left: 1380, top: 16, right: 1424, bottom: 60 } }
  const caption = { left: 16, top: 640, right: 486, bottom: 806 }, objective = { left: 16, top: 100, right: 356, bottom: 436 }
  const d1 = placeLegend({ ...desk, obstacles: [desk.toolbar, desk.corner, caption, objective] })
  check(d1?.anchor === 'beside-toolbar' && !d1.compact && d1.left + 272 === 1424 && d1.top + 150 === 884, 'Desktop: bottom right, level with the toolbar')
  const sheet = { left: 1024, top: 92, right: 1424, bottom: 790 }
  const d2 = placeLegend({ ...desk, obstacles: [desk.toolbar, desk.corner, caption, objective, sheet] })
  check(d2?.anchor === 'beside-sheet' && d2.left + 272 <= 1024 - 10 && d2.top + 150 <= 820 - 10 && !hits(d2, [caption, objective]), 'Desktop with a sheet open: beside the sheet, above the toolbar, clear of captions and cards')
  const tab = { width: 1024, height: 768, edge: 16, ...legend, toolbar: { left: 206, top: 688, right: 818, bottom: 752 }, corner: { left: 964, top: 16, right: 1008, bottom: 60 } }
  const t1 = placeLegend({ ...tab, obstacles: [tab.toolbar, tab.corner, { left: 16, top: 520, right: 486, bottom: 658 }] })
  check(t1?.anchor === 'above-toolbar' && t1.top + 150 <= 688 - 10, 'Tablet: bottom right, above the toolbar')
  const tabSheet = { left: 512, top: 92, right: 1008, bottom: 658 }, tabCaption = { left: 16, top: 400, right: 488, bottom: 658 }
  const t2 = placeLegend({ ...tab, obstacles: [tab.toolbar, tab.corner, tabCaption, tabSheet] })
  check(t2 === null || !hits(t2, [tab.toolbar, tabSheet, tabCaption]), 'Tablet with a sheet: never over the sheet, captions or toolbar')
  const phone = { width: 390, height: 844, edge: 8, ...legend, toolbar: { left: 8, top: 774, right: 382, bottom: 836 }, corner: { left: 338, top: 8, right: 382, bottom: 52 } }
  const p1 = placeLegend({ ...phone, obstacles: [phone.toolbar, phone.corner, { left: 8, top: 60, right: 382, bottom: 140 }, { left: 8, top: 200, right: 172, bottom: 682 }] })
  check(p1?.compact === true && p1.left >= 182 && p1.top + 96 <= 774 - 10, 'Phone: a compact legend right of the captions, above the toolbar')
  const p0 = placeLegend({ ...phone, compactFirst: true, obstacles: [phone.toolbar, phone.corner, { left: 8, top: 60, right: 382, bottom: 140 }, { left: 8, top: 200, right: 172, bottom: 682 }] })
  check(p0?.compact === true && p0.anchor === 'above-toolbar', 'Phone: compact first, so the legend takes as little of the view as possible')
  const tabCards = [tab.toolbar, tab.corner, { left: 16, top: 16, right: 270, bottom: 126 }, { left: 16, top: 136, right: 356, bottom: 215 }, { left: 78, top: 410, right: 486, bottom: 672 }, { left: 608, top: 104, right: 1008, bottom: 672 }]
  const t3 = placeLegend({ ...tab, obstacles: tabCards, leftTop: 225 })
  check(t3?.anchor === 'below-cards' && t3.left === 16 && t3.top === 225 && !hits(t3, tabCards), 'Tablet with a sheet and captions: the left column below the objective card (from --f-left-top)')
  check(placeLegend({ ...phone, obstacles: [phone.toolbar, phone.corner, { left: 8, top: 60, right: 382, bottom: 140 }, { left: 8, top: 300, right: 382, bottom: 758 }] }) === null, 'Phone with a bottom sheet open: no room, so no legend (the map sheet has it)')
}

// --- Chader Buri: attention and activity cues ------------------------------------------------------
{
  check(attentionPose({ visitorBearing: 90, pointBearing: null, lookBearing: 150, attentive: false, near: true }) === 0 && attentionPose({ visitorBearing: 90, pointBearing: null, lookBearing: 150, attentive: true, near: false }) === 0, 'Near or addressed: she faces the visitor')
  check(attentionPose({ visitorBearing: 90, pointBearing: null, lookBearing: 150, attentive: false, near: false }) === 24 && attentionPose({ visitorBearing: 90, pointBearing: null, lookBearing: 110, attentive: false, near: false }) === 10, 'Otherwise she turns toward the object or activity target (clamped so the projection never goes edge-on)')
  check(attentionPose({ visitorBearing: 0, pointBearing: 30, lookBearing: 300, attentive: true, near: true }) === 15, 'While pointing she turns partly toward the target')
  check(attentionPose({ visitorBearing: 90, pointBearing: null, lookBearing: null, attentive: false, near: false }) === 9, 'Idle: a slight turn')
  check(BURI_NEAR_M >= 2.5 && BURI_NEAR_M <= 4 && CUE_POINT_MS >= 4000 && CUE_POINT_MS <= 9000, 'Near distance and pointing duration are restrained')
  check(aimElevation(-3) === 2 && aimElevation(12) === 12, 'A body below the skyline is shown at the skyline, never into the ground')
  const find = activityCue({ objective: 'find', activity: null, selection: null })
  const walk = activityCue({ objective: 'walk', activity: null, selection: null }), aim = activityCue({ objective: 'point', activity: 'earth', selection: 'antenna' })
  check(find.point === 'earth' && find.key === 'objective:find' && find.look === null, 'Find Earth: she points at Earth')
  check(walk.point === 'antenna' && walk.look === 'antenna' && aim.point === 'antenna' && walk.key !== aim.key, 'Walk to and point the antenna: she points at the antenna, once per step')
  const deploy = activityCue({ objective: 'find', activity: 'sunlight', sunlight: 'deploy', selection: null }), orient = activityCue({ objective: 'find', activity: 'sunlight', sunlight: 'orient', selection: 'panel' })
  check(deploy.point === 'panel' && orient.point === 'sun' && orient.look === 'panel', 'Investigate sunlight: the panel, then the Sun')
  check(activityCue({ objective: null, activity: 'time', selection: null }).point === null && activityCue({ objective: 'done', activity: null, selection: 'payload' }).look === 'lander', 'No automatic pointing in time travel (events point themselves); an open card is what she faces')
  check(activityCue({ objective: 'find', activity: null, selection: null }).key === find.key, 'The same step gives the same key (no repeated pointing)')
}
const fieldUi = readFileSync('src/explore/FieldInterface.tsx', 'utf8'), legendUi = readFileSync('src/explore/OverlayLegend.tsx', 'utf8')
check(/activityCue\(/.test(fieldUi) && /point\(cue\.point\)/.test(fieldUi) && /lookAt: cue\.look/.test(fieldUi) && /point\(e\.body\)/.test(fieldUi), 'Field state drives her cue (activity steps and time events)')
check(/<OverlayLegend variant="hud"/.test(fieldUi) && /placeLegend\(/.test(legendUi) && /HUD_SURFACES/.test(legendUi), 'The HUD legend is placed from the measured HUD panels')
check(/useGroundContacts\(/.test(figure) && /aimElevation\(/.test(figure) && /attentionPose\(/.test(figure), 'Her emitter lies on the rendered facet; sky aims stay above ground; attention follows the cue')
check(/OVERLAY_RAMP/.test(overlay) && /uLineWeight/.test(overlay) && !/'#e8536a'|'#f39a3c'/.test(overlay), 'The overlay uses the shared ramp and line weights (old red slope colours gone)')

console.log(`Terrain overlay, field marker and Chader Buri presence checks passed: ${checks}.`)
