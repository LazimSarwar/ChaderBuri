// Pure helpers for the in-scene terrain overlay and observation markers. Every value they produce comes from
// a DEM sampler that is passed in (metres above the lunar reference sphere at an east/north offset), so they
// can be unit-tested with synthetic terrain. Nothing here knows about rocks or equipment.

export type HeightSample = (eastM: number, northM: number) => number | null
export type OverlayMode = 'off' | 'contours' | 'slope' | 'elevation'

/** Scale rings drawn around the visitor (metres). */
export const OVERLAY_RINGS_M = [10, 25, 50, 100] as const
export const DEFAULT_OVERLAY_RADIUS_M = 120
export const MIN_OVERLAY_RADIUS_M = 20
export const MAX_OVERLAY_RADIUS_M = 250
/** Slope band edges in degrees. Bands describe the measured angle only, not trafficability. */
export const SLOPE_BANDS_DEG = [5, 10, 15, 20] as const
/** Contour intervals the overlay chooses from (metres). Half a metre is the floor: finer than that is
 * below what an interpolated LOLA product supports. */
export const CONTOUR_STEPS_M = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500] as const
/** Every fifth contour is an index contour (drawn brighter and the only one labelled). */
export const INDEX_EVERY = 5

export const clampRadius = (radiusM: number | undefined) =>
  Number.isFinite(radiusM) ? Math.min(MAX_OVERLAY_RADIUS_M, Math.max(MIN_OVERLAY_RADIUS_M, radiusM as number)) : DEFAULT_OVERLAY_RADIUS_M

export const ringsWithin = (radiusM: number) => OVERLAY_RINGS_M.filter(r => r <= radiusM + 1e-9)

export type ReliefStats = { min: number; max: number; known: number; total: number; centre: number | null }

/**
 * Minimum, maximum and coverage of the DEM inside a disc (sampled on an n x n grid, cells outside the disc skipped).
 * Unknown samples are counted, never filled in.
 */
export function reliefStats(sample: HeightSample, eastM: number, northM: number, radiusM: number, n = 25): ReliefStats {
  let min = Infinity, max = -Infinity, known = 0, total = 0
  const step = (2 * radiusM) / (n - 1)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const de = -radiusM + i * step, dn = -radiusM + j * step
    if (de * de + dn * dn > radiusM * radiusM + 1e-9) continue
    total++
    const h = safe(sample, eastM + de, northM + dn)
    if (h === null) continue
    known++
    if (h < min) min = h
    if (h > max) max = h
  }
  return { min, max, known, total, centre: safe(sample, eastM, northM) }
}

/**
 * A round contour interval for the local relief: the smallest listed step that gives no more than `targetLines`
 * contours across the range. An explicit override wins when it is a positive finite number.
 */
export function contourStepFor(min: number, max: number, override?: number, targetLines = 10) {
  if (override !== undefined && Number.isFinite(override) && override > 0) return override
  const range = max - min
  if (!Number.isFinite(range) || range <= 0) return CONTOUR_STEPS_M[0]
  return CONTOUR_STEPS_M.find(s => range / s <= targetLines) ?? CONTOUR_STEPS_M[CONTOUR_STEPS_M.length - 1]
}

/** Slope angle (degrees) by central differences between neighbouring DEM samples `spacingM` apart. */
export function slopeDeg(sample: HeightSample, eastM: number, northM: number, spacingM: number): number | null {
  const e1 = safe(sample, eastM + spacingM, northM), e0 = safe(sample, eastM - spacingM, northM)
  const n1 = safe(sample, eastM, northM + spacingM), n0 = safe(sample, eastM, northM - spacingM)
  if (e1 === null || e0 === null || n1 === null || n0 === null) return null
  const dzE = (e1 - e0) / (2 * spacingM), dzN = (n1 - n0) / (2 * spacingM)
  return Math.atan(Math.hypot(dzE, dzN)) * 180 / Math.PI
}

/** Index (0..bands) of the slope band an angle falls into. */
export const slopeBand = (deg: number) => SLOPE_BANDS_DEG.filter(edge => deg >= edge).length

/** Elevation with a true minus sign and thousands separators, e.g. "−1,795 m". */
export function formatElevation(m: number, decimals = 0) {
  const text = Math.abs(m).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
  return `${m < -0.5 * 10 ** -decimals ? '−' : ''}${text} m`
}
export const formatDistance = (m: number) => m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`

/**
 * True when the DEM does not rise above the straight sight line between two points (heights are absolute, metres).
 * Ends are skipped by `endClearM` so the ground under the eye and under the label never blocks itself; unknown
 * ground does not block.
 */
export function lineOfSightClear(sample: HeightSample, from: { eastM: number; northM: number; h: number }, to: { eastM: number; northM: number; h: number }, steps = 24, toleranceM = .15, endClearM = 1.5) {
  const length = Math.hypot(to.eastM - from.eastM, to.northM - from.northM)
  if (length <= 2 * endClearM) return true
  for (let k = 1; k < steps; k++) {
    const t = k / steps, along = t * length
    if (along < endClearM || length - along < endClearM) continue
    const ground = safe(sample, from.eastM + (to.eastM - from.eastM) * t, from.northM + (to.northM - from.northM) * t)
    if (ground !== null && ground > from.h + (to.h - from.h) * t + toleranceM) return false
  }
  return true
}

/**
 * Where index contours cross a straight profile. Returns crossing distances and levels, at least `minGapM` apart,
 * at most `max` of them, nearest first. Used to place a few elevation labels where the visitor is looking.
 */
export function contourCrossings(profile: { distM: number; h: number | null }[], stepM: number, every = INDEX_EVERY, minGapM = 12, max = 3) {
  const out: { distM: number; level: number }[] = []
  const unit = stepM * every
  if (!(unit > 0)) return out
  for (let k = 1; k < profile.length && out.length < max; k++) {
    const a = profile[k - 1], b = profile[k]
    if (a.h === null || b.h === null || a.h === b.h) continue
    const la = Math.floor(a.h / unit), lb = Math.floor(b.h / unit)
    if (la === lb) continue
    const level = Math.max(la, lb) * unit, t = (level - a.h) / (b.h - a.h)
    if (t < 0 || t > 1) continue
    const distM = a.distM + (b.distM - a.distM) * t
    if (out.some(o => Math.abs(o.distM - distM) < minGapM)) continue
    out.push({ distM, level })
  }
  return out
}

/** Label size clamp: full size near, never smaller than 78% far away. */
export const labelScale = (distanceM: number) => Math.min(1, Math.max(.78, 1.08 - distanceM / 220))
/** Labels fade out over the outer quarter of the overlay radius. */
export function labelOpacity(distanceM: number, radiusM: number) {
  const start = radiusM * .75
  if (distanceM <= start) return 1
  if (distanceM >= radiusM) return 0
  const t = (distanceM - start) / (radiusM - start)
  return 1 - t * t * (3 - 2 * t)
}

export type ScreenBox = { x: number; y: number; w: number; h: number; priority: number }
/** A screen rectangle by its centre and size (CSS pixels), the same convention as ScreenBox. */
export type ScreenRect = { x: number; y: number; w: number; h: number }
/** Label priorities: what survives a crowded view first. */
export const LABEL_PRIORITY = { landmark: 5, north: 4, contour: 3, ring: 2 } as const

const overlaps = (a: ScreenRect, b: ScreenRect, pad: number) => Math.abs(a.x - b.x) * 2 < a.w + b.w + 2 * pad && Math.abs(a.y - b.y) * 2 < a.h + b.h + 2 * pad

/**
 * Greedy screen-space declutter: higher priority first (then nearer to the top of the list); a label whose box
 * overlaps one already kept or a blocked area (with `pad` pixels of air) is hidden. Returns keep flags in input order.
 */
export function declutter(boxes: ScreenBox[], pad = 4, blocked: ScreenRect[] = []) {
  return declutterCandidates(boxes.map(b => ({ candidates: [{ x: b.x, y: b.y }], w: b.w, h: b.h, priority: b.priority })), pad, blocked).map(c => c >= 0)
}

/**
 * Declutter where each label may stand at one of several candidate centres (tried in order). Higher priority labels
 * choose first; a candidate is taken when it overlaps neither a kept label nor a blocked area (the lander, the
 * guide, HUD panels) and keeps `margin` px inside the view when `view` is given. Returns the chosen candidate index
 * per label, or -1 when every candidate is blocked.
 */
export function declutterCandidates(items: { candidates: { x: number; y: number }[]; w: number; h: number; priority: number }[], pad = 4, blocked: (ScreenRect & { owner?: string })[] = [], view?: { width: number; height: number; margin?: number }, owners?: (string | undefined)[]) {
  const order = items.map((_, i) => i).sort((a, b) => items[b].priority - items[a].priority || a - b)
  const chosen = items.map(() => -1), kept: ScreenRect[] = []
  for (const i of order) {
    const it = items[i], owner = owners?.[i]
    for (let c = 0; c < it.candidates.length; c++) {
      const box = { x: it.candidates[c].x, y: it.candidates[c].y, w: it.w, h: it.h }
      if (view) {
        const m = view.margin ?? 0
        if (box.x - box.w / 2 < m || box.x + box.w / 2 > view.width - m || box.y - box.h / 2 < m || box.y + box.h / 2 > view.height - m) continue
      }
      // A blocked area never hides its own label (the lander's pin may touch the lander).
      if (blocked.some(b => !(b.owner !== undefined && b.owner === owner) && overlaps(b, box, pad))) continue
      if (kept.some(k => overlaps(k, box, pad))) continue
      chosen[i] = c; kept.push(box); break
    }
  }
  return chosen
}

/** Screen bounds (centre/size) of a set of projected points, or null when none is in front of the camera. */
export function screenBounds(points: ({ x: number; y: number } | null)[], grow = 0): ScreenRect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const p of points) { if (!p) continue; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y) }
  if (!Number.isFinite(x0)) return null
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: x1 - x0 + 2 * grow, h: y1 - y0 + 2 * grow }
}

// ---- One colour logic and one legend for every overlay mode ---------------------------------------

/**
 * The overlay colours. Slope (in steps) and elevation (continuous) share one sequential ramp, blue to pale yellow,
 * with no red or traffic-light coding: the tint describes the DEM, it does not grade the ground as safe or unsafe.
 * Contour lines are the same in every mode: a light core over a dark under-stroke so they read on lit and shadowed
 * regolith alike; index contours (every fifth) are wider and brighter.
 */
export const OVERLAY_RAMP = ['#2c4fa3', '#2a8fc6', '#36bfae', '#a6d763', '#f3e276'] as const
export const OVERLAY_INK = { minor: '#bfeeff', index: '#ffffff', halo: '#03121b', ring: '#f6e7c4', north: '#ffc768' } as const
/** Line widths in screen pixels (core and dark under-stroke), never thinner than 1.5 px at any distance. */
export const OVERLAY_LINE_PX = { minor: 1.5, index: 2.4, minorHalo: 4, indexHalo: 5.2, ring: 1.6, ringHalo: 4 } as const
/** Line weight per mode: full in Contours, lighter where a tint carries the reading. */
export const CONTOUR_WEIGHT: Record<Exclude<OverlayMode, 'off'>, number> = { contours: 1, slope: .55, elevation: .6 }

/** What the overlay draws and from which DEM, for the legend outside the scene. */
export type TerrainOverlayInfo = {
  mode: Exclude<OverlayMode, 'off'>
  /** e.g. "LRO LOLA DEM, 5 m/px" */
  product: string
  source: string
  credit: string
  spacingM: number
  radiusM: number
  contourStepM: number
  /** DEM range inside the overlay disc (metres above the 1737.4 km reference sphere). */
  minM: number | null
  maxM: number | null
  /** Fraction of the disc with a DEM sample. */
  coverage: number
  /** Slope at the visitor from neighbouring DEM samples one grid spacing apart. */
  slopeHereDeg: number | null
  /** The DEM grid is coarse compared with the overlay radius; relief inside it is interpolated. */
  coarse: boolean
}

export type OverlayLegend = {
  title: string
  /** Colour key: none (lines only), stepped bands, or a continuous ramp; each stop is [colour, tick label]. */
  key: { kind: 'lines' } | { kind: 'bands'; stops: { colour: string; label: string }[]; end: string } | { kind: 'ramp'; colours: readonly string[]; from: string; to: string }
  /** The contour line key (drawn in every mode). */
  lines: { minor: string; index: string }
  /** DEM product, resolution and extent. */
  source: string
  /** What the reading is and is not. */
  note: string
}

/** The legend for any mode, from the overlay's own report (or the DEM name the field knows before it reports). */
export function overlayLegend(mode: Exclude<OverlayMode, 'off'>, info: TerrainOverlayInfo | null, fallbackProduct = 'Measured DEM'): OverlayLegend {
  const step = info?.contourStepM, product = info?.product ?? fallbackProduct
  const resolution = info ? `${+info.spacingM.toFixed(1)} m` : 'its'
  const lines = { minor: step ? `every ${step} m` : 'every step', index: step ? `every ${step * INDEX_EVERY} m, labelled` : 'every fifth, labelled' }
  const source = `${product} · ${info?.radiusM ?? DEFAULT_OVERLAY_RADIUS_M} m radius${info?.coarse ? ' · relief between samples interpolated' : ''}`
  if (mode === 'slope') return {
    title: 'Slope · rendered DEM facets',
    key: { kind: 'bands', stops: OVERLAY_RAMP.map((colour, i) => ({ colour, label: i === 0 ? '0°' : `${SLOPE_BANDS_DEG[i - 1]}°` })), end: '+' },
    lines, source,
    note: `Facet slope of the DEM at ${resolution} resolution, not a measured landing hazard. Rocks are not resolved.`,
  }
  if (mode === 'elevation') return {
    title: 'Elevation · DEM height',
    key: { kind: 'ramp', colours: OVERLAY_RAMP, from: info?.minM != null ? formatElevation(info.minM) : 'low', to: info?.maxM != null ? formatElevation(info.maxM) : 'high' },
    lines, source,
    note: 'Height above the 1,737.4 km lunar reference sphere. Measured relief only; no composition data.',
  }
  return { title: 'Contours · DEM height', key: { kind: 'lines' }, lines, source, note: 'Lines of equal DEM height. Measured relief only; no hazard or composition data.' }
}

/** HUD surfaces a legend or scene label must never cover (selectors inside the field HUD). */
export const HUD_SURFACES = ['.field-decisions', '.excursion-status', '.field-status', '.field-compass', '.field-corner', '.field-mission-note', '.field-objective', '.field-arrival', '.field-sheet',
  '.field-card-slot', '.field-ground-card', '.field-companion', '.field-strip', '.field-more', '.field-joystick', '.field-jump', '.field-hint', '.field-walking',
  '.field-toast', '.field-prompt', '.field-lock', '.field-overlay-legend'] as const

export type Rect = { left: number; top: number; right: number; bottom: number }
export type LegendSlot = { left: number; top: number; compact: boolean; anchor: 'beside-toolbar' | 'above-toolbar' | 'beside-sheet' | 'below-cards' | 'top-right' }

/**
 * Where the overlay legend goes: the first free spot, in order, (1) bottom right level with the toolbar, (2) bottom
 * right just above it, (3) left of an open right-hand sheet or card, above the toolbar, (4) in the left column
 * below the status card and any objective or activity card (`leftTop`, from the HUD's measured --f-left-top), (5) top
 * right below the corner controls — full size first, then compact (compact first on phones, `compactFirst`). A spot is free when it stays `edge` px inside the view and keeps
 * `gap` px from every HUD surface (captions bottom left, cards top left, sheets right, the toolbar, touch controls).
 * Null when nothing fits (the map sheet carries the same legend).
 */
export function placeLegend(i: { width: number; height: number; edge: number; gap?: number; full: { w: number; h: number }; compact: { w: number; h: number }; toolbar: Rect | null; corner: Rect | null; obstacles: Rect[]; leftTop?: number; compactFirst?: boolean }): LegendSlot | null {
  const gap = i.gap ?? 10, bottom = i.height - i.edge, right = i.width - i.edge
  const sheet = i.obstacles.filter(o => o.right >= i.width - i.edge - 2 && o.left > i.width * .3 && o.bottom - o.top > 120).sort((a, b) => a.left - b.left)[0]
  const free = (left: number, top: number, w: number, h: number) => left >= i.edge && top >= i.edge && left + w <= right + .5 && top + h <= bottom + .5
    && !i.obstacles.some(o => left < o.right + gap && left + w > o.left - gap && top < o.bottom + gap && top + h > o.top - gap)
  const sizes = [[false, i.full], [true, i.compact]] as const
  for (const [compact, size] of i.compactFirst ? [sizes[1], sizes[0]] : sizes) {
    const spots: [LegendSlot['anchor'], number, number][] = []
    if (i.toolbar) spots.push(['beside-toolbar', right - size.w, i.toolbar.bottom - size.h])
    spots.push(['above-toolbar', right - size.w, (i.toolbar ? i.toolbar.top - gap : bottom) - size.h])
    if (sheet) spots.push(['beside-sheet', sheet.left - gap - size.w, (i.toolbar ? i.toolbar.top - gap : bottom) - size.h])
    if (i.leftTop !== undefined) spots.push(['below-cards', i.edge, i.leftTop])
    if (i.corner) spots.push(['top-right', right - size.w, i.corner.bottom + gap])
    for (const [anchor, left, top] of spots) if (free(left, top, size.w, size.h)) return { left: Math.round(left), top: Math.round(top), compact, anchor }
  }
  return null
}

/** Point `distM` metres from (east, north) along a compass bearing (degrees from north, clockwise). */
export function alongBearing(eastM: number, northM: number, bearingDeg: number, distM: number) {
  const a = bearingDeg * Math.PI / 180
  return { eastM: eastM + Math.sin(a) * distM, northM: northM + Math.cos(a) * distM }
}

/** A short readable name for a DEM product, e.g. "LRO LOLA DEM, 5 m/px". */
export function demLabel(dataset: { spacingM: number; credit?: string }) {
  const spacing = dataset.spacingM >= 100 ? Math.round(dataset.spacingM).toLocaleString('en-US') : String(+dataset.spacingM.toFixed(1))
  const mission = /LOLA/i.test(dataset.credit ?? '') ? 'LRO LOLA' : 'Measured'
  return `${mission} DEM, ${spacing} m/px`
}

/**
 * Indices of the triangles of an indexed mesh whose x/z bounding box comes within `radius` of (cx, cz), with
 * positions multiplied by `scale` first (so a disc inside one large triangle still finds it). Lets the overlay draw
 * only the terrain triangles under its disc while reusing the terrain's own vertices (and so its exact depth).
 */
export function trianglesWithin(positions: ArrayLike<number>, index: ArrayLike<number>, scale: number, cx: number, cz: number, radius: number) {
  const r2 = radius * radius, out: number[] = []
  for (let i = 0; i + 2 < index.length; i += 3) {
    const a = index[i] * 3, b = index[i + 1] * 3, c = index[i + 2] * 3
    const ax = positions[a] * scale, bx = positions[b] * scale, qx = positions[c] * scale
    const az = positions[a + 2] * scale, bz = positions[b + 2] * scale, qz = positions[c + 2] * scale
    const dx = Math.max(Math.min(ax, bx, qx) - cx, 0, cx - Math.max(ax, bx, qx))
    const dz = Math.max(Math.min(az, bz, qz) - cz, 0, cz - Math.max(az, bz, qz))
    if (dx * dx + dz * dz <= r2) out.push(index[i], index[i + 1], index[i + 2])
  }
  return Uint32Array.from(out)
}

function safe(sample: HeightSample, e: number, n: number) {
  try {
    const h = sample(e, n)
    return h !== null && Number.isFinite(h) ? h : null
  } catch { return null }
}
