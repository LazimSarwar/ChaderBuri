/** Deterministic screening geometry. Angles in degrees, azimuth clockwise from north. */
export const SOLAR_IRRADIANCE = 1361 // W/m² at 1 AU; NASA solar irradiance reference
export const SUN_RADIUS_DEG = 0.267
export const EARTH_RADIUS_DEG = 0.95
export const AU_KM = 149597870.7
export type SkySample = { az: number; el: number; radiusDeg?: number; rangeKm?: number }
export type SunVerdict = 'lit' | 'grazing' | 'shadowed'
const RAD = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Binary terrain visibility used by every duty-cycle / visibility constraint.
 * The separate disc fraction is used for electrical power, not this statistic. */
export const centerVisible = (elevation: number, horizon: number) => elevation > horizon

export function horizonElevation(profile: number[], azimuth: number): number {
  return profile[((Math.round(azimuth) % 360) + 360) % 360]
}

/** Uniform solar disc above a locally horizontal terrain silhouette.
 * The 1° horizon mask cannot resolve ridges across the 0.53° disc. */
export function solarDiscFraction(elevation: number, horizon: number, radius = SUN_RADIUS_DEG): number {
  const x = clamp((elevation - horizon) / radius, -1, 1)
  return (Math.acos(-x) + x * Math.sqrt(Math.max(0, 1 - x * x))) / Math.PI
}

export function sunVerdict(elevation: number, horizon: number, radius = SUN_RADIUS_DEG): SunVerdict {
  if (elevation - radius >= horizon) return 'lit'
  return elevation + radius > horizon ? 'grazing' : 'shadowed'
}

export function angularSep(az1: number, el1: number, az2: number, el2: number): number {
  return Math.acos(clamp(Math.sin(el1 * RAD) * Math.sin(el2 * RAD) +
    Math.cos(el1 * RAD) * Math.cos(el2 * RAD) * Math.cos((az1 - az2) * RAD), -1, 1)) / RAD
}

/** Two-circle overlap in the angular-plane approximation. Uses supplied apparent
 * radii; ignores atmospheric scattering and limb darkening. */
export function eclipseFactor(sunAz: number, sunEl: number, earthAz: number, earthEl: number, r = SUN_RADIUS_DEG, R = EARTH_RADIUS_DEG): number {
  const d = angularSep(sunAz, sunEl, earthAz, earthEl)
  if (d >= r + R) return 1
  if (d <= Math.abs(R - r)) return R >= r ? 0 : 1 - R * R / (r * r)
  const a = Math.acos(clamp((d * d + r * r - R * R) / (2 * d * r), -1, 1))
  const b = Math.acos(clamp((d * d + R * R - r * r) / (2 * d * R), -1, 1))
  const lens = r * r * a + R * R * b - 0.5 * Math.sqrt(Math.max(0,
    (-d + r + R) * (d + r - R) * (d - r + R) * (d + r + R)))
  return clamp(1 - lens / (Math.PI * r * r), 0, 1)
}

/** Simultaneous ridge/eclipsing masks are conservatively combined by the lower
 * bound on their intersection, since their relative disc orientation is unresolved. */
export function availableSunFraction(sunAz: number, sunEl: number, earthAz: number, earthEl: number, horizon: number, sunRadius = SUN_RADIUS_DEG, earthRadius = EARTH_RADIUS_DEG): number {
  return Math.max(0, solarDiscFraction(sunEl, horizon, sunRadius) + eclipseFactor(sunAz, sunEl, earthAz, earthEl, sunRadius, earthRadius) - 1)
}

export const solarFluxScale = (sun: SkySample) => sun.rangeKm ? (AU_KM / sun.rangeKm) ** 2 : 1
export const sunlightFraction = (sun: SkySample, earth: SkySample, horizon: number) =>
  availableSunFraction(sun.az, sun.el, earth.az, earth.el, horizon, sun.radiusDeg, earth.radiusDeg)
export const referencePanelPower = (sun: SkySample, earth: SkySample, horizon: number) =>
  panelWattsPerM2(sun.el, sunlightFraction(sun, earth, horizon)) * solarFluxScale(sun)

/** Shortest arc around north, including reverse playback. */
export function interpolateAzimuth(a: number, b: number, fraction: number): number {
  const delta = ((b - a + 540) % 360) - 180
  return ((a + delta * fraction) % 360 + 360) % 360
}

/** Continuous display interpolation; mission integration uses hourly intervals. */
export function sampleSky<T extends SkySample>(rows: T[], row: number): T {
  const r = clamp(row, 0, rows.length - 1)
  const a = rows[Math.floor(r)], b = rows[Math.min(Math.floor(r) + 1, rows.length - 1)]
  const f = r - Math.floor(r)
  return { ...a, az: interpolateAzimuth(a.az, b.az, f), el: a.el + (b.el - a.el) * f,
    ...(a.radiusDeg && b.radiusDeg ? { radiusDeg: a.radiusDeg + (b.radiusDeg - a.radiusDeg) * f } : {}),
    ...(a.rangeKm && b.rangeKm ? { rangeKm: a.rangeKm + (b.rangeKm - a.rangeKm) * f } : {}) }
}

/** Electrical output per m²: horizontal panel, 28% efficiency, 1 AU,
 * centre-ray incidence approximation. Pass the available solar fraction. */
export function panelWattsPerM2(sunElevation: number, availableFraction = 1): number {
  return SOLAR_IRRADIANCE * 0.28 * Math.max(0, Math.sin(sunElevation * RAD)) * availableFraction
}
