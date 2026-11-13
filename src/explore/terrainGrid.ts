// A height grid sampled from the rendered LOLA DEM around the landing point, plus contour lines
// and a soft hillshade for the field map. Unknown samples stay NaN; nothing is filled in.
export type TerrainSampler = (eastM: number, northM: number) => number | null

export type HeightGrid = {
  /** Samples per side; cell (i, j) is column i (east), row j (north to south). */
  n: number
  stepM: number
  /** Metres east/north of the landing point of the grid's west and north edges' first samples. */
  westM: number
  northM: number
  heights: Float32Array
  min: number
  max: number
  known: number
}

export function createGrid(centreE: number, centreN: number, halfM: number, stepM: number): HeightGrid {
  const n = Math.floor((2 * halfM) / stepM) + 1
  return { n, stepM, westM: centreE - halfM, northM: centreN + halfM, heights: new Float32Array(n * n).fill(NaN), min: Infinity, max: -Infinity, known: 0 }
}
export const gridEast = (g: HeightGrid, i: number) => g.westM + i * g.stepM
export const gridNorth = (g: HeightGrid, j: number) => g.northM - j * g.stepM

/** Fills rows [from, to) of the grid. Returns the next row to fill. Lets callers spread the work across frames. */
export function fillGridRows(g: HeightGrid, sample: TerrainSampler, from: number, to: number) {
  const end = Math.min(g.n, to)
  for (let j = from; j < end; j++) {
    const north = gridNorth(g, j)
    for (let i = 0; i < g.n; i++) {
      let h: number | null = null
      try { h = sample(gridEast(g, i), north) } catch { h = null }
      if (h !== null && Number.isFinite(h)) {
        g.heights[j * g.n + i] = h; g.known++
        if (h < g.min) g.min = h
        if (h > g.max) g.max = h
      }
    }
  }
  return end
}
export function sampleGrid(sample: TerrainSampler, centreE: number, centreN: number, halfM: number, stepM: number) {
  const g = createGrid(centreE, centreN, halfM, stepM)
  fillGridRows(g, sample, 0, g.n)
  return g
}

/** A round contour interval giving roughly `target` lines across the height range. */
export function contourInterval(min: number, max: number, target = 16) {
  const range = max - min
  if (!Number.isFinite(range) || range <= 0) return 1
  const steps = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200, 250, 500]
  return steps.find(s => range / s <= target) ?? 1000
}

/**
 * Marching squares. Returns line segments [x1, y1, x2, y2] in grid units (column, row) for each level.
 * Cells with an unknown corner are skipped, so gaps in the DEM stay visible as gaps.
 */
export function contourSegments(g: HeightGrid, interval: number) {
  const out: { level: number; segments: number[] }[] = []
  if (!(g.known > 0) || !(interval > 0)) return out
  const first = Math.ceil(g.min / interval) * interval
  const levels: number[] = []
  for (let l = first; l <= g.max && levels.length < 400; l += interval) levels.push(l)
  const H = g.heights, n = g.n
  for (const level of levels) {
    const seg: number[] = []
    for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
      const a = H[j * n + i], b = H[j * n + i + 1], c = H[(j + 1) * n + i + 1], d = H[(j + 1) * n + i]
      if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) continue
      const pts: number[] = []
      const edge = (h1: number, h2: number, x1: number, y1: number, x2: number, y2: number) => {
        if ((h1 < level) === (h2 < level)) return
        const t = (level - h1) / (h2 - h1)
        pts.push(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
      }
      edge(a, b, i, j, i + 1, j)            // top
      edge(b, c, i + 1, j, i + 1, j + 1)    // right
      edge(c, d, i + 1, j + 1, i, j + 1)    // bottom
      edge(d, a, i, j + 1, i, j)            // left
      if (pts.length === 4) seg.push(...pts)
      else if (pts.length === 8) seg.push(pts[0], pts[1], pts[2], pts[3], pts[4], pts[5], pts[6], pts[7])
    }
    if (seg.length) out.push({ level, segments: seg })
  }
  return out
}

/** Lambert hillshade in [0, 1] per sample (NaN where unknown), light from `azDeg` at `altDeg`. */
export function hillshade(g: HeightGrid, azDeg = 315, altDeg = 40) {
  const n = g.n, H = g.heights, out = new Float32Array(n * n).fill(NaN)
  const az = azDeg * Math.PI / 180, alt = altDeg * Math.PI / 180
  const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt)
  const at = (i: number, j: number) => H[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))]
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const h = H[j * n + i]
    if (Number.isNaN(h)) continue
    let e = at(i + 1, j) - at(i - 1, j), s = at(i, j + 1) - at(i, j - 1)
    if (Number.isNaN(e)) e = 0
    if (Number.isNaN(s)) s = 0
    // gradient: dz/dEast and dz/dNorth (rows run north to south)
    const dzE = e / (2 * g.stepM), dzN = -s / (2 * g.stepM)
    const len = Math.hypot(dzE, dzN, 1)
    out[j * n + i] = Math.max(0, (-dzE * lx - dzN * ly + lz) / len)
  }
  return out
}
