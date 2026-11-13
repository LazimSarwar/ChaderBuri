import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import {
  offsetSky,
  checkDispersion,
  type DispersionData,
} from '../src/architect/dispersion.ts'
import { buildSeries, evaluateWindow } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import {
  clearsMoon,
  orbitalPeriodH,
  relayCoverage,
  relayPhaseSweep,
  DEFAULT_RELAY,
} from '../src/architect/relay.ts'
import type { BodyData } from '../src/space/ephemeris.ts'
import type { Ephemeris, Horizon, Site } from '../src/data.ts'

let checks = 0
const check = (value: boolean, message: string) => {
  checks++
  assert.ok(value, message)
}
const near = (a: number, b: number, tolerance: number, message: string) =>
  check(Math.abs(a - b) < tolerance, `${message}: ${a} vs ${b}`)
const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8'))
const sites = json<Site[]>('public/data/sites.json')
for (const site of sites) {
  const data = json<DispersionData>(`public/data/dispersion/${site.slug}.json`)
  const horizon = json<Horizon>(`public/data/horizons/${site.slug}.json`)
  const sun = json<Ephemeris>(
    `public/data/ephemeris/${site.slug}.sun.json`,
  ).rows
  const earth = json<Ephemeris>(
    `public/data/ephemeris/${site.slug}.earth.json`,
  ).rows
  check(data.samples.length === 19, 'Nineteen actual terrain samples')
  check(
    JSON.stringify(data.samples[0].profile) === JSON.stringify(horizon.profile),
    'Nominal profile unchanged',
  )
  for (let i = 0; i < 19; i++) {
    const sample = data.samples[i]
    check(
      sample.profile.length === 360 && sample.profile.every(Number.isFinite),
      'Complete finite offset mask',
    )
    const r = Math.hypot(sample.eastM, sample.northM)
    near(r, i === 0 ? 0 : i <= 6 ? 125 : 250, 0.002, 'Ring sample spacing')
    const a = (site.lat * Math.PI) / 180,
      b = (sample.lat * Math.PI) / 180,
      d = ((sample.lonEast - site.lonEast) * Math.PI) / 180
    const angle =
      2 *
      Math.asin(
        Math.sqrt(
          Math.sin((b - a) / 2) ** 2 +
            Math.cos(a) * Math.cos(b) * Math.sin(d / 2) ** 2,
        ),
      )
    near(angle * 1737400, r, 0.002, 'Independent great-circle offset distance')
    const translated = offsetSky(sun[1104], horizon, sample)
    check(
      translated.az >= 0 &&
        translated.az < 360 &&
        Number.isFinite(translated.el) &&
        translated.rangeKm! > 0,
      'Offset sky finite and wrapped',
    )
    const back = offsetSky(translated, sample, horizon)
    near(
      back.el,
      sun[1104].el,
      1e-8,
      'Observer translation reversible in elevation',
    )
    near(
      back.rangeKm!,
      sun[1104].rangeKm!,
      1e-5,
      'Observer translation reversible in range',
    )
  }
  const c = {
    missionDays: 14,
    minLitPct: 60,
    maxDarkH: 72,
    minLinkPct: 60,
    maxGapH: 72,
    power: { ...DEFAULT_POWER, loadW: 1200, panelAreaM2: 3.08 },
  }
  const result = checkDispersion(data, sun, earth, 1104, c)
  const expected = evaluateWindow(
    buildSeries(site.slug, sun, earth, horizon),
    1104,
    1440,
    c,
  )
  for (const key of [
    'litPct',
    'linkPct',
    'longestDarkH',
    'longestGapH',
    'margin',
  ] as const)
    near(
      result.samples[0].result[key],
      expected[key],
      1e-10,
      'Nominal result exactly matches mission solver',
    )
  near(
    result.samples[0].result.power!.minPct,
    expected.power!.minPct,
    1e-10,
    'Nominal battery exactly matches solver',
  )
  check(
    result.passing === result.samples.filter((s) => s.result.pass).length,
    'Verdict count reproducible',
  )
  const allPass = checkDispersion(data, sun, earth, 1104, {
    ...c,
    power: undefined,
    minLitPct: 0,
    minLinkPct: 0,
    maxDarkH: 336,
    maxGapH: 336,
  })
  check(
    allPass.verdict === 'ROBUST' && allPass.passing === 19,
    'All pass is robust',
  )
  const allFail = checkDispersion(data, sun, earth, 1104, {
    ...c,
    power: { ...DEFAULT_POWER, panelAreaM2: 0, loadW: 1e6 },
  })
  check(
    allFail.verdict === 'FRAGILE' && allFail.passing === 0,
    'All fail is fragile',
  )
  const meta = json<{ gridSize: number; spacingM: number }>(
    `public/data/surface/${site.slug}.json`,
  )
  const meshBuffer = readFileSync(`public/data/surface/${site.slug}.mesh.bin`)
  const uvBuffer = readFileSync(`public/data/surface/${site.slug}.uv.bin`)
  check(
    meshBuffer.length === meta.gridSize ** 2 * 12 &&
      uvBuffer.length === meta.gridSize ** 2 * 8,
    'Exact terrain binary sizes',
  )
  const mesh = new Float32Array(
    meshBuffer.buffer,
    meshBuffer.byteOffset,
    meshBuffer.length / 4,
  )
  const uv = new Float32Array(
    uvBuffer.buffer,
    uvBuffer.byteOffset,
    uvBuffer.length / 4,
  )
  check(
    mesh.every(Number.isFinite) &&
      uv.every((v) => Number.isFinite(v) && v >= 0 && v <= 1),
    'Finite georeferenced surface vertices and UVs',
  )
  const center = ((meta.gridSize ** 2 - 1) / 2) * 3
  near(mesh[center], 0, 0.001, 'Terrain centre east is origin')
  near(mesh[center + 2], 0, 0.001, 'Terrain centre north is origin')
  check(
    Math.abs(mesh[center + 1]) <= 0.51,
    'Centre elevation agrees with rounded nominal DEM height',
  )
  console.log(
    `${site.slug}: ${result.verdict} (${result.passing}/19), DEM ${meta.spacingM} m`,
  )
}
check(
  clearsMoon(new Vector3(3000, 0, 0), new Vector3(384400, 0, 0)),
  'Earth-side relay visible',
)
check(
  !clearsMoon(new Vector3(-3000, 0, 0), new Vector3(384400, 0, 0)),
  'Far-side relay blocked',
)
check(
  clearsMoon(new Vector3(-3000, 1737.4, 0), new Vector3(3000, 1737.4, 0)),
  'Tangential segment clears reference sphere',
)
check(
  !clearsMoon(new Vector3(0, 0, 0), new Vector3(0, 0, 0)),
  'Degenerate interior segment blocked',
)
const gm = 4902.800118,
  radius = 2737.4
near(
  orbitalPeriodH(radius, gm) * 3600,
  2 * Math.PI * Math.sqrt(radius ** 3 / gm),
  1e-8,
  'Kepler orbital period',
)
const rotations = new Float32Array(25 * 4)
for (let i = 0; i < 25; i++) rotations[i * 4 + 3] = 1
const moon = {
  name: 'Moon',
  bodyGM: gm,
  rotations,
  attitudeCount: 25,
  attitudeStepHours: 1,
} as BodyData
const flat = {
  lat: 0,
  lonEast: 0,
  siteHeightM: 0,
  profile: Array(360).fill(0),
} as Horizon
const earth = Array.from({ length: 25 }, (_, i) => ({
  t: String(i),
  az: 0,
  el: 90,
  rangeKm: 384400,
}))
const period = orbitalPeriodH(radius, gm)
const result = relayCoverage(moon, flat, earth, 0, period * 6, DEFAULT_RELAY)
near(
  result.relayPct,
  (Math.acos(1737.4 / radius) / Math.PI) * 100,
  1,
  'Relay coverage matches analytic circular horizon fraction',
)
check(
  result.dtePct === 100 &&
    result.combinedPct === 100 &&
    result.longestGapH === 0,
  'Direct link fills every hypothetical relay gap',
)
assert.throws(() =>
  relayCoverage(moon, flat, earth, 0, 14, { ...DEFAULT_RELAY, altitudeKm: 0 }),
)
const manifest = json<{ bodies: BodyData[] }>('public/data/space/manifest.json')
const lunar = manifest.bodies.find((b) => b.name === 'Moon')!
const q = readFileSync(`public${lunar.attitude}`)
const realMoon = {
  ...lunar,
  rotations: new Float32Array(q.buffer, q.byteOffset, q.length / 4),
}
const haworth = json<Horizon>('public/data/horizons/haworth-rim.json')
const haworthEarth = json<Ephemeris>(
  'public/data/ephemeris/haworth-rim.earth.json',
).rows
const rescue = relayCoverage(
  realMoon,
  haworth,
  haworthEarth,
  1104,
  336,
  DEFAULT_RELAY,
)
check(rescue.dtePct === 0, 'Known no-DTE site remains without a direct link')
check(
  rescue.relayPct > 0 && rescue.relayPct < 100,
  'Hypothetical relay offers partial geometry at no-DTE site',
)
near(
  rescue.combinedPct,
  rescue.relayPct,
  1e-8,
  'Combined geometry equals relay when no DTE exists',
)
const phaseSweep = relayPhaseSweep(
  realMoon,
  haworth,
  haworthEarth,
  1104,
  336,
  DEFAULT_RELAY,
)
check(
  phaseSweep.samples.length === 24 &&
    phaseSweep.samples[0].phaseDeg === 0 &&
    phaseSweep.samples.at(-1)?.phaseDeg === 345,
  'Relay phase sweep covers one orbit at 15 degree spacing',
)
check(
  phaseSweep.best.result.longestGapH <= phaseSweep.samples[0].result.longestGapH,
  'Outage-first phase sweep is never worse than the included zero-degree phase',
)
check(
  phaseSweep.samples.every((sample) =>
    sample.result.combinedPct >= 0 && sample.result.combinedPct <= 100),
  'Every phase-sweep availability remains bounded',
)
assert.throws(() =>
  relayPhaseSweep(realMoon, haworth, haworthEarth, 1104, 336, DEFAULT_RELAY, 17),
)
console.log(
  `Haworth relay concept: ${rescue.relayPct.toFixed(1)}% coverage, ${rescue.longestGapH.toFixed(2)} h maximum combined gap; best sampled phase ${phaseSweep.best.phaseDeg}° gives ${phaseSweep.best.result.longestGapH.toFixed(2)} h`,
)
console.log(`Landing / surface / relay: ${checks} checks passed`)
