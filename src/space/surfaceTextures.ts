import * as T from 'three'

/**
 * Procedural display textures for the surface visit: soil relief, suit fabric, spacecraft foil and panels,
 * and a dim lunar surround for reflections. Presentation only; nothing here feeds a measured value.
 */

/** Span (metres) after which the shader's soil coordinates repeat. Every periodic soil layer fits a whole number of times. */
export const SOIL_PERIOD_M = 4096

const wrap = (v: number, n: number) => ((v % n) + n) % n
function hashSeed(seed: number) {
  let s = seed >>> 0
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
}
function linear(c: number) { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4 }

/**
 * The scanned regolith photo turned into one RGBA lookup so the shader reads relief and albedo together:
 * r,g = slope of luminance-as-height per texel (0.5 = flat, +-1.5 range), b = albedo relative to the mean (0.5 = mean).
 */
export function soilDetailTexture(image: CanvasImageSource & { width: number; height: number }) {
  const size = 1024, canvas = document.createElement('canvas'); canvas.width = canvas.height = size
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(image, 0, 0, size, size)
  const pixels = g.getImageData(0, 0, size, size).data, lum = new Float32Array(size * size)
  let mean = 0
  for (let i = 0; i < size * size; i++) {
    const l = .2126 * linear(pixels[i * 4]) + .7152 * linear(pixels[i * 4 + 1]) + .0722 * linear(pixels[i * 4 + 2])
    lum[i] = l; mean += l
  }
  mean /= size * size
  const out = new Uint8Array(size * size * 4), at = (x: number, y: number) => lum[wrap(y, size) * size + wrap(x, size)] / mean - 1
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = (at(x + 1, y) - at(x - 1, y)) / 2, sy = (at(x, y + 1) - at(x, y - 1)) / 2, i = (y * size + x) * 4
    out[i] = Math.max(0, Math.min(255, (sx / 3 + .5) * 255))
    out[i + 1] = Math.max(0, Math.min(255, (sy / 3 + .5) * 255))
    out[i + 2] = Math.max(0, Math.min(255, (lum[y * size + x] / mean) * .5 * 255))
    out[i + 3] = 255
  }
  const t = new T.DataTexture(out, size, size, T.RGBAFormat)
  t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter
  t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = T.NoColorSpace; t.needsUpdate = true
  return t
}

/**
 * Tileable value noise for the terrain shader, so broad tone, gentle undulation and soil grain cost a texture read
 * each instead of many hash evaluations. 32 noise cells per tile (8 texels per cell).
 * r = noise A, g/b = gradient of A per cell (0.5 = flat, +-1.5 range), a = independent noise B.
 */
export const NOISE_CELLS = 32
export function terrainNoiseTexture() {
  const size = 256, cells = NOISE_CELLS, step = size / cells, out = new Uint8Array(size * size * 4)
  const lattice = (seed: number) => { const r = hashSeed(seed); return Float32Array.from({ length: cells * cells }, () => r()) }
  const a = lattice(11), b = lattice(29), at = (l: Float32Array, i: number, j: number) => l[wrap(j, cells) * cells + wrap(i, cells)]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = (x + .5) / step, py = (y + .5) / step, i = Math.floor(px), j = Math.floor(py), fx = px - i, fy = py - j
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), du = 6 * fx * (1 - fx), dv = 6 * fy * (1 - fy)
    const value = (l: Float32Array) => { const p = at(l, i, j), q = at(l, i + 1, j), r = at(l, i, j + 1), s = at(l, i + 1, j + 1), k = p - q - r + s; return [p + (q - p) * u + (r - p) * v + k * u * v, du * (q - p + k * v), dv * (r - p + k * u)] }
    const [na, gx, gy] = value(a), [nb] = value(b), o = (y * size + x) * 4
    out[o] = na * 255; out[o + 1] = Math.max(0, Math.min(255, (gx / 3 + .5) * 255)); out[o + 2] = Math.max(0, Math.min(255, (gy / 3 + .5) * 255)); out[o + 3] = nb * 255
  }
  const t = new T.DataTexture(out, size, size, T.RGBAFormat)
  t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter
  t.generateMipmaps = true; t.colorSpace = T.NoColorSpace; t.needsUpdate = true
  return t
}

/** Height field (0..1) to a tangent-space normal map; tileable. */
function normalsFromHeight(h: Float32Array, size: number, strength: number) {
  const out = new Uint8Array(size * size * 4), at = (x: number, y: number) => h[wrap(y, size) * size + wrap(x, size)]
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength, l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4
    out[i] = (-dx / l * .5 + .5) * 255; out[i + 1] = (-dy / l * .5 + .5) * 255; out[i + 2] = (1 / l * .5 + .5) * 255; out[i + 3] = 255
  }
  return out
}
function dataTexture(data: Uint8Array, size: number, srgb = false) {
  const t = new T.DataTexture(data, size, size, T.RGBAFormat)
  t.wrapS = t.wrapT = T.RepeatWrapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearMipmapLinearFilter
  t.generateMipmaps = true; t.anisotropy = 4; t.colorSpace = srgb ? T.SRGBColorSpace : T.NoColorSpace; t.needsUpdate = true
  return t
}

/**
 * Suit fabric: a fine twill weave with one stitched seam across the middle of the tile (v = 0.5).
 * Parts are UV-scaled so one tile is FABRIC_TILE_M along the limb; seams then fall where the geometry places them.
 */
export const FABRIC_TILE_M = .12
let fabricData: Uint8Array | null = null
export function fabricNormalTexture() {
  if (!fabricData) fabricData = fabricNormals()
  return dataTexture(fabricData, 512)
}
function fabricNormals() {
  const size = 512, h = new Float32Array(size * size), cells = 96
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * cells, v = y / size * cells
    // Twill: diagonal ribs plus the over-under of the weave.
    const rib = .5 + .5 * Math.sin((u + v) * Math.PI), weave = .5 + .5 * Math.sin(u * Math.PI * 2) * Math.sin(v * Math.PI * 2)
    let value = .08 * rib + .3 * weave
    // Seam: a soft groove with raised edges and a dashed stitch line either side.
    const d = Math.abs(y / size - .5) * size
    value -= 1.6 * Math.exp(-((d / 2.2) ** 2))
    value += .9 * Math.exp(-(((d - 6) / 3) ** 2))
    if (Math.abs(d - 10) < 1.2 && (x % 10) < 6) value += .9
    h[y * size + x] = value
  }
  return normalsFromHeight(h, size, 1.2)
}

/**
 * Pressure-glove outer fabric: the same fine weave plus soft wrinkles. Folds run around the limb (constant v,
 * gently wavy, each a partial arc), so on fingers and the gauntlet they read as fabric bunching at the joints,
 * not as a printed pattern. Tile is FABRIC_TILE_M along the limb like the suit fabric.
 */
// Generated pixel data is cached for the page: the textures themselves are disposed with the gloves, but remounts
// (React's development double-mount, a scene retry, another visit) reuse the data instead of recomputing it.
let gloveData: Uint8Array | null = null
export function gloveNormalTexture() {
  const size = 512
  if (!gloveData) {
    const h = new Float32Array(size * size), cells = 110, rand = hashSeed(23)
    const folds = Array.from({ length: 16 }, () => ({ v: rand(), amp: .5 + rand() * .9, width: .006 + rand() * .012, wave: 1 + Math.floor(rand() * 3), phase: rand() * 6.283, drift: (rand() - .5) * .05, start: rand(), span: .35 + rand() * .55 }))
    // Each fold's arc position, fade and centre depend only on the column: compute them once per column.
    const active = new Uint8Array(folds.length * size), fades = new Float64Array(folds.length * size), centres = new Float64Array(folds.length * size)
    folds.forEach((f, k) => {
      for (let x = 0; x < size; x++) {
        const u = x / size, along = ((u - f.start) % 1 + 1) % 1
        if (along > f.span) continue
        active[k * size + x] = 1; fades[k * size + x] = Math.sin(along / f.span * Math.PI)
        centres[k * size + x] = f.v + f.drift * Math.sin(u * Math.PI * 2 * f.wave + f.phase)
      }
    })
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, uu = u * cells, vv = v * cells
      const weave = .5 + .5 * Math.sin(uu * Math.PI * 2) * Math.sin(vv * Math.PI * 2), rib = .5 + .5 * Math.sin((uu + vv) * Math.PI)
      let value = .05 * rib + .16 * weave
      for (let k = 0; k < folds.length; k++) {
        // Distance along u from the fold's arc (wrapped), fading at its ends.
        const c = k * size + x
        if (!active[c]) continue
        const f = folds[k]
        let dv = v - centres[c]
        dv -= Math.round(dv)
        const r = dv / f.width
        // A fold: a rounded ridge with a sharper crease on one side.
        value += f.amp * fades[c] * (Math.exp(-r * r) - .55 * Math.exp(-((r + 1.1) ** 2) * 3))
      }
      h[y * size + x] = value
    }
    gloveData = normalsFromHeight(h, size, 2.2)
  }
  return dataTexture(gloveData, size)
}

/**
 * Crinkled multi-layer insulation: a blanket pressed into flat facets of random tilt at two scales (coarse folds of
 * a few centimetres, fine crinkle within them), stretched along the wrap like real blanketing, with a few long
 * creases and one taped seam line per tile. Facets are flat, so the metallised film breaks the surround into sharp
 * light and dark panes (foil) instead of soft blotches.
 */
export function foilNormalTexture() {
  const size = 512, rand = hashSeed(91), out = new Uint8Array(size * size * 4)
  const layer = (grid: number, tiltMin: number, tiltMax: number, stretch: number) => {
    const points: { x: number; y: number; nx: number; ny: number }[] = []
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
      const tilt = tiltMin + rand() * (tiltMax - tiltMin), a = rand() * Math.PI * 2
      points.push({ x: (i + .15 + rand() * .7) / grid, y: (j + .15 + rand() * .7) / grid, nx: Math.cos(a) * tilt, ny: Math.sin(a) * tilt * .7 })
    }
    return (px: number, py: number) => {
      const ci = Math.floor(px * grid), cj = Math.floor(py * grid)
      let best = 9, second = 9, nx = 0, ny = 0
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const cell = points[wrap(cj + dj, grid) * grid + wrap(ci + di, grid)]
        // Wrapped neighbours sit one tile over, so the facets tile seamlessly.
        const ox = ci + di < 0 ? -1 : ci + di >= grid ? 1 : 0, oy = cj + dj < 0 ? -1 : cj + dj >= grid ? 1 : 0
        const d = Math.hypot((px - (cell.x + ox)) / stretch, py - (cell.y + oy))
        if (d < best) { second = best; best = d; nx = cell.nx; ny = cell.ny } else if (d < second) second = d
      }
      return [nx, ny, (second - best) * grid] as const
    }
  }
  const coarse = layer(12, .05, .24, 1.7), fine = layer(34, .02, .1, 1.4)
  const creases = Array.from({ length: 6 }, () => ({ a: (rand() - .5) * .9, o: rand(), f: 1 + Math.floor(rand() * 3) }))
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size, [cx, cy, edge] = coarse(px, py), [fx, fy] = fine(px, py)
    // A narrow raised ridge along each coarse fold line, so folds catch a thin highlight.
    const ridge = Math.exp(-((edge / .06) ** 2)) * .14
    let nx = cx + fx, ny = cy + fy + ridge
    for (const c of creases) {
      const s = Math.sin((px * Math.sin(c.a) + py * Math.cos(c.a)) * Math.PI * 2 * c.f + c.o * 6.283)
      const k = Math.sign(s) * Math.exp(-((Math.abs(s) / .1) ** 2)) * .22
      nx += Math.sin(c.a) * k; ny += Math.cos(c.a) * k
    }
    // Taped seam across the tile: flat tape with a lifted edge.
    const seam = Math.abs(py - .5) * size
    if (seam < 5) { nx *= .15; ny = ny * .15 + (seam > 4 ? .3 : 0) }
    const l = Math.hypot(nx, ny, 1), i = (y * size + x) * 4
    out[i] = (nx / l * .5 + .5) * 255; out[i + 1] = (ny / l * .5 + .5) * 255; out[i + 2] = (1 / l * .5 + .5) * 255; out[i + 3] = 255
  }
  return dataTexture(out, size)
}

/** Solar cells: a grid of dark blue cells with silver gaps and fine busbars (sRGB colour map). */
export function solarCellTexture(cellsX = 6, cellsY = 6) {
  const size = 256, c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = '#9aa3aa'; g.fillRect(0, 0, size, size)
  const w = size / cellsX, h = size / cellsY, rand = hashSeed(7)
  for (let j = 0; j < cellsY; j++) for (let i = 0; i < cellsX; i++) {
    const shade = 18 + rand() * 8
    g.fillStyle = `rgb(${shade * .55},${shade * .8},${shade * 2.1})`
    g.fillRect(i * w + 2, j * h + 2, w - 4, h - 4)
    g.fillStyle = 'rgba(190,200,210,.55)'
    for (let k = 1; k < 4; k++) g.fillRect(i * w + 2, j * h + k * h / 4, w - 4, 1)
    g.fillStyle = 'rgba(200,210,220,.35)'; g.fillRect(i * w + w / 2 - 1, j * h + 2, 2, h - 4)
  }
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = T.RepeatWrapping
  return t
}

/** Radial glow (sRGB) for additive light pools; colour stops are [offset, css colour]. */
export function radialTexture(stops: [number, string][], size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d')!, grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  for (const [o, colour] of stops) grad.addColorStop(o, colour)
  g.fillStyle = grad; g.fillRect(0, 0, size, size)
  const t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t
}

/**
 * A dim lunar surround for reflections and bounce light: black sky above the horizon, uniform regolith below.
 * Its brightness is set per frame from the measured Sun elevation (see lunarSurround), never from a fixed glow.
 */
let surround: T.DataTexture | null = null
export function lunarSurroundTexture() {
  if (surround) return surround
  const w = 64, h = 32, data = new Uint8Array(w * h * 4)
  for (let y = 0; y < h; y++) {
    const elevation = (.5 - (y + .5) / h) * 180, t = Math.max(0, Math.min(1, (8 - elevation) / 38)), ground = t * t * (3 - 2 * t)
    const v = ground * 255
    for (let x = 0; x < w; x++) data.set([v, v * .975, v * .93, 255], (y * w + x) * 4)
  }
  const t = new T.DataTexture(data, w, h, T.RGBAFormat)
  t.mapping = T.EquirectangularReflectionMapping; t.magFilter = T.LinearFilter; t.minFilter = T.LinearFilter
  t.colorSpace = T.NoColorSpace; t.needsUpdate = true
  surround = t
  return t
}

const UP = new T.Vector3(0, 1, 0), _q = new T.Quaternion(), _e = new T.Euler()
/**
 * Orient the surround so its ground lies under the visitor's local up (world space), and scale it with the
 * Sun's elevation: sunlit regolith lights the undersides of nearby hardware. A small floor matches the ~3% fill.
 * Returns the intensity to apply as envMapIntensity.
 */
export function lunarSurround(rotation: T.Euler, worldUp: T.Vector3, sunDirection: T.Vector3) {
  _q.setFromUnitVectors(worldUp.clone().normalize(), UP)
  _e.setFromQuaternion(_q, 'XYZ')
  // three.js negates the Euler before building the lookup matrix; pre-negate so the matrix is exactly _q.
  rotation.set(-_e.x, -_e.y, -_e.z, 'XYZ')
  const sinEl = Math.max(0, sunDirection.dot(worldUp) / (sunDirection.length() * worldUp.length() || 1))
  return .03 + 1.1 * Math.min(.5, sinEl)
}
