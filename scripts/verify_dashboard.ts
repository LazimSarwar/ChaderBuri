import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries, evaluateWindow, solve, type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { against, placesFor, verdictText } from '../src/architect/verdictText.ts'
import { equipmentLine } from '../src/lib/missionSummary.ts'
import { DEFAULT_THERMAL } from '../src/architect/thermal.ts'
import { keyMoments, missionTimeline, momentAt, skylineSentence } from '../src/lib/missionMoment.ts'
import { missionConsequence, missionTrace } from '../src/lib/missionConsequence.ts'
import { bestOtherSite, compareFairly, type FairSide } from '../src/lib/fairCompare.ts'

let checks = 0
const check = (v: unknown, m: string) => { assert.ok(v, m); checks++ }
const read = (p: string) => JSON.parse(readFileSync('public/data/' + p, 'utf8'))
const sites = (read('sites.json') as { slug: string }[]).map(s => s.slug)
const raw = new Map(sites.map(slug => [slug, { sun: read(`ephemeris/${slug}.sun.json`).rows, earth: read(`ephemeris/${slug}.earth.json`).rows, horizon: read(`horizons/${slug}.json`) }]))
const series = sites.map(slug => { const d = raw.get(slug)!; return buildSeries(slug, d.sun, d.earth, d.horizon) })
const c: Constraints = { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER } }
const result = solve(series, c, { firstStart: 0, lastStart: 24 * 120, stepH: 6 })
const bySlug = new Map(series.map(s => [s.slug, s]))

// A passing landing: "meets your selected requirements", never "the mission works".
const best = result.opportunities[0]
const pass = verdictText(evaluateWindow(bySlug.get(best.slug)!, best.best.startRow, best.best.startRow + 14 * 24, c), c)
check(pass.headline === 'Meets your selected requirements', 'A pass is worded as meeting the selected requirements')
check(!/mission works|safe|guarantee/i.test(JSON.stringify(pass)), 'A pass never claims the mission works or is safe')
check(pass.marginLabel === 'Smallest margin' && /above your|under your|exactly at/.test(pass.margin) && !/below|over /.test(pass.margin), `A pass names its smallest margin in the right direction (${pass.margin})`)
check(pass.assessed.includes('Battery') && pass.notAssessed.some(s => /hazards/.test(s)) && pass.notAssessed.some(s => /Night survival/.test(s)), 'A pass lists what was checked and what was not')

// Failing landings: the reason quotes the same numbers as the calculation.
let failures = 0
for (const x of result.closest) {
  const s = bySlug.get(x.slug)!
  for (let row = 0; row + 14 * 24 <= Math.min(s.hours, 24 * 120); row += 24 * 9) {
    const ev = evaluateWindow(s, row, row + 14 * 24, c), v = verdictText(ev, c)
    check(v.headline === (ev.pass ? 'Meets your selected requirements' : 'Misses your selected requirements'), `${x.slug}@${row}: headline follows the calculation`)
    if (ev.pass) continue
    failures++
    check(v.marginLabel === 'Biggest shortfall', `${x.slug}@${row}: a failure names its biggest shortfall`)
    // Minimums (reserve, sunlight, Earth in view, survival temperature) are missed from below; maximums (darkness, Earth gap) from above.
    const minimum = ['battery', 'lit', 'link', 'thermal'].includes(ev.limiting)
    check(minimum ? /below/.test(v.margin) && !/ over /.test(v.margin) : / over your limit/.test(v.margin) && !/below/.test(v.margin), `${x.slug}@${row}: the shortfall points the right way (${v.margin})`)
    if (ev.power && !ev.power.pass) {
      check(v.why.includes(`${ev.power.minPct.toFixed(0)}%`) && v.why.includes(`${c.power!.reservePct}% reserve`), `${x.slug}@${row}: battery reason quotes the computed charge and reserve`)
      if (ev.power.firstReserveH !== null) { const d = Number(/first on day (\d+)/.exec(v.why)?.[1]); check(d >= 1 && d <= 14, `${x.slug}@${row}: the reserve breach day lies inside the 14-day mission (day ${d})`) }
    }
    if (!ev.ok.dark) check(v.why.includes(`${ev.longestDarkH} h`), `${x.slug}@${row}: darkness reason quotes the computed hours`)
    if (!ev.ok.gap) check(v.why.includes(`${ev.longestGapH} h`), `${x.slug}@${row}: Earth-gap reason quotes the computed hours`)
  }
}
check(failures > 5, `Failing landings were exercised (${failures})`)

// Without a battery requirement the verdict says so instead of implying it passed.
const noPower: Constraints = { ...c, power: undefined }
const vp = verdictText(evaluateWindow(bySlug.get(best.slug)!, best.best.startRow, best.best.startRow + 14 * 24, noPower), noPower)
check(!vp.assessed.includes('Battery') && vp.notAssessed.some(s => /Battery \(turned off\)/.test(s)), 'Turning the battery check off is reported as not assessed')

// The mission bar describes the equipment in words.
check(equipmentLine(c) === '2 m² panel (ideal Sun tracking) · 10 kWh battery · 100 W load · 20% reserve', `Equipment line reads plainly (${equipmentLine(c)})`)
check(equipmentLine(noPower) === 'Visibility only · battery not assessed', 'Equipment line says when the battery is not assessed')

// Shared time cursor: every hour's readout matches the models behind the verdict.
const withThermal: Constraints = { ...c, thermal: { ...DEFAULT_THERMAL } }
let windows = 0
for (const [slug, s] of bySlug) {
  const d = raw.get(slug)!
  for (let row = 0; row + 14 * 24 <= Math.min(s.hours, 24 * 120); row += 24 * 23 + 5) for (const cc of [c, withThermal, noPower]) {
    const tl = missionTimeline(s, row, cc), ev = evaluateWindow(s, row, row + 14 * 24, cc), tag = `${slug}@${row}${cc.thermal ? '+thermal' : cc.power ? '' : ' (no battery)'}`
    const trace = cc.power ? missionTrace(s, { id: 0, slug, row, c: cc }) : null
    let flagsAgree = true, modelAgrees = true, minB = Infinity, minT = Infinity, sentences = true
    for (let h = 0; h <= tl.span; h++) {
      const m = momentAt(tl, d.sun, d.earth, d.horizon, h)
      if (h < tl.span) flagsAgree &&= m.sun.visible === (s.litPrefix[row + h + 1] > s.litPrefix[row + h]) && m.earth.visible === (s.linkPrefix[row + h + 1] > s.linkPrefix[row + h])
      if (trace && h < tl.span) {
        const k = missionConsequence(trace, row + h)!
        modelAgrees &&= Math.abs((k.batteryPct ?? NaN) - (m.batteryPct ?? NaN)) < 1e-9 && k.generationW === m.solarW && k.demandW === m.demandW && k.sunVisible === m.sun.visible && k.earthVisible === m.earth.visible
      }
      if (m.batteryPct !== null) minB = Math.min(minB, m.batteryPct)
      if (m.tempC !== null) minT = Math.min(minT, m.tempC)
      const sun = skylineSentence('The Sun', m.sun)
      sentences &&= m.sun.visible ? /above the skyline/.test(sun) : /hidden .* below the skyline/.test(sun)
    }
    check(flagsAgree, `${tag}: the cursor's Sun/Earth state matches the hourly series behind the strips`)
    if (trace) check(modelAgrees, `${tag}: battery, solar power and demand at the cursor match the mission model`)
    check(cc.power ? Math.abs(minB - ev.power!.minPct) < 1e-9 : minB === Infinity, `${tag}: the lowest battery over all cursor positions is the verdict's lowest (${minB})`)
    if (cc.thermal) check(Math.abs(minT - (ev.thermal!.minTempK - 273.15)) < 1e-9, `${tag}: the coldest cursor reading is the verdict's coldest`)
    check(sentences, `${tag}: skyline sentences say above/hidden in line with visibility`)
    const at = (id: string) => keyMoments(tl).find(k => k.id === id)
    const dk = at('dark'), low = at('low'), res = at('reserve'), end = at('end')!
    if (dk) { const m = momentAt(tl, d.sun, d.earth, d.horizon, dk.hour); check(!m.sun.visible && (dk.hour === 0 || momentAt(tl, d.sun, d.earth, d.horizon, dk.hour - 1).sun.visible), `${tag}: "Longest darkness begins" lands on the first dark hour`) }
    if (low) check(Math.abs(momentAt(tl, d.sun, d.earth, d.horizon, low.hour).batteryPct! - ev.power!.minPct) < 1e-9, `${tag}: "Lowest battery" shows the verdict's lowest charge`)
    if (res) check(momentAt(tl, d.sun, d.earth, d.horizon, res.hour).belowReserve && !momentAt(tl, d.sun, d.earth, d.horizon, res.hour - 1).belowReserve, `${tag}: "Drops below reserve" is the first hour below the reserve`)
    check((ev.power?.firstReserveH != null) === !!res, `${tag}: the reserve moment exists exactly when the battery breaches the reserve`)
    check(end.hour === tl.span && momentAt(tl, d.sun, d.earth, d.horizon, end.hour).ended && momentAt(tl, d.sun, d.earth, d.horizon, end.hour).solarW === null, `${tag}: the end of the mission shows no further power flow`)
    check(momentAt(tl, d.sun, d.earth, d.horizon, -5).hour === 0 && momentAt(tl, d.sun, d.earth, d.horizon, 1e6).hour === tl.span, `${tag}: the cursor is clamped to the mission`)
    windows++
  }
}
check(windows > 20, `Cursor readouts were exercised on ${windows} missions`)

// Fair comparisons: one change only, and every word follows the numbers.
const fmtRow = (r: number) => `row ${r}`
const side = (slug: string, row: number, label = slug): FairSide => ({ label, site: slug, slug, row, series: bySlug.get(slug)!, sunRows: raw.get(slug)!.sun, earthRows: raw.get(slug)!.earth, horizon: raw.get(slug)!.horizon })
const DIRECTION: Record<string, (a: ReturnType<typeof evaluateWindow>) => number | null> = { dark: e => -e.longestDarkH, gap: e => -e.longestGapH, lit: e => e.litPct, link: e => e.linkPct, battery: e => e.power?.minPct ?? null }
let pairs = 0
for (let i = 0; i < sites.length; i++) for (let j = 0; j < sites.length; j++) {
  if (i === j || (i + j) % 3) continue
  for (const row of [24 * 10, 24 * 55, 24 * 101]) {
    const A = side(sites[i], row), B = side(sites[j], row), r = compareFairly('sites', A, B, c, fmtRow, equipmentLine(c)), tag = `${sites[i]} vs ${sites[j]} @${row}`
    const ea = evaluateWindow(A.series, row, row + 14 * 24, c), eb = evaluateWindow(B.series, row, row + 14 * 24, c)
    check(r.evA!.pass === ea.pass && r.evB!.pass === eb.pass, `${tag}: both options use the planner's own evaluation`)
    check(r.differs === `Site: ${sites[i]} → ${sites[j]}` && r.same.includes(`Landing ${fmtRow(row)}`) && r.same.includes(equipmentLine(c)) && r.same.includes('14-day mission'), `${tag}: only the site changes; landing, lander and duration are listed as the same`)
    check(r.verdict === (ea.pass && eb.pass ? 'Both meet your selected requirements.' : !ea.pass && !eb.pass ? 'Neither meets your selected requirements.' : `Only ${ea.pass ? sites[i] : sites[j]} meets your selected requirements.`), `${tag}: the verdict sentence follows both results`)
    for (const m of r.metrics) {
      const f = DIRECTION[m.id]
      if (!f) continue
      const a = f(ea)!, b = f(eb)!, tol = m.id === 'dark' || m.id === 'gap' ? 0.5 : 0.5
      check(m.change === (Math.abs(b - a) < tol ? 'same' : b > a ? 'better' : 'worse'), `${tag}: "${m.label}" is called ${m.change} in line with the numbers`)
    }
    check(!/\bon 0\b|worse on 0|better on 0/.test(r.summary), `${tag}: the summary never counts zero measures (${r.summary})`)
    if (ea.longestDarkH !== eb.longestDarkH) for (const [e, nm] of [[ea, sites[i]], [eb, sites[j]]] as const) check(r.why.some(l => l.startsWith(nm + ':') && (e.longestDarkH === 0 ? /never goes below/.test(l) : l.includes(`${e.longestDarkH} h`))), `${tag}: the darkness reason for ${nm} quotes its computed hours`)
    const bridge = r.why.filter(l => /battery has to carry/.test(l))
    check(bridge.length <= 1 && bridge.every(l => l.startsWith((ea.longestDarkH > eb.longestDarkH ? sites[i] : sites[j]) + ':')), `${tag}: the battery note sits with the longer darkness`)
    const energyLine = r.why.find(l => /solar energy\./.test(l)), metric = r.metrics.find(m => m.id === 'energy')!
    if (energyLine) check(energyLine.includes(metric.diff.replace(/ (more|less)$/, '')), `${tag}: the energy reason (${energyLine.slice(0, 60)}…) and the table agree (${metric.diff})`)
    pairs++
  }
}
check(pairs > 20, `Site pairs were compared (${pairs})`)
// Same site, two dates; identical options; a mission outside the data.
const ds = compareFairly('dates', side(best.slug, best.best.startRow, 'first'), side(best.slug, best.best.startRow + 7 * 24, 'second'), c, fmtRow, equipmentLine(c))
check(ds.differs.startsWith('Landing:') && ds.differs.includes('7 days later') && ds.same.includes(`Site: ${best.slug}`), `Dates mode keeps the site and names the shift (${ds.differs})`)
check(ds.why[0].startsWith('Same site'), 'Dates mode explains that the skyline is the same')
const twin = compareFairly('dates', side(best.slug, best.best.startRow, 'one'), side(best.slug, best.best.startRow, 'two'), c, fmtRow, equipmentLine(c))
check(twin.metrics.every(m => m.change === 'same') && /come out the same/.test(twin.summary), 'Identical options come out the same on every measure')
const outside = compareFairly('dates', side(best.slug, 0, 'early'), side(best.slug, bySlug.get(best.slug)!.hours, 'late'), c, fmtRow, equipmentLine(c))
check(outside.evB === null && outside.metrics.length === 0 && /cannot be checked/.test(outside.verdict), 'A mission past the cached data is not compared')
for (const row of [24 * 10, 24 * 55, 24 * 101]) {
  const pick = bestOtherSite(series, best.slug, row, c)!, passers = series.filter(s => s.slug !== best.slug && evaluateWindow(s, row, row + 14 * 24, c).pass)
  check(pick !== best.slug && (passers.length === 0 || passers.some(s => s.slug === pick)), `The default second site at ${row} meets the requirements when any other site does (${pick})`)
}

// Evidence behind each number: every entry says what it means, how it's made, from what, at what resolution, and its limits.
const { EVIDENCE } = await import('../src/lib/evidence.ts')
for (const [id, e] of Object.entries(EVIDENCE)) {
  check(Object.values(e).every(v => typeof v === 'string' && v.trim().length > 2), `Evidence "${id}" has every part filled in`)
  check(!/\b(safe|guarantee[sd]?|certified|approved)\b/i.test(e.meaning + e.method + e.unit), `Evidence "${id}" makes no safety or certainty claims`)
}
check(/not a probability/i.test(EVIDENCE.footprint.unit) && /not part of the verdict/i.test(EVIDENCE.radio.limits) && EVIDENCE.terrain.unit === 'not assessed', 'Counts are not probabilities, radio is outside the verdict and terrain hazards are not assessed')
for (const id of ['verdict', 'lit', 'link', 'dark', 'gap', 'battery', 'thermal', 'solar', 'demand', 'sun', 'earth', 'energy', 'unmet', 'cold', 'footprint', 'height', 'radio', 'terrain']) check(id in EVIDENCE, `Evidence exists for "${id}"`)

// Contrast (WCAG 2.2 AA, 4.5:1 for text): text colours used on the black dashboard.
const css = readFileSync('src/dashboard.css', 'utf8')
const lin = (v: number) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }
const lum = (h: string) => { h = h.slice(1); if (h.length === 3) h = [...h].map(x => x + x).join(''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return .2126 * lin(r) + .7152 * lin(g) + .0722 * lin(b) }
// #000 and #3f3f46 are text on the white primary buttons; #52525b is a decorative list marker.
const ON_LIGHT_OR_DECORATIVE = new Set(['#000', '#3f3f46', '#52525b'])
const low = [...css.matchAll(/(?<![-\w])color:(#[0-9a-fA-F]{3,6})\b/g)].map(m => m[1].toLowerCase()).filter(c => !ON_LIGHT_OR_DECORATIVE.has(c) && (lum(c) + .05) / .05 < 4.5)
check(low.length === 0, `Dashboard text colours reach 4.5:1 on black (failing: ${[...new Set(low)].join(', ')})`)
check(!css.includes('#71717a'), 'The old low-contrast grey is gone')
const planSource = readFileSync('src/architect/MissionArchitect.tsx', 'utf8')
check(!/Safety margin|safety margin/.test(planSource) && /Margin above your requirements/.test(planSource), 'The ranking is described as margin above your requirements, not safety')
const evidenceSource = readFileSync('src/architect/Evidence.tsx', 'utf8')
check(/key !== 'Tab'/.test(evidenceSource) && /focusin/.test(evidenceSource) && /btn\.current\?\.focus\(\)/.test(evidenceSource), 'The evidence dialog keeps Tab inside and returns focus to its button')

// ---- Review, 10 Nov 2026: requirement direction and display precision ----
check(against(5.2, 20, 'min', 'percentage points', 'your reserve') === '15 percentage points below your reserve', '5% against a 20% reserve is 15 points below, not "over the limit"')
check(against(28.1, 20, 'min', 'percentage points', 'your reserve') === '8 percentage points above your reserve', '28% against a 20% reserve is 8 points above')
check(against(120, 72, 'max', 'h', 'your limit') === '48 h over your limit' && against(60, 72, 'max', 'h', 'your limit') === '12 h under your limit', 'Maximum limits are exceeded from above and met from below')
check(placesFor(19.6, 20) === 1 && against(19.6, 20, 'min', 'percentage points', 'your reserve') === '0.4 percentage points below your reserve', 'A value that rounds to its limit gets one more decimal')
check(against(19.996, 20, 'min', 'percentage points', 'your reserve') === 'just below your reserve' && against(20, 20, 'min', 'percentage points', 'your reserve') === 'exactly at your reserve', 'A tiny shortfall is never shown as zero')
{
  // The reviewed case: Malapert, ideal tracking, 17 Oct passes and 24 Oct misses the 20% reserve.
  const ref: Constraints = { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }
  const start = Date.parse(read('prediction-index.json').coverage.start), row = Math.round((Date.parse('2026-10-17T00:00:00Z') - start) / 3_600_000)
  const mal = bySlug.get('malapert-massif')!
  const late = evaluateWindow(mal, row + 168, row + 168 + 14 * 24, ref), v = verdictText(late, ref)
  check(!late.pass && late.limiting === 'battery' && v.margin === `Battery: lowest charge ${late.power!.minPct.toFixed(0)}% against your 20% reserve (${(20 - Number(late.power!.minPct.toFixed(0))).toFixed(0)} percentage points below your reserve).`, `24 Oct: the shortfall reads "below your reserve" (${v.margin})`)
  check(!/over the limit|safety/i.test(v.why + v.margin), '24 Oct: no "over the limit" and no safety wording')
  // A charge just under the reserve is shown with the decimal that makes the shortfall visible.
  const near = { ...late, power: { ...late.power!, minPct: 19.6, pass: false } }
  const vn = verdictText(near, ref)
  check(vn.why.includes('falls to 19.6%, below your 20% reserve') && vn.margin.includes('0.4 percentage points below your reserve'), `19.6% is never shown as "20%, below your 20% reserve" (${vn.why})`)
}
// Scope beside the verdict, one next step, progressive disclosure and larger text.
check(/Nearby touchdowns/.test(planSource) && /not a chance of success/.test(planSource) && /Not checked/.test(planSource), 'The verdict card shows the nearby-touchdown count (not a probability) and what is not checked')
check(/Next step/.test(planSource) && /More actions/.test(planSource) && /className="mp-advanced"/.test(planSource) && /ranked\.slice\(0, 3\)/.test(planSource), 'One next step; equipment and the full ranking behind disclosure')
check(/type="date"/.test(planSource) && /Done — view results/.test(planSource) && /UTC, the one clock/.test(planSource), 'Date fields beside the range sliders, a Done button on phones, UTC explained')
const header = readFileSync('src/DashboardHeader.tsx', 'utf8')
check(/Larger text/.test(header) && /textSize/.test(header) && /data-text-size=large/.test(css), 'A larger-text option scales the dashboard content')
check(/\.dash-nav\{flex-wrap:wrap/.test(css) && /min-height:44px/.test(css), 'Phone section menu wraps; 44px targets')
const opening = readFileSync('src/OpeningScene.tsx', 'utf8'), app = readFileSync('src/App.tsx', 'utf8')
check(/'Explore the Moon' : 'Start'\}<ArrowRight/.test(opening) && /See how one week changes a mission/.test(opening) && /<App openExample=\{example\}\s*\/>/.test(readFileSync('src/main.tsx', 'utf8')) && !/guidedLaunch/.test(readFileSync('src/main.tsx', 'utf8')), 'The welcome opens the workspace (or the one-week example) without an automatic landing')
check(/Showing conditions for/.test(app) && /missionConditions/.test(app) && /setConditionsOn\('scene'\)/.test(app), 'Site conditions show the mission by default, with an explicit mission/scene choice')

console.log(`Dashboard wording checks passed: ${checks}`)
