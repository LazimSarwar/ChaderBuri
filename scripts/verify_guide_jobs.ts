import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildSeries, evaluateWindow, type Constraints } from '../src/architect/solver.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import { DEFAULT_THERMAL } from '../src/architect/thermal.ts'
import { actionLabel, readGuideAction, guideDestinations, MISSION_ACTIONS } from '../src/lib/guideAction.ts'
import { asciiDigits, asksForAction, checkedCompanionReply, contextKey, guardReply, parseCompanionRequest, type CompanionContext, type CompanionReply } from '../src/lib/lunarCompanion.ts'
import { companionEvidence } from '../server/companion-data.ts'
import { companionResponse } from '../server/companion-policy.ts'
import { compareBrief, missionBrief, planEdit, scenarioKey, undoReport, type BriefInput, type MissionState } from '../src/lib/guideBriefs.ts'
import { dayOf, missionTimeline, momentAt } from '../src/lib/missionMoment.ts'
import { compareFairly, type FairSide } from '../src/lib/fairCompare.ts'
import { equipmentLine } from '../src/lib/missionSummary.ts'

let checks = 0
const check = (v: unknown, m: string) => { assert.ok(v, m); checks++ }
const bad = (fn: () => unknown, m: string) => { assert.throws(fn, undefined, m); checks++ }
const read = (p: string) => JSON.parse(readFileSync('public/data/' + p, 'utf8'))
const index = read('prediction-index.json')
const startMs = Date.parse(index.coverage.start)
const sites = (read('sites.json') as { slug: string; name: string }[])
const raw = new Map(sites.map(s => [s.slug, { sun: read(`ephemeris/${s.slug}.sun.json`).rows, earth: read(`ephemeris/${s.slug}.earth.json`).rows, horizon: read(`horizons/${s.slug}.json`) }]))
const bySlug = new Map(sites.map(s => { const d = raw.get(s.slug)!; return [s.slug, buildSeries(s.slug, d.sun, d.earth, d.horizon)] }))
const name = (slug: string) => sites.find(s => s.slug === slug)?.name ?? slug
const fmt = (row: number) => new Date(startMs + row * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
const env = { series: (slug: string) => bySlug.get(slug), name, fmt }
const input = (s: MissionState): BriefInput => ({ ...s, siteName: name(s.slug), series: bySlug.get(s.slug)!, sunRows: raw.get(s.slug)!.sun, earthRows: raw.get(s.slug)!.earth, horizon: raw.get(s.slug)!.horizon, fmt })
const evalAt = (s: MissionState) => evaluateWindow(bySlug.get(s.slug)!, s.row, s.row + s.c.missionDays * 24, s.c)
const BANNED = /\b(safe|guarantee[sd]?|certified|mission works|approved)\b/i

// 1. Every new operation is allowlisted and bounded.
check(MISSION_ACTIONS.every(k => (guideDestinations as readonly string[]).includes(k)) && new Set(guideDestinations).size === guideDestinations.length, 'Mission operations are allowlisted once each')
for (const [kind, value] of [['highlight', 'dark'], ['highlight', 'verdict'], ['compareDates', '7'], ['compareDates', '-3'], ['compareSites', ''], ['compareSites', 'malapert-massif'], ['setLanding', '+7'], ['setLanding', '-14'], ['setSite', 'nobile-rim'], ['setEquipment', 'capacityWh=15000'], ['setEquipment', 'panelAreaM2=3.08'], ['setEquipment', 'missionDays=21'], ['undo', '']] as const)
  check(readGuideAction({ kind, value })?.kind === kind, `${kind} ${value} is accepted`)
for (const [kind, value] of [['highlight', 'everything'], ['compareDates', '0'], ['compareDates', '45'], ['compareDates', 'soon'], ['setLanding', '90'], ['setLanding', '0'], ['setSite', '../etc'], ['compareSites', 'Not A Slug'], ['setEquipment', 'capacityWh=0'], ['setEquipment', 'loadW=20000'], ['setEquipment', 'missionDays=2.5'], ['setEquipment', 'missionDays=31'], ['setEquipment', 'warpDrive=1'], ['setEquipment', 'capacityWh=lots'], ['undo', 'all']] as const)
  bad(() => readGuideAction({ kind, value }), `${kind} ${value} is refused`)

// 2. The guide reads the selected mission: basis travels with the context and stays exact.
const c: Constraints = { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }
const ctx: CompanionContext = { basis: 'mission', slug: 'malapert-massif', row: 1104, constraints: c, datasetId: index.datasetId, model: index.model.version, view: { screen: 'plan', search: '' } }
const parsed = parseCompanionRequest({ context: ctx, messages: [{ role: 'user', content: 'Would landing a week later help?' }] })
check(contextKey(parsed.context) === contextKey(ctx) && parsed.context.basis === 'mission', 'The mission basis survives parsing exactly, so replies stay matched to the mission')
bad(() => parseCompanionRequest({ context: { ...ctx, basis: 'anything' }, messages: [{ role: 'user', content: 'hi' }] }), 'Unknown bases are refused')
const evidence = companionEvidence(parsed.context)
check(evidence.context.basis === 'mission', 'Evidence carries the basis it was calculated for')
const own = bySlug.get(ctx.slug)!
check((evidence.nearbyDates ?? []).length === 6, 'Nearby dates cover ±1, 3 and 7 days')
for (const d of evidence.nearbyDates ?? []) {
  const r = ctx.row + d.offsetDays * 24, e = evaluateWindow(own, r, r + 14 * 24, c)
  check(e.pass === d.pass && (e.power?.minPct ?? null) === d.minBatteryPct && e.longestDarkH === d.darkWithinMissionH && d.landingUTC === new Date(startMs + r * 3_600_000).toISOString(), `Nearby date ${d.offsetDays > 0 ? '+' : ''}${d.offsetDays} d is the planner's own result`)
}
check(checkedCompanionReply({ action: { kind: 'highlight', value: 'dark' }, suggestion: null, message: 'The lander lives on stored energy through this darkness.', visitSlug: null, focus: 'none', questions: [], proposedMission: null }, evidence).action?.kind === 'highlight', 'She may point at evidence while explaining')
check(checkedCompanionReply({ action: null, suggestion: { action: { kind: 'setLanding', value: '7' }, reason: 'A week later the battery stays above the reserve.' }, message: 'A later date could help.', visitSlug: null, focus: 'none', questions: [], proposedMission: null }, evidence).suggestion?.action.kind === 'setLanding', 'Her own mission change waits as a suggestion')
bad(() => checkedCompanionReply({ action: { kind: 'setSite', value: 'atlantis-rim' }, suggestion: null, message: 'Moving there.', visitSlug: null, focus: 'none', questions: [], proposedMission: null }, evidence), 'She cannot move the mission to an unknown site')
const policy = readFileSync('server/companion-policy.ts', 'utf8')
check(/MISSION JOBS/.test(policy) && /nearbyDates/.test(policy) && /never state the result of a change yourself/.test(policy), 'The policy tells her to use nearby dates and let the app report changes')

// The server sends the mission and its nearby dates to the model, and returns a checked highlight.
let sent = ''
const upstream = (async (_url: string, init: RequestInit) => { sent = String(init.body); return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ action: { kind: 'highlight', value: 'battery' }, suggestion: null, message: 'Here is where the battery is lowest.', visitSlug: null, focus: 'none', questions: [], proposedMission: null }) }] } }] }), { status: 200 }) }) as typeof fetch
const res = await companionResponse('POST', { context: ctx, messages: [{ role: 'user', content: 'Where is the battery lowest?' }] }, { apiKey: 'test' }, upstream)
const body = JSON.parse(res.body)
check(res.status === 200 && body.reply.action.kind === 'highlight' && /nearbyDates/.test(sent) && /\\"basis\\":\\"mission\\"/.test(sent), 'A live-shaped request carries the mission and nearby dates; the reply is checked')

// 3. Authored explanations follow the numbers, and every offer is verified before it is offered.
const withThermal: Constraints = { ...c, thermal: { ...DEFAULT_THERMAL } }
const noPower: Constraints = { ...c, power: undefined }
let briefs = 0, offersChecked = 0
for (const s of sites) {
  const ser = bySlug.get(s.slug)!
  for (let row = 24 * 3; row + 30 * 24 <= Math.min(ser.hours, 24 * 200); row += 24 * 31 + 7) for (const cc of [c, withThermal, noPower, { ...c, power: { ...c.power!, loadW: 150 } }]) {
    const st: MissionState = { slug: s.slug, row, c: cc }, ev = evalAt(st), tl = missionTimeline(ser, row, cc), tag = `${s.slug}@${row}${cc.thermal ? '+thermal' : ''}${cc.power ? ` ${cc.power.loadW} W` : ' (no battery)'}`
    const v = missionBrief('verdict', input(st))
    check(v.question === (ev.pass ? 'Why does this mission pass?' : 'Why does this mission miss?') && v.scenario === scenarioKey(st), `${tag}: the verdict explanation follows the calculation`)
    check(!BANNED.test(v.answer + v.next), `${tag}: no safety or success claims`)
    if (!ev.pass && ev.limiting === 'battery') {
      check(v.answer.includes(`${cc.power!.reservePct}% reserve`) && v.answer.includes(`day ${dayOf(tl.reserveRow! - row, cc.missionDays)}`), `${tag}: the battery cause names the reserve and the day it is crossed`)
      check(v.focus?.target === 'dark' || v.focus?.target === 'reserve', `${tag}: she points at the darkness or the reserve crossing`)
    }
    if (!ev.pass && ev.limiting === 'dark') check(v.answer.includes(`${ev.longestDarkH} h`) && v.focus?.target === 'dark', `${tag}: the darkness cause quotes its hours and points at it`)
    if (ev.pass) check(v.focus?.target === ev.limiting && v.offers.every(o => o.action.kind === 'compareSites'), `${tag}: a pass points at its tightest check and only offers a comparison`)
    for (const o of v.offers) {
      if (o.action.kind === 'setLanding' || o.action.kind === 'setEquipment') {
        const r = planEdit(o.action, st, env)
        check(!('error' in r) && evalAt(r.next).pass && /now meets/.test(r.report), `${tag}: offer "${o.label}" really meets the requirements once applied`)
        offersChecked++
      }
      if (o.action.kind === 'compareDates') check(v.offers.some(x => x.action.kind === 'setLanding' && x.action.value === o.action.value) && v.next.includes(fmt(row + Number(o.action.value) * 24)), `${tag}: the compared date is the one named and offered`)
    }
    // Battery at a few moments: the explanation matches the hour's power balance.
    for (const h of [0, Math.floor(tl.span / 3), Math.floor(tl.span / 2), tl.span - 1]) {
      const b = missionBrief('battery', input(st), h), m = momentAt(tl, raw.get(s.slug)!.sun, raw.get(s.slug)!.earth, raw.get(s.slug)!.horizon, h)
      const ok = !cc.power ? /battery check is off/.test(b.answer) : m.solarW! < m.demandW! ? b.answer.includes('battery supplies the missing') && b.answer.includes(`${Math.round(m.demandW! - m.solarW!).toLocaleString('en-US')} W`) : /more than the/.test(b.answer)
      check(ok && b.focus?.hour === h, `${tag} hour ${h}: the battery explanation matches the power balance at the cursor`)
    }
    const d = missionBrief('dark', input(st))
    check(tl.dark ? d.answer.includes(fmt(tl.dark[0])) && d.focus?.hour === tl.dark[0] - row : /stays above the skyline/.test(d.answer), `${tag}: the darkness explanation names its start and points there`)
    briefs++
  }
}
check(briefs > 60 && offersChecked > 5, `Explanations were exercised on ${briefs} missions with ${offersChecked} verified offers`)

// 4. Acting on the mission: refused when it can't be done, reported from a fresh calculation otherwise.
const base: MissionState = { slug: 'malapert-massif', row: 1104, c }
const later = planEdit({ kind: 'setLanding', value: '7' }, base, env)
assert.ok(!('error' in later))
check(later.next.row === base.row + 168 && later.next.slug === base.slug && later.next.c === base.c, 'Moving the landing changes only the landing')
const be = evalAt(base), le = evalAt(later.next)
check(later.report.includes(be.pass && le.pass ? 'still meets' : !be.pass && le.pass ? 'now meets' : be.pass ? 'no longer meets' : 'still misses') && later.report.includes(`${le.power!.minPct.toFixed(0)}%`) && later.report.includes(`was ${be.power!.minPct.toFixed(0)}%`), `The change report is the recalculated result (${later.report})`)
check(scenarioKey(later.next) !== scenarioKey(base) && scenarioKey({ ...base, c: { ...base.c } }) === scenarioKey(base), 'Scenario keys change with the mission and ignore key order')
const undone = undoReport(base, bySlug.get(base.slug)!, name(base.slug), fmt)
check(undone.includes(fmt(base.row)) && undone.includes(be.pass ? 'meets' : 'misses'), 'Undo reports the restored mission from a fresh calculation')
const bigger = planEdit({ kind: 'setEquipment', value: 'capacityWh=20000' }, base, env)
check(!('error' in bigger) && bigger.next.c.power!.capacityWh === 20000 && bigger.next.c.power!.loadW === 1200 && base.c.power!.capacityWh === 10000, 'An equipment change edits one value and never mutates the previous mission')
check('error' in planEdit({ kind: 'setLanding', value: '60' }, { ...base, row: own.hours - 15 * 24 }, env), 'A landing past the cached data is refused')
check('error' in planEdit({ kind: 'setSite', value: base.slug }, base, env) && 'error' in planEdit({ kind: 'setSite', value: 'atlantis-rim' }, base, env), 'Moving to the same or an unknown site is refused')
check('error' in planEdit({ kind: 'setEquipment', value: 'loadW=500' }, { ...base, c: noPower }, env), 'No equipment change while the battery check is off')
check('error' in planEdit({ kind: 'setEquipment', value: 'missionDays=30' }, { ...base, row: own.hours - 20 * 24 }, env), 'A longer mission past the cached data is refused')
const moved = planEdit({ kind: 'setSite', value: 'nobile-rim' }, base, env)
check(!('error' in moved) && moved.next.slug === 'nobile-rim' && moved.next.row === base.row && moved.report.includes('Nobile'), 'Changing site keeps the landing time')

// 5. Comparison explanations come from the comparison's own result.
const side = (slug: string, row: number): FairSide => ({ label: name(slug), site: name(slug), slug, row, series: bySlug.get(slug)!, sunRows: raw.get(slug)!.sun, earthRows: raw.get(slug)!.earth, horizon: raw.get(slug)!.horizon })
for (const [x, y] of [['malapert-massif', 'nobile-rim'], ['shackleton-rim', 'de-gerlache-rim'], ['malapert-massif', 'malapert-massif']] as const) {
  const r = compareFairly(x === y ? 'dates' : 'sites', side(x, 1104), side(y, x === y ? 1104 + 168 : 1104), c, fmt, equipmentLine(c))
  const b = compareBrief(r, name(x), name(y) + (x === y ? ' later' : ''), '')
  const changed = r.metrics.filter(m => m.change !== 'same').map(m => m.id)
  check(b.answer.startsWith(r.verdict) && JSON.stringify(b.focus?.metrics) === JSON.stringify(changed), `${x} vs ${y}: the trade-off starts from the verdict and highlights exactly the changed rows`)
  const first = r.metrics.find(m => m.change === 'better')
  if (first) check(b.answer.includes(first.diff), `${x} vs ${y}: the biggest gain is quoted from the table (${first.diff})`)
  check(!BANNED.test(b.answer + b.next), `${x} vs ${y}: no safety or success claims`)
}

// ---- Review, 10 Nov 2026: explain in place, navigate only when asked, causes from the calculation ----
for (const q of ['Why does the 24 Oct landing miss my requirements?', 'Explain option B', 'Show me why option B fails', 'Would landing later help?', 'Why does it use the stored energy?', 'Is this a safety limit?', 'What does the reserve mean?'])
  check(!asksForAction(q), `An explanation request is not a command: "${q}"`)
for (const q of ['Take me to Malapert', 'Use the 17 Oct landing in my plan', 'Why does B fail? Compare it with a week later.', 'Can you open the atlas?', 'Move my landing a week earlier', 'Undo that'])
  check(asksForAction(q), `A clear request is a command: "${q}"`)
const reply = (action: CompanionReply['action']): CompanionReply => ({ action, suggestion: null, message: 'Option B runs short of stored energy.', visitSlug: null, focus: 'none', questions: [], proposedMission: null })
{
  const g = guardReply('Why does option B miss?', reply({ kind: 'setLanding', value: '-7' }), 'compare')
  check(g.action === null && g.suggestion?.action.kind === 'setLanding' && g.suggestion.action.value === '-7', 'An unrequested mission change on Compare becomes a labelled offer, never a silent switch')
  check(guardReply('Move my landing a week earlier', reply({ kind: 'setLanding', value: '-7' }), 'compare').action?.kind === 'setLanding', 'A requested change still runs')
  check(guardReply('Why does option B miss?', reply({ kind: 'highlight', value: 'battery' }), 'compare').action?.kind === 'highlight', 'Pointing at evidence on Compare stays on Compare')
  check(guardReply('Why does option B miss?', reply({ kind: 'plan', value: '' }), 'compare').suggestion?.action.kind === 'plan', 'Opening another page without being asked becomes an offer')
  check(guardReply('Why is it red?', reply({ kind: 'highlight', value: 'battery' }), 'conditions').action === null, 'A highlight that would leave the current page becomes an offer')
}
check(actionLabel({ kind: 'setLanding', value: '7' }) === 'Move my landing 7 days later' && actionLabel({ kind: 'compareDates', value: '-3' }) === 'Compare with a landing 3 days earlier', 'Offers say exactly what they do')
check(actionLabel({ kind: 'setSite', value: 'malapert-massif' }, name) === `Switch my mission to ${name('malapert-massif')}` && /mission plan/.test(actionLabel({ kind: 'highlight', value: 'reserve' })), 'Offers name the site and the page')
check(actionLabel({ kind: 'setEquipment', value: 'reservePct=25' }) === 'Set the battery reserve to 25%' && actionLabel({ kind: 'atlas', value: '' }).startsWith('Open '), 'Equipment and page offers are labelled')
{
  // The reviewed comparison: Malapert, ideal tracking, 17 Oct (passes) against 24 Oct (misses the 20% reserve).
  const refC: Constraints = { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }
  const refRow = Math.round((Date.parse('2026-10-17T00:00:00Z') - startMs) / 3_600_000)
  const cmp: CompanionContext = { basis: 'mission', compare: { mode: 'dates', a: { slug: 'malapert-massif', row: refRow }, b: { slug: 'malapert-massif', row: refRow + 168 } }, slug: 'malapert-massif', row: refRow, constraints: refC, datasetId: index.datasetId, model: index.model.version, view: { screen: 'compare', search: '' } }
  const msg = [{ role: 'user', content: 'Why does option B miss?' }]
  const parsed = parseCompanionRequest({ context: cmp, messages: msg })
  check(contextKey(parsed.context) === contextKey(cmp), 'The comparison on screen travels with the question unchanged')
  bad(() => parseCompanionRequest({ context: { ...cmp, compare: { mode: 'sites', a: cmp.compare!.a, b: cmp.compare!.b } }, messages: msg }), 'A two-site comparison must keep the landing and change the site')
  bad(() => parseCompanionRequest({ context: { ...cmp, compare: { mode: 'dates', a: cmp.compare!.a, b: { slug: 'shackleton-rim', row: refRow } } }, messages: msg }), 'A two-date comparison must keep the site')
  const e = companionEvidence(parsed.context), k = e.comparison!
  check(k.options[0].label === '17 Oct landing' && k.options[1].label === '24 Oct landing' && k.options[0].pass === true && k.options[1].pass === false, 'Options carry the page labels and the computed verdicts')
  check(Math.round(k.options[0].minBatteryPct!) === 28 && Math.round(k.options[1].minBatteryPct!) === 5, `Lowest battery 28% and 5%, as on the page (${k.options.map(o => o.minBatteryPct?.toFixed(1)).join(', ')})`)
  check(e.requirements?.selectedBy === 'visitor' && e.requirements.reservePct === 20 && /not NASA requirements, safety limits/.test(e.requirements.note), 'The 20% reserve is the visitor’s own limit, not a safety or NASA limit')
  check(/no loss/.test(k.panel ?? '') && k.energyByCause?.find(x => x.cause === 'Panel incidence')?.kWh === 0, 'Ideal tracking: the panel angle explains none of the difference')
  check(k.causes.some(x => /hills and eclipses blocking the Sun/.test(x)) && !k.causes.some(x => /lower Sun/i.test(x)), 'The cause comes from the energy split (terrain and eclipses), never "a lower Sun"')
  const policy = readFileSync('server/companion-policy.ts', 'utf8')
  check(/Never call them a safety limit, a NASA requirement/.test(policy) && /a limit you suggested/.test(policy), 'Policy: the visitor’s limits are theirs, never “a safety limit I suggest”')
  check(/Explain in place/.test(policy) && /Never invent a cause/.test(policy) && /ideal Sun tracking, the panel angle causes no loss/.test(policy), 'Policy: explain the option in place and only with computed causes')
  check(/2-3 short, plain sentences/.test(policy) && /never about walking on the Moon/.test(policy), 'Policy: short answers and screen-relevant suggested questions')
  check(/This applies in every language and to comparisons too: never call one option safer/.test(policy), 'Policy: no safety claims in any language, including "safer"')
}

// ---- 10 Nov 2026: English screens, replies in the visitor's language, numbers as on screen ----
check(asciiDigits('তোমার রাখা ২০% রিজার্ভের নিচে, মাত্র ৫% — ২৪ অক্টোবর') === 'তোমার রাখা 20% রিজার্ভের নিচে, মাত্র 5% — 24 অক্টোবর', 'Bengali digits become 0-9; the Bangla words are untouched')
check(asciiDigits('١٤ يومًا, ४२ h, ７ kWh, 3.08 m²') === '14 يومًا, 42 h, 7 kWh, 3.08 m²', 'Other scripts’ digits become 0-9 as well')
{
  const bn = checkedCompanionReply({ action: null, suggestion: { action: { kind: 'compareDates', value: '-7' }, reason: '১৭ অক্টোবরের অবতরণ শর্ত পূরণ করে।' }, message: '২৪ অক্টোবরে ব্যাটারি ৫% এ নামে, তোমার রাখা ২০% রিজার্ভের নিচে।', visitSlug: null, focus: 'none', questions: ['১৪ দিনের মিশন কি বদলাব?'], proposedMission: null }, companionEvidence({ basis: 'mission', slug: 'malapert-massif', row: Math.round((Date.parse('2026-10-17T00:00:00Z') - startMs) / 3_600_000), constraints: { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER } }, datasetId: index.datasetId, model: index.model.version }))
  check(bn.message === '24 অক্টোবরে ব্যাটারি 5% এ নামে, তোমার রাখা 20% রিজার্ভের নিচে।' && bn.questions[0] === '14 দিনের মিশন কি বদলাব?' && bn.suggestion?.reason.startsWith('17 অক্টোবরের'), 'A Bangla reply keeps its language and shows numbers exactly as on screen')
}

console.log(`Chader Buri mission-job checks passed: ${checks} (mock transport only).`)
