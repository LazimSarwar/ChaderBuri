/**
 * Verifies the Mission Architect solver against ground truth that does not
 * depend on it:
 *
 *   1. Full-window metrics reproduce public/data/dutycycle/*.json (the output of
 *      scripts/compute_duty_cycle.py) for every site — lit/link hours and the
 *      four longest-streak figures.
 *   2. windowStats() equals a naive, independently written loop on random windows.
 *   3. solve() returns exactly the brute-force set of passing landings for random
 *      constraint sets, and relaxing constraints never loses a passing landing.
 *   4. Known site facts from the build report still hold.
 *
 * Run:  npm run verify:architect
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildSeries,
  windowStats,
  solve,
  evaluate,
  CELL_PASS,
  type Constraints,
  type SiteSeries,
} from '../src/architect/solver.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA = join(ROOT, 'public', 'data')
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'))

let failures = 0
let checks = 0
function check(ok: boolean, msg: string) {
  checks++
  if (!ok) {
    failures++
    console.log(`  ✗ FAIL  ${msg}`)
  }
}

// ---- independent classification (does NOT use solver code) -------------------
type Row = { az: number; el: number }
function flagsFor(rows: Row[], profile: number[]): number[] {
  return rows.map((r) => (r.el > profile[((Math.round(r.az) % 360) + 360) % 360] ? 1 : 0))
}
function naiveCount(f: number[], s: number, e: number) {
  let n = 0
  for (let i = s; i < e; i++) n += f[i]
  return n
}
function naiveLongest(f: number[], s: number, e: number, v: number) {
  let best = 0
  let cur = 0
  for (let i = s; i < e; i++) {
    if (f[i] === v) best = Math.max(best, ++cur)
    else cur = 0
  }
  return best
}

// seeded PRNG so failures are reproducible
function mulberry32(a: number) {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rnd = mulberry32(20261114)
const rint = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1))

// ---- load every site ----------------------------------------------------------
const sites: { slug: string; name: string }[] = readJson(join(DATA, 'sites.json'))
const series: SiteSeries[] = []
const flags: Record<string, { lit: number[]; link: number[] }> = {}
for (const s of sites) {
  const sun = readJson(join(DATA, 'ephemeris', `${s.slug}.sun.json`)).rows
  const earth = readJson(join(DATA, 'ephemeris', `${s.slug}.earth.json`)).rows
  const horizon = readJson(join(DATA, 'horizons', `${s.slug}.json`))
  series.push(buildSeries(s.slug, sun, earth, horizon))
  flags[s.slug] = { lit: flagsFor(sun, horizon.profile), link: flagsFor(earth, horizon.profile) }
}
const N = series[0].hours
console.log(`Loaded ${series.length} sites, ${N} hourly rows each.\n`)

// ---- 1. reproduce the published duty cycle -----------------------------------
console.log('1. Full-window metrics vs compute_duty_cycle.py output')
console.log(
  '   ' + 'site'.padEnd(22) + 'lit h'.padStart(7) + 'link h'.padStart(8) + 'maxLit'.padStart(8) +
  'maxDark'.padStart(9) + 'maxLink'.padStart(9) + 'maxGap'.padStart(8) + '   match',
)
for (const s of series) {
  const duty = readJson(join(DATA, 'dutycycle', `${s.slug}.json`))
  const w = windowStats(s, 0, s.hours)
  const same =
    w.litHours === duty.litHours &&
    w.linkHours === duty.linkHours &&
    w.longestLitH === duty.longestLitH &&
    w.longestDarkH === duty.longestDarkH &&
    w.longestLinkH === duty.longestLinkH &&
    w.longestGapH === duty.longestNoLinkH &&
    +w.litPct.toFixed(1) === duty.litPct &&
    +w.linkPct.toFixed(1) === duty.linkPct &&
    s.hours === duty.hours
  check(same, `${s.slug} full-window metrics differ from duty-cycle JSON`)
  console.log(
    '   ' + s.slug.padEnd(22) + String(w.litHours).padStart(7) + String(w.linkHours).padStart(8) +
    String(w.longestLitH).padStart(8) + String(w.longestDarkH).padStart(9) +
    String(w.longestLinkH).padStart(9) + String(w.longestGapH).padStart(8) + (same ? '   ✓' : '   ✗'),
  )
}

// ---- 2. windowStats vs naive loops -------------------------------------------
console.log('\n2. windowStats vs naive loops (random windows, every site)')
let windowsChecked = 0
for (const s of series) {
  const { lit, link } = flags[s.slug]
  for (let k = 0; k < 400; k++) {
    const len = rint(24, 24 * 30)
    const a = rint(0, s.hours - len)
    const b = a + len
    const w = windowStats(s, a, b)
    const ok =
      w.litHours === naiveCount(lit, a, b) &&
      w.linkHours === naiveCount(link, a, b) &&
      w.longestLitH === naiveLongest(lit, a, b, 1) &&
      w.longestDarkH === naiveLongest(lit, a, b, 0) &&
      w.longestLinkH === naiveLongest(link, a, b, 1) &&
      w.longestGapH === naiveLongest(link, a, b, 0)
    check(ok, `${s.slug} window [${a},${b}) mismatch`)
    windowsChecked++
  }
}
console.log(`   ${windowsChecked} random windows compared`)

// ---- 3. solve() vs brute force; monotonic relaxation -------------------------
console.log('\n3. solve() vs brute force, and relaxation monotonicity')
function randomConstraints(): Constraints {
  return {
    missionDays: rint(3, 30),
    minLitPct: rint(0, 100),
    maxDarkH: rint(0, 400),
    minLinkPct: rint(0, 100),
    maxGapH: rint(0, 400),
  }
}
function bruteForcePasses(c: Constraints, stepH: number): Set<string> {
  const mh = c.missionDays * 24
  const set = new Set<string>()
  for (const s of series) {
    const { lit, link } = flags[s.slug]
    for (let a = 0; a + mh <= s.hours; a += stepH) {
      const b = a + mh
      const litOk = naiveCount(lit, a, b) * 100 >= c.minLitPct * mh
      const darkOk = naiveLongest(lit, a, b, 0) <= c.maxDarkH
      const linkOk = naiveCount(link, a, b) * 100 >= c.minLinkPct * mh
      const gapOk = naiveLongest(link, a, b, 0) <= c.maxGapH
      if (litOk && darkOk && linkOk && gapOk) set.add(`${s.slug}@${a}`)
    }
  }
  return set
}
let nonEmpty = 0
let empty = 0
for (let trial = 0; trial < 25; trial++) {
  // bias half of the trials toward satisfiable settings so both outcomes are exercised
  const c = randomConstraints()
  if (trial % 2 === 0) {
    c.minLitPct = rint(0, 40)
    c.minLinkPct = rint(0, 40)
    c.maxDarkH = rint(150, 400)
    c.maxGapH = rint(150, 400)
  } else if (trial === 1) {
    // deterministic impossible anchor: no site has both a fully-lit AND a
    // gap-free-Earth 90-day stretch (de Gerlache has 143 lit days but 304 h
    // of link gaps; Leibnitz Beta has gap-free Earth but 27 lit days max), so
    // this set must stay empty even as better sites join the catalog
    c.minLitPct = 100
    c.minLinkPct = 100
    c.missionDays = 90
  }
  const mh = c.missionDays * 24
  const res = solve(series, c, { firstStart: 0, lastStart: N, stepH: 6 })
  const expected = bruteForcePasses(c, 6)
  const got = new Set<string>()
  for (const s of series) {
    const strip = res.strips[s.slug]
    for (let i = 0; i < strip.length; i++) if (strip[i] === CELL_PASS) got.add(`${s.slug}@${res.starts[i]}`)
  }
  const same = expected.size === got.size && [...expected].every((k) => got.has(k))
  check(same, `solve() pass set != brute force for ${JSON.stringify(c)}`)
  check(res.passCount === expected.size, `passCount mismatch for ${JSON.stringify(c)}`)
  // every opportunity run must contain only passing landings and its `best` must pass
  for (const o of res.opportunities) {
    check(o.best.pass && o.best.margin >= 0, `opportunity best must pass: ${o.slug}`)
    check(o.best.endRow - o.best.startRow === mh, 'window length must equal mission length')
  }
  if (expected.size > 0) nonEmpty++
  else empty++

  // relaxing every limit must not lose any passing landing
  const relaxed: Constraints = {
    missionDays: c.missionDays,
    minLitPct: Math.max(0, c.minLitPct - rint(0, 20)),
    maxDarkH: c.maxDarkH + rint(0, 100),
    minLinkPct: Math.max(0, c.minLinkPct - rint(0, 20)),
    maxGapH: c.maxGapH + rint(0, 100),
  }
  const res2 = solve(series, relaxed, { firstStart: 0, lastStart: N, stepH: 6 })
  check(res2.passCount >= res.passCount, `relaxing constraints lost passes: ${JSON.stringify(c)}`)
}
check(nonEmpty > 0 && empty > 0, 'property test should exercise both satisfiable and impossible cases')
console.log(`   25 random constraint sets: ${nonEmpty} had passing windows, ${empty} were impossible`)

// ---- 4. known facts from the build report ------------------------------------
console.log('\n4. Known site facts')
const floor = series.find((s) => s.slug === 'shackleton-floor')!
const permissive: Constraints = { missionDays: 14, minLitPct: 1, maxDarkH: 99999, minLinkPct: 0, maxGapH: 99999 }
const floorRes = solve([floor], permissive, { firstStart: 0, lastStart: N, stepH: 1 })
check(floorRes.passCount === 0, 'Shackleton Floor must never pass even a 1% sunlight requirement')
console.log(`   Shackleton Floor: ${floorRes.passCount} passing landings at >=1% sunlight (expected 0)  ${floorRes.passCount === 0 ? '✓' : '✗'}`)

const im1 = series.find((s) => s.slug === 'im-1-odysseus-site')!
let im1Always = true
for (let a = 0; a + 336 <= im1.hours; a++) {
  const w = windowStats(im1, a, a + 336)
  if (w.linkPct !== 100 || w.longestGapH !== 0) im1Always = false
}
check(im1Always, 'IM-1 Odysseus site must have 100% Earth link in every 14-day window')
console.log(`   IM-1 Odysseus site: 100% Earth link in every 14-day window  ${im1Always ? '✓' : '✗'}`)

// evaluate() boundary behaviour: exactly-on-the-limit must pass
const edge = evaluate(
  { startRow: 0, endRow: 100, hours: 100, litHours: 60, linkHours: 50, litPct: 60, linkPct: 50, longestLitH: 60, longestDarkH: 40, longestLinkH: 50, longestGapH: 50 },
  { missionDays: 100 / 24, minLitPct: 60, maxDarkH: 40, minLinkPct: 50, maxGapH: 50 },
)
check(edge.pass && edge.margin === 0, 'a window exactly on every limit must pass with margin 0')
console.log(`   Exactly-on-the-limit window passes with margin 0  ${edge.pass && edge.margin === 0 ? '✓' : '✗'}`)

// ---- timing -------------------------------------------------------------------
const demo = solve(series, { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72 }, { firstStart: 0, lastStart: N, stepH: 6 })
console.log(`\nTiming: one full solve (${series.length} sites x ${demo.starts.length} landings) took ${demo.ms.toFixed(1)} ms`)

// sanity: data files present for every site
const have = readdirSync(join(DATA, 'dutycycle')).length
check(have === sites.length, 'one duty-cycle file per site')

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'} (${checks} assertions)`)
process.exit(failures === 0 ? 0 : 1)
