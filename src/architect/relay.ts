import { Vector3 } from 'three'
import { attitudeAt, type BodyData } from '../space/ephemeris.ts'
import {
  azElToDir,
  localFrame,
  sitePosition,
  type EphRow,
  type Horizon,
} from '../data.ts'
import { horizonElevation } from '../lib/science.ts'

export type RelayConfig = {
  altitudeKm: number
  inclinationDeg: number
  nodeDeg: number
  phaseDeg: number
}
export const DEFAULT_RELAY: RelayConfig = {
  altitudeKm: 1000,
  inclinationDeg: 90,
  nodeDeg: 0,
  phaseDeg: 0,
}
export function orbitalPeriodH(radiusKm: number, gm: number): number {
  if (!(radiusKm > 0 && gm > 0)) throw new Error('Invalid gravitational orbit')
  return (2 * Math.PI * Math.sqrt(radiusKm ** 3 / gm)) / 3600
}
/** True when the finite segment clears the reference Moon sphere. */
export function clearsMoon(
  from: Vector3,
  to: Vector3,
  radiusKm = 1737.4,
): boolean {
  const direction = to.clone().sub(from),
    lengthSq = direction.lengthSq()
  if (!lengthSq) return from.length() >= radiusKm
  const t = Math.max(0, Math.min(1, -from.dot(direction) / lengthSq))
  return from.clone().addScaledVector(direction, t).length() >= radiusKm
}
export type RelayResult = {
  periodH: number
  relayPct: number
  dtePct: number
  combinedPct: number
  longestGapH: number
  intervals: { startH: number; endH: number }[]
  stepMinutes: number
}

export type RelayPhaseSample = {
  phaseDeg: number
  result: RelayResult
}

export type RelayPhaseSweep = {
  samples: RelayPhaseSample[]
  best: RelayPhaseSample
  stepDeg: number
  objective: 'minimum-longest-gap-then-maximum-availability'
}

export function relayCoverage(
  moon: BodyData,
  horizon: Horizon,
  earth: EphRow[],
  start: number,
  hours: number,
  c: RelayConfig,
): RelayResult {
  if (
    !Number.isInteger(start) ||
    start < 0 ||
    hours <= 0 ||
    start + hours >= earth.length ||
    !Object.values(c).every(Number.isFinite) ||
    c.altitudeKm < 100 ||
    c.altitudeKm > 10000 ||
    c.inclinationDeg < 0 ||
    c.inclinationDeg > 180 ||
    c.nodeDeg < -180 ||
    c.nodeDeg > 180 ||
    c.phaseDeg < 0 ||
    c.phaseDeg > 360
  )
    throw new Error('Unsupported relay scenario')
  const angle = Math.PI / 180,
    radius = 1737.4 + c.altitudeKm
  const periodH = orbitalPeriodH(radius, moon.bodyGM)
  const surface = new Vector3(
    ...sitePosition(
      horizon.lat,
      horizon.lonEast,
      1737.4 + horizon.siteHeightM / 1000,
    ),
  )
  const frame = localFrame([surface.x, surface.y, surface.z])
  const u = new Vector3(...sitePosition(0, c.nodeDeg))
  const equator = localFrame([u.x, u.y, u.z])
  const v = new Vector3(...equator.east)
    .multiplyScalar(Math.cos(c.inclinationDeg * angle))
    .addScaledVector(new Vector3(0, 1, 0), Math.sin(c.inclinationDeg * angle))
  // Orbit plane is fixed inertially; Moon orientation comes from the cached
  // SPICE quaternions, not a guessed sidereal spin rate.
  const initial = attitudeAt(moon, start)
  u.applyQuaternion(initial)
  v.applyQuaternion(initial)
  const toEarth = (row: EphRow) => {
    if (!row.rangeKm) throw new Error('Missing Earth distance')
    return new Vector3(...azElToDir(row.az, row.el, frame)).multiplyScalar(
      row.rangeKm,
    )
  }
  const step = 5 / 60,
    steps = Math.round(hours / step)
  let relay = 0,
    dte = 0,
    combined = 0,
    gap = 0,
    longestGap = 0,
    begin = -1
  const intervals: RelayResult['intervals'] = []
  const east = new Vector3(...frame.east),
    north = new Vector3(...frame.north),
    up = new Vector3(...frame.up)
  for (let i = 0; i < steps; i++) {
    const t = i * step,
      hour = start + t,
      index = Math.floor(hour),
      f = hour - index
    const earthRay = toEarth(earth[index]).lerp(toEarth(earth[index + 1]), f)
    const el = Math.asin(earthRay.clone().normalize().dot(up)) / angle
    const az =
      (Math.atan2(earthRay.dot(east), earthRay.dot(north)) / angle + 360) % 360
    const direct = el > horizonElevation(horizon.profile, az)
    const phase = c.phaseDeg * angle + (t * 2 * Math.PI) / periodH
    const satellite = u
      .clone()
      .multiplyScalar(radius * Math.cos(phase))
      .addScaledVector(v, radius * Math.sin(phase))
      .applyQuaternion(attitudeAt(moon, hour).invert())
    const ray = satellite.clone().sub(surface)
    const relayEl = Math.asin(ray.clone().normalize().dot(up)) / angle
    const relayAz =
      (Math.atan2(ray.dot(east), ray.dot(north)) / angle + 360) % 360
    const visible =
      relayEl > horizonElevation(horizon.profile, relayAz) &&
      clearsMoon(satellite, surface.clone().add(earthRay))
    if (visible) {
      relay++
      if (begin < 0) begin = t
    } else if (begin >= 0) {
      intervals.push({ startH: begin, endH: t })
      begin = -1
    }
    if (direct) dte++
    if (direct || visible) {
      combined++
      gap = 0
    } else {
      gap++
      longestGap = Math.max(longestGap, gap)
    }
  }
  if (begin >= 0) intervals.push({ startH: begin, endH: hours })
  return {
    periodH,
    relayPct: (relay / steps) * 100,
    dtePct: (dte / steps) * 100,
    combinedPct: (combined / steps) * 100,
    longestGapH: longestGap * step,
    intervals,
    stepMinutes: 5,
  }
}

/** Explore the only circular-orbit element that can be changed without
 * changing the orbit plane or period. The winner is selected outage-first:
 * minimize the longest combined direct-or-relay gap, then maximize total
 * combined availability. Phase zero is always included, so the sweep can be
 * compared directly with the default scenario. */
export function relayPhaseSweep(
  moon: BodyData,
  horizon: Horizon,
  earth: EphRow[],
  start: number,
  hours: number,
  config: RelayConfig,
  stepDeg = 15,
): RelayPhaseSweep {
  if (!Number.isFinite(stepDeg) || stepDeg <= 0 || stepDeg > 180 || 360 % stepDeg !== 0)
    throw new Error('Phase step must divide 360 degrees')
  const samples: RelayPhaseSample[] = []
  for (let phaseDeg = 0; phaseDeg < 360; phaseDeg += stepDeg) {
    samples.push({
      phaseDeg,
      result: relayCoverage(moon, horizon, earth, start, hours, { ...config, phaseDeg }),
    })
  }
  const best = samples.reduce((winner, candidate) => {
    const gapDelta = candidate.result.longestGapH - winner.result.longestGapH
    if (Math.abs(gapDelta) > 1e-9) return gapDelta < 0 ? candidate : winner
    const availabilityDelta = candidate.result.combinedPct - winner.result.combinedPct
    if (Math.abs(availabilityDelta) > 1e-9) return availabilityDelta > 0 ? candidate : winner
    return candidate.phaseDeg < winner.phaseDeg ? candidate : winner
  })
  return {
    samples,
    best,
    stepDeg,
    objective: 'minimum-longest-gap-then-maximum-availability',
  }
}
