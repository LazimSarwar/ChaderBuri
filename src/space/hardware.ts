import * as T from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { foilNormalTexture, lunarSurround, lunarSurroundTexture, solarCellTexture } from './surfaceTextures'

/**
 * Shared, consistent PBR materials and procedural geometry for the illustrative surface hardware
 * (generic robotic lander, example solar panel and antenna). Presentation only.
 */
export type HardwareMaterials = {
  gold: T.MeshStandardMaterial; silver: T.MeshStandardMaterial; white: T.MeshStandardMaterial; radiator: T.MeshStandardMaterial
  solar: T.MeshStandardMaterial; metal: T.MeshStandardMaterial; dark: T.MeshStandardMaterial; pad: T.MeshStandardMaterial
}
let shared: HardwareMaterials | null = null
const rotation = new T.Euler()
export function hardwareMaterials(): HardwareMaterials {
  if (shared) return shared
  const foil = foilNormalTexture(), cells = solarCellTexture(), env = lunarSurroundTexture()
  const make = (p: T.MeshStandardMaterialParameters) => { const m = new T.MeshStandardMaterial({ envMap: env, ...p }); m.envMapRotation = rotation; return m }
  shared = {
    // Multi-layer insulation: crinkled metallised film; gold (Kapton outer layer) and silver (aluminised).
    // Flat crinkle facets (two scales) on a fairly smooth metallised film: each facet catches the Sun or the dark sky
    // on its own, which reads as foil; the low-resolution soft version read as blotches.
    gold: make({ color: '#d6a048', metalness: .62, roughness: .34, normalMap: foil, normalScale: new T.Vector2(.6, .6) }),
    silver: make({ color: '#d2d5d7', metalness: .78, roughness: .28, normalMap: foil, normalScale: new T.Vector2(.5, .5) }),
    // White thermal paint and a glossy dark optical-solar-reflector radiator.
    white: make({ color: '#e3e3dc', metalness: 0, roughness: .58, side: T.DoubleSide }),
    radiator: make({ color: '#4a5056', metalness: .45, roughness: .28 }),
    solar: make({ map: cells, metalness: .35, roughness: .3 }),
    // Machined aluminium / titanium structure, and darker hot-section metal (engine bell, thrusters).
    // Bead-blasted, not polished: a mirror finish reflects the regolith and reads as glass (tanks, struts).
    metal: make({ color: '#b7bbbe', metalness: .78, roughness: .48 }),
    dark: make({ color: '#45423f', metalness: .8, roughness: .5 }),
    // Double-sided: the turned footpad dish shows its inner face from above.
    pad: make({ color: '#8f9192', metalness: .6, roughness: .55, side: T.DoubleSide }),
  }
  return shared
}
/** Orient the shared regolith surround under the local up (world) and scale it with the measured Sun elevation. */
export function lightHardware(worldUp: T.Vector3, sunDirection: T.Vector3) {
  const m = hardwareMaterials(), intensity = lunarSurround(rotation, worldUp, sunDirection)
  for (const material of Object.values(m)) material.envMapIntensity = material.metalness > .5 ? intensity * 1.5 : intensity
}

/** Scale UVs so a texture tile has one real size in metres across all parts. */
export function tileUV(g: T.BufferGeometry, su: number, sv: number) {
  const uv = g.getAttribute('uv') as T.BufferAttribute | undefined
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv)
  return g
}
export type Bake = Partial<Record<keyof HardwareMaterials, T.BufferGeometry[]>>
export function add(bake: Bake, key: keyof HardwareMaterials, g: T.BufferGeometry, m?: T.Matrix4) {
  if (m) g.applyMatrix4(m)
  ;(bake[key] ??= []).push(g)
}
/** Merge each material's parts into one geometry (one draw call per material). */
export function merge(bake: Bake) {
  const out: [keyof HardwareMaterials, T.BufferGeometry][] = []
  for (const [key, list] of Object.entries(bake) as [keyof HardwareMaterials, T.BufferGeometry[]][]) {
    const clean = list.map(g => { const n = g.index ? g.toNonIndexed() : g; if (n !== g) g.dispose(); for (const name of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(name)) n.deleteAttribute(name); if (!n.getAttribute('uv')) n.setAttribute('uv', new T.BufferAttribute(new Float32Array(n.getAttribute('position').count * 2), 2)); return n })
    const merged = mergeGeometries(clean, false)!
    for (const g of clean) g.dispose()
    merged.computeBoundingSphere()
    out.push([key, merged])
  }
  return out
}
const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => new T.Matrix4().makeRotationFromEuler(new T.Euler(rx, ry, rz)).setPosition(x, y, z)
/** A flat-faced prism (faces not smoothed), axis +y, centred at y. */
function prism(radius: number, height: number, sides: number, y: number, radiusTop = radius) {
  const g = new T.CylinderGeometry(radiusTop, radius, height, sides, 1, false).toNonIndexed()
  g.computeVertexNormals(); g.translate(0, y, 0)
  return tileUV(g, 2 * Math.PI * radius, height)
}
function tube(points: [number, number, number][], radius: number) {
  return new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p => new T.Vector3(...p))), 24, radius, 6, false)
}
function box(w: number, h: number, d: number) { return tileUV(new T.BoxGeometry(w, h, d), Math.max(w, d), h) }

/**
 * Generic robotic lander (illustrative): faceted bus wrapped in gold MLI, white top deck with a silver avionics
 * box, side radiators and body-mounted solar arrays, four spherical propellant tanks, a central engine bell,
 * RCS thruster pods, handling rails and harness. Legs are separate (they blend onto measured ground).
 */
export function landerBody(height: number, sides: number) {
  const bake: Bake = {}, R = sides === 6 ? .74 : 1.06, apothem = R * Math.cos(Math.PI / sides), side = 2 * R * Math.sin(Math.PI / sides)
  const bottom = .66, top = height * .86, busH = top - bottom
  // Decks and bus.
  add(bake, 'pad', prism(R + .05, .05, sides, bottom - .02))
  add(bake, 'gold', tileUV(prism(R, busH, sides, bottom + busH / 2), .9, .9))
  add(bake, 'white', prism(R + .06, .06, sides, top + .03))
  add(bake, 'metal', prism(R + .075, .025, sides, top + .005))
  // Side faces: radiators, body-mounted arrays and bare foil, alternating; each panel stands just proud of the foil.
  const plan = sides === 6 ? ['radiator', 'solar', 'gold', 'radiator', 'solar', 'gold'] : ['radiator', 'gold', 'solar', 'gold', 'radiator', 'gold', 'solar', 'gold']
  for (let k = 0; k < sides; k++) {
    const a = (k + .5) * 2 * Math.PI / sides, kind = plan[k], w = side * .78, h = busH * .72, y = bottom + busH * .52
    const place = (out: number) => at(Math.sin(a) * (apothem + out), y, Math.cos(a) * (apothem + out), 0, a, 0)
    if (kind === 'radiator') {
      add(bake, 'white', box(w + .06, h + .06, .02), place(.012))
      add(bake, 'radiator', box(w, h, .012), place(.026))
    } else if (kind === 'solar') {
      add(bake, 'metal', box(w + .05, h + .05, .02), place(.012))
      add(bake, 'solar', tileUV(new T.PlaneGeometry(w, h), w / .45, h / .45), place(.024))
    }
  }
  // Top: silver avionics box with a white lid, a high-gain dish on a short mast, handling rails.
  add(bake, 'silver', tileUV(box(.82, .26, .62), 1.2, 1.2), at(-.05, top + .19, -.08))
  add(bake, 'white', box(.86, .03, .66), at(-.05, top + .335, -.08))
  add(bake, 'metal', new T.CylinderGeometry(.025, .03, .38, 10), at(.55, top + .25, -.45))
  const dish = new T.LatheGeometry(Array.from({ length: 9 }, (_, i) => { const r = i / 8 * .2; return new T.Vector2(r, r * r * 1.9) }), 24)
  add(bake, 'white', dish, at(.55, top + .46, -.45, -.5, 2.4, 0))
  add(bake, 'metal', new T.TorusGeometry(.2, .008, 6, 24), at(.55, top + .46, -.45, -.5 + Math.PI / 2, 2.4, 0).multiply(new T.Matrix4().makeTranslation(0, 0, .076)))
  for (const s of [-1, 1]) add(bake, 'metal', tube([[s * .32, top + .06, .45], [s * .32, top + .2, .5], [s * .1, top + .2, .52], [s * .02, top + .06, .5]], .012))
  // RCS thruster pods: a block and two small nozzles at alternating corners.
  for (let k = 0; k < sides; k += 2) {
    const a = k * 2 * Math.PI / sides, x = Math.sin(a) * (R + .03), z = Math.cos(a) * (R + .03)
    add(bake, 'silver', box(.12, .1, .12), at(x, top - .1, z, 0, a, 0))
    for (const s of [-1, 1]) add(bake, 'dark', new T.CylinderGeometry(.018, .035, .07, 10, 1, true), at(x + Math.cos(a) * s * .07, top - .12, z - Math.sin(a) * s * .07, 0, 0, s * Math.PI / 2).multiply(new T.Matrix4().makeRotationY(a)))
  }
  // Under the bus: four titanium propellant tanks with mounting bands, and the central engine.
  for (let k = 0; k < 4; k++) {
    const a = (k + .5) * Math.PI / 2, x = Math.sin(a) * R * .5, z = Math.cos(a) * R * .5
    add(bake, 'metal', new T.SphereGeometry(.21, 24, 16), at(x, bottom - .17, z))
    add(bake, 'dark', new T.TorusGeometry(.212, .012, 6, 28), at(x, bottom - .17, z, Math.PI / 2))
    add(bake, 'metal', new T.CylinderGeometry(.02, .02, .2, 6), at(x, bottom - .06, z))
  }
  const bell = Array.from({ length: 12 }, (_, i) => { const t = i / 11; return new T.Vector2(.075 + .2 * Math.pow(t, 1.6), .42 * (1 - t)) })
  add(bake, 'dark', new T.LatheGeometry(bell, 28), at(0, .27, 0))
  add(bake, 'silver', new T.CylinderGeometry(.14, .1, .12, 16), at(0, .72, 0))
  // Harness running down two faces.
  add(bake, 'dark', tube([[R * .95, top - .05, .1], [R + .05, top - .4, .18], [R + .06, bottom + .3, .2], [R * .8, bottom - .02, .25]], .013))
  add(bake, 'dark', tube([[-R * .9, top - .1, -.2], [-R - .05, bottom + .6, -.25], [-R - .04, bottom + .1, -.3], [-R * .7, bottom - .03, -.32]], .013))
  return { geometries: merge(bake), top, bottom }
}

/** Example solar panel head: aluminium frame, cell field with busbars, white back and a hinge bracket. Cells face +y. */
export function solarPanelHead() {
  const bake: Bake = {}
  add(bake, 'solar', tileUV(new T.PlaneGeometry(2, 1), 2 / .25, 1 / .25).rotateX(-Math.PI / 2), at(0, .02, 0))
  add(bake, 'white', box(2.0, .02, 1.0), at(0, 0, 0))
  for (const z of [-.51, .51]) add(bake, 'metal', box(2.06, .04, .025), at(0, .01, z))
  for (const x of [-1.015, 1.015]) add(bake, 'metal', box(.03, .04, 1.02), at(x, .01, 0))
  for (const x of [-.34, .34]) add(bake, 'metal', box(.02, .035, .98), at(x, -.025, 0))
  add(bake, 'metal', box(.18, .06, .14), at(0, -.05, 0))
  return merge(bake)
}
/** Example antenna head: parabolic dish facing +z, rim, tripod feed struts and feed horn, rear hub. */
export function antennaHead() {
  const bake: Bake = {}, radius = .34, depth = .08, focus = radius * radius / (4 * depth)
  const profile = Array.from({ length: 13 }, (_, i) => { const r = i / 12 * radius; return new T.Vector2(r, r * r / (4 * focus)) })
  add(bake, 'white', new T.LatheGeometry(profile, 36), at(0, 0, 0, Math.PI / 2))
  add(bake, 'metal', new T.TorusGeometry(radius, .01, 6, 36), at(0, 0, depth))
  for (let k = 0; k < 3; k++) {
    const a = k * 2 * Math.PI / 3 + Math.PI / 6
    add(bake, 'metal', tube([[Math.cos(a) * radius * .96, Math.sin(a) * radius * .96, depth], [0, 0, focus - .02]], .006))
  }
  add(bake, 'dark', new T.CylinderGeometry(.03, .022, .07, 12), at(0, 0, focus, Math.PI / 2))
  add(bake, 'metal', new T.CylinderGeometry(.07, .09, .08, 16), at(0, 0, -.03, Math.PI / 2))
  return merge(bake)
}
/** Antenna electronics box (gold MLI with a radiator face). */
export function antennaBase() {
  const bake: Bake = {}
  add(bake, 'gold', box(.4, .3, .32), at(0, .15, 0))
  add(bake, 'radiator', box(.3, .2, .01), at(0, .15, .165))
  add(bake, 'white', box(.42, .02, .34), at(0, .31, 0))
  return merge(bake)
}
