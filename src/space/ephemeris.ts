import { Quaternion, Vector3 } from 'three'

export const UNIT_KM = 1737.4
export const AU_KM = 149597870.7
export type Body = {
  name: string
  id: number
  parent: string | null
  stepHours: number
  count: number
  radiusKm: number
  radiiKm: [number, number, number]
  parentGM: number | null
  bodyGM: number
  vectors: string
  attitude: string
  attitudeStepHours: number
  attitudeCount: number
  attitudeFrame: string
  texture: string | null
}
export type Manifest = {
  start: string
  stop: string
  hours: number
  bodies: Body[]
}
export type BodyData = Body & { states: Float64Array; rotations: Float32Array }
/** `bodies` holds what is loaded so far (parent-first, manifest order);
 *  `catalog` is the full manifest so callers can list or request the rest. */
export type SpaceData = Omit<Manifest, 'bodies'> & { bodies: BodyData[]; catalog?: Body[] }
export type FlyRequest = {
  body: string
  key: number
  lat?: number
  lon?: number
  overview?: boolean
  /** Earth-centred orbital context, with true Earth–Moon separation. */
  system?: boolean
  sky?: boolean
  terrain?: boolean
  /** Stand on the surface at (lat,lon): land ~3 m above ground, then free-look. */
  visit?: boolean
  /** face this compass bearing (deg, 0=N) when the visit lands */
  guidedTurn?: boolean
  visitHeading?: number
  visitPitch?: number
  /** Explicit skip; reduced-motion preference also bypasses camera travel. */
  instant?: boolean
}
export type SpaceOptions = {
  orbits: boolean
  names: boolean
  enhanced: boolean
  deepSky: boolean
  inspectionLight: boolean
  terrainContrast?: boolean
}

/** The only bodies the lunar-site view needs. Everything else streams in on demand. */
export const ESSENTIAL_BODIES: readonly string[] = ['Sun', 'Earth', 'Moon']

let manifestPromise: Promise<Manifest> | undefined
const bodyPromises = new Map<string, Promise<BodyData>>()
let shared: SpaceData | undefined

const get = async (url: string) => {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`Space data unavailable (${r.status}): ${url}`)
  return r
}

function loadManifest(): Promise<Manifest> {
  return (manifestPromise ??= get('/data/space/manifest.json')
    .then((r) => r.json() as Promise<Manifest>)
    .catch((e) => {
      manifestPromise = undefined
      throw e
    }))
}

/** One download per body, shared by every caller. */
function loadBody(b: Body): Promise<BodyData> {
  let p = bodyPromises.get(b.name)
  if (!p) {
    p = (async () => {
      const [v, q] = await Promise.all([
        get(b.vectors).then((r) => r.arrayBuffer()),
        get(b.attitude).then((r) => r.arrayBuffer()),
      ])
      if (v.byteLength !== b.count * 48 || q.byteLength !== b.attitudeCount * 16)
        throw new Error(`Incomplete ephemeris: ${b.name}`)
      return { ...b, states: new Float64Array(v), rotations: new Float32Array(q) }
    })().catch((e) => {
      bodyPromises.delete(b.name)
      throw e
    })
    bodyPromises.set(b.name, p)
  }
  return p
}

/** The names plus every ancestor: vectors are parent-relative, so a body is
 *  only usable when its whole parent chain is loaded. */
function closure(catalog: Body[], names: Iterable<string>): Set<string> {
  const byName = new Map(catalog.map((b) => [b.name, b]))
  const out = new Set<string>()
  for (const n of names)
    for (let b = byName.get(n); b && !out.has(b.name); b = b.parent ? byName.get(b.parent) : undefined)
      out.add(b.name)
  return out
}

/**
 * Load the manifest plus the requested bodies (default: Sun, Earth, Moon). A
 * fresh open therefore does not download the other 18 bodies' textures and
 * vectors; they arrive through expandSpace when someone flies to a planet or
 * opens the whole-system view. All callers share one SpaceData.
 */
export async function loadSpace(names: Iterable<string> = ESSENTIAL_BODIES): Promise<SpaceData> {
  const manifest = await loadManifest()
  shared ??= { ...manifest, bodies: [], catalog: manifest.bodies }
  await expandSpace(shared, names)
  return shared
}

/**
 * Add bodies (with their ancestors) to a SpaceData IN PLACE, keeping manifest
 * order. The object identity is preserved on purpose: scene state is keyed on
 * it, and replacing it would reset the camera mid-flight. Safe under
 * concurrent calls — the merge is recomputed from the live list after each await.
 */
export async function expandSpace(data: SpaceData, names: Iterable<string>): Promise<SpaceData> {
  const catalog = data.catalog ?? data.bodies
  const want = closure(catalog, names)
  const have = new Set(data.bodies.map((b) => b.name))
  const missing = catalog.filter((b) => want.has(b.name) && !have.has(b.name))
  if (!missing.length) return data
  const loaded = await Promise.all(missing.map(loadBody))
  const current = new Map(data.bodies.map((b) => [b.name, b]))
  for (const b of loaded) current.set(b.name, b)
  data.bodies.splice(0, data.bodies.length, ...catalog.filter((b) => current.has(b.name)).map((b) => current.get(b.name)!))
  return data
}

export function hasBodies(data: SpaceData, names: Iterable<string>): boolean {
  const have = new Set(data.bodies.map((b) => b.name))
  for (const n of names) if (!have.has(n)) return false
  return true
}

/** Cubic Hermite interpolation in km. Velocity samples are km/s, times are UTC hours. */
export function positionAt(
  b: Pick<BodyData, 'states' | 'stepHours' | 'count'>,
  hour: number,
  out = new Vector3(),
) {
  const t = Math.max(0, Math.min(b.count - 1, hour / b.stepHours))
  const i = Math.min(Math.floor(t), b.count - 2),
    u = t - i,
    h = b.stepHours * 3600
  const a = 2 * u ** 3 - 3 * u ** 2 + 1,
    c = -2 * u ** 3 + 3 * u ** 2
  const d = (u ** 3 - 2 * u ** 2 + u) * h,
    e = (u ** 3 - u ** 2) * h
  const v = b.states,
    j = i * 6,
    k = j + 6
  return out.set(
    a * v[j] + d * v[j + 3] + c * v[k] + e * v[k + 3],
    a * v[j + 1] + d * v[j + 4] + c * v[k + 1] + e * v[k + 4],
    a * v[j + 2] + d * v[j + 5] + c * v[k + 2] + e * v[k + 5],
  )
}

/** Right-handed ICRF X,Y,Z -> Three X,Z,-Y. Distances stay linear at every zoom. */
export function toScene(v: Vector3) {
  return v.set(v.x / UNIT_KM, v.z / UNIT_KM, -v.y / UNIT_KM)
}

export function attitudeAt(b: BodyData, hour: number, out = new Quaternion()) {
  const t = Math.max(
    0,
    Math.min(b.attitudeCount - 1, hour / b.attitudeStepHours),
  )
  const i = Math.min(Math.floor(t), b.attitudeCount - 2)
  return out
    .fromArray(b.rotations, i * 4)
    .slerp(new Quaternion().fromArray(b.rotations, (i + 1) * 4), t - i)
    .normalize()
}

export function positionsAt(
  data: SpaceData,
  hour: number,
  out = new Map<string, Vector3>(),
) {
  // The manifest is ordered parent first. Every vector is parent-relative, never Moon-fixed.
  for (const b of data.bodies) {
    const p = toScene(positionAt(b, hour, out.get(b.name)))
    if (b.parent) p.add(out.get(b.parent)!)
    out.set(b.name, p)
  }
  return out
}

/** Instantaneous two-body osculating ellipse, not a forecast of perturbed future motion. */
export function orbitPoints(
  b: BodyData,
  hour: number,
  segments = 256,
): Vector3[] {
  if (!b.parentGM) return []
  const i =
    Math.max(0, Math.min(b.count - 1, Math.round(hour / b.stepHours))) * 6
  const r = new Vector3().fromArray(b.states, i),
    v = new Vector3().fromArray(b.states, i + 3)
  const mu = b.parentGM + b.bodyGM
  const h = r.clone().cross(v),
    p = h.lengthSq() / mu
  const ev = v
      .clone()
      .cross(h)
    .divideScalar(mu)
      .sub(r.clone().normalize()),
    e = ev.length()
  if (!(e < 1) || !(p > 0)) return []
  const x = e > 1e-8 ? ev.normalize() : r.clone().normalize(),
    y = h.normalize().cross(x).normalize()
  return Array.from({ length: segments + 1 }, (_, n) => {
    const a = (n / segments) * Math.PI * 2,
      d = p / (1 + e * Math.cos(a))
    return toScene(
      x
        .clone()
        .multiplyScalar(Math.cos(a) * d)
        .addScaledVector(y, Math.sin(a) * d),
    )
  })
}

export const BODY_COLORS: Record<string, string> = {
  Sun: '#fff4dd',
  Mercury: '#b7b1a7',
  Venus: '#e6c498',
  Earth: '#77beef',
  Moon: '#c9ccd3',
  Mars: '#dc9270',
  Jupiter: '#d4b595',
  Saturn: '#e3cf9c',
  Uranus: '#9dd6db',
  Neptune: '#5987d2',
}
