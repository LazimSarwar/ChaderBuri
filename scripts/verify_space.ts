import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Vector3, Quaternion } from 'three'
import { travelPosition } from '../src/space/camera.ts'
import {
  positionAt,
  positionsAt,
  attitudeAt,
  orbitPoints,
  toScene,
  UNIT_KM,
  type Manifest,
  type SpaceData,
} from '../src/space/ephemeris.ts'

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'))
const manifest: Manifest = json('public/data/space/manifest.json')
const data: SpaceData = {
  ...manifest,
  bodies: manifest.bodies.map((b) => {
    const v = readFileSync('public' + b.vectors),
      q = readFileSync('public' + b.attitude)
    return {
      ...b,
      states: new Float64Array(
        v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength),
      ),
      rotations: new Float32Array(
        q.buffer.slice(q.byteOffset, q.byteOffset + q.byteLength),
      ),
    }
  }),
}
let checks = 0
function check(v: unknown, message: string) {
  assert.ok(v, message)
  checks++
}
check(data.bodies.length === 21, 'Sun, 8 planets, 12 moons')
check(data.bodies.find(b=>b.name==='Moon')!.parent==='Earth','Moon orbits Earth in the source hierarchy')
for(const name of ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'])
  check(data.bodies.find(b=>b.name===name)!.parent==='Sun',`${name} orbits the Sun`)
for(const hour of [0,1234.5,8760]){
  const scene=positionsAt(data,hour)
  for(const b of data.bodies.filter(b=>b.parent)){
    const relative=scene.get(b.name)!.clone().sub(scene.get(b.parent!)!).multiplyScalar(UNIT_KM)
    const raw=positionAt(b,hour)
    check(relative.distanceTo(new Vector3(raw.x,raw.z,-raw.y))<1e-5,`${b.name} follows its moving parent at hour ${hour}`)
  }
}
const earthBody=data.bodies.find(b=>b.name==='Earth')!,moonBody=data.bodies.find(b=>b.name==='Moon')!
const lunarDirection=(hour:number)=>{const ps=positionsAt(data,hour);return ps.get('Moon')!.clone().sub(ps.get('Earth')!)}
const lunarSweep=lunarDirection(0).angleTo(lunarDirection(7*24))*180/Math.PI
const earthSweep=positionAt(earthBody,0).angleTo(positionAt(earthBody,90*24))*180/Math.PI
check(lunarSweep>60&&lunarSweep<120,'Moon makes approximately a quarter orbit about Earth in a week')
check(earthSweep>60&&earthSweep<120,'Earth makes approximately a quarter orbit about the Sun in 90 days')
check(lunarDirection(7*24).length()*UNIT_KM>350000&&lunarDirection(7*24).length()*UNIT_KM<420000,'Earth–Moon distance remains physical')
const earthSpin=attitudeAt(earthBody,0).angleTo(attitudeAt(earthBody,1))*180/Math.PI
const moonSpin=attitudeAt(moonBody,0).angleTo(attitudeAt(moonBody,24))*180/Math.PI
check(earthSpin>14&&earthSpin<16,'Earth spin follows a sidereal day rather than an arbitrary animation')
check(moonSpin>10&&moonSpin<16,'Moon spin follows its slow synchronous orientation')
check(
  (Date.parse(data.stop) - Date.parse(data.start)) / 3600000 === data.hours,
  'UTC coverage',
)
const axes = [
  new Vector3(UNIT_KM, 0, 0),
  new Vector3(0, UNIT_KM, 0),
  new Vector3(0, 0, UNIT_KM),
].map(toScene)
check(
  axes[0].clone().cross(axes[1]).distanceTo(axes[2]) < 1e-15,
  'Frame remains right-handed',
)
for (const b of data.bodies) {
  check(Number.isFinite(b.bodyGM) && b.bodyGM > 0, b.name + ' NAIF body GM')
  check(
    b.states.length === b.count * 6 &&
      b.rotations.length === b.attitudeCount * 4,
    b.name + ' dimensions',
  )
  check((b.count - 1) * b.stepHours === data.hours, b.name + ' full coverage')
  check(
    b.states.every(Number.isFinite) && b.rotations.every(Number.isFinite),
    b.name + ' finite data',
  )
  for (const h of [0, 0.5, 994.766, 12345.5, data.hours]) {
    const q = attitudeAt(b, h)
    check(Math.abs(q.length() - 1) < 1e-12, b.name + ' unit attitude')
    const p = positionAt(b, h)
    check(Number.isFinite(p.length()), b.name + ' valid interpolation')
  }
  for (const i of [0, Math.floor(b.count / 2), b.count - 1])
    check(
      positionAt(b, i * b.stepHours).distanceTo(
        new Vector3().fromArray(b.states, i * 6),
      ) < 1e-6,
      b.name + ' exact sample/end boundary',
    )
  const points = orbitPoints(b, 994)
  if (b.parent) {
    check(points.length === 257, b.name + ' orbit guide')
    check(
      points[0].distanceTo(points.at(-1)!) < 1e-6,
      b.name + ' closed ellipse',
    )
  }
}
// An analytic circular orbit checks interpolation between, rather than only at, stored samples.
const period = 24 * 3600,
  radius = 100000,
  w = (2 * Math.PI) / period,
  step = 0.5,
  states = new Float64Array(12)
for (let i = 0; i < 2; i++) {
  const t = i * step * 3600
  states.set(
    [
      radius * Math.cos(w * t),
      radius * Math.sin(w * t),
      0,
      -radius * w * Math.sin(w * t),
      radius * w * Math.cos(w * t),
      0,
    ],
    i * 6,
  )
}
const interpolated = positionAt({ states, count: 2, stepHours: step }, step / 2)
check(
  interpolated.distanceTo(
    new Vector3(
      radius * Math.cos(w * step * 1800),
      radius * Math.sin(w * step * 1800),
      0,
    ),
  ) < 0.08,
  'Hermite midpoint error under 80 m on test orbit',
)
// Validate the new inertial scene against the independent, site-based Horizons observer product.
// Observer products include apparent corrections; allow 0.04° for their differing definition.
const moon = data.bodies.find((b) => b.name === 'Moon')!,
  sites = json('public/data/sites.json')
const siteList = Array.isArray(sites) ? sites : sites.sites
let maxAngle = 0
for (const site of siteList) {
  const lat = (site.lat * Math.PI) / 180,
    lon = (site.lonEast * Math.PI) / 180
  const up = new Vector3(
    Math.cos(lat) * Math.cos(lon),
    Math.sin(lat),
    -Math.cos(lat) * Math.sin(lon),
  )
  const east = new Vector3(-Math.sin(lon), 0, -Math.cos(lon)),
    north = new Vector3(
      -Math.sin(lat) * Math.cos(lon),
      Math.cos(lat),
      Math.sin(lat) * Math.sin(lon),
    )
  for (const target of ['Sun', 'Earth']) {
    const rows = json(
      `public/data/ephemeris/${site.slug}.${target.toLowerCase()}.json`,
    ).rows
    for (const h of [0, 995, 8760, 20448]) {
      const ps = positionsAt(data, h),
        q = attitudeAt(moon, h).invert()
      const direction = ps
        .get(target)!
        .clone()
        .sub(ps.get('Moon')!)
        .applyQuaternion(q)
        .sub(
          up
            .clone()
            .multiplyScalar(1 + (site.siteHeightM ?? 0) / (UNIT_KM * 1000)),
        )
        .normalize()
      const row = rows[h],
        a = (row.az * Math.PI) / 180,
        e = (row.el * Math.PI) / 180
      const expected = north
        .clone()
        .multiplyScalar(Math.cos(e) * Math.cos(a))
        .addScaledVector(east, Math.cos(e) * Math.sin(a))
        .addScaledVector(up, Math.sin(e))
      const angle = (direction.angleTo(expected) * 180) / Math.PI
      maxAngle = Math.max(maxAngle, angle)
      check(
        angle < 0.04,
        `${site.slug} ${target} hour ${h}: angular discrepancy ${angle} degrees`,
      )
      // Sun-light direction survives the local-body attitude transform.
      check(
        direction.clone().applyQuaternion(q.clone().invert()).length() >
          0.999999,
        'Lighting rotation preserves direction length',
      )
    }
  }
}
for (const asset of json('public/data/space/assets.json')) {
  check(
    createHash('sha256')
      .update(readFileSync('public' + asset.path))
      .digest('hex') === asset.sha256,
    'Asset integrity ' + asset.body,
  )
}
const circular = orbitPoints({...moon, parentGM:100, bodyGM:1, count:1, states:new Float64Array([1000,0,0,0,Math.sqrt(101/1000),0])},0)
const circularRadii = circular.map(p=>p.length()*UNIT_KM)
check(Math.max(...circularRadii)-Math.min(...circularRadii)<1e-8,'Two-body circular guide uses both masses')
check(Math.abs(circularRadii[0]-1000)<1e-8,'Analytic relative circular orbit radius')
const departure = new Vector3(10, 0, 0),
  arrival = new Vector3(-100000, 0, 0)
check(
  travelPosition(departure, arrival, 0).distanceTo(departure) < 1e-10,
  'Camera departure is continuous',
)
check(
  travelPosition(departure, arrival, 1).distanceTo(arrival) < 1e-8,
  'Camera arrives exactly',
)
for (let i = 0; i <= 100; i++)
  check(
    Math.abs(
      travelPosition(departure, arrival, i / 100).length() -
        10 * 10000 ** (i / 100),
    ) < 1e-8,
    'Antipodal camera motion preserves logarithmic distance',
  )
const polar = json('public/textures/polar_heightmeta.json')
check(
  polar.centerLat === -90 &&
    polar.edgeLat === -84 &&
    polar.longitudeZero === 'up',
  'Atlas projection matches regenerated LOLA raster',
)
check(
  new Quaternion().identity().angleTo(new Quaternion()) === 0,
  'Quaternion convention',
)
console.log(
  `Space checks passed: ${checks}; independent scene/observer maximum discrepancy ${maxAngle.toFixed(5)} degrees.`,
)
