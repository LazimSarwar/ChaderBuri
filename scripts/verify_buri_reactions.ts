import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { detectReaction, REACTION_LINES, type ReactionScene } from '../src/lib/buriReactions.ts'
import { readGuideAction, guideDestinations } from '../src/lib/guideAction.ts'
import { companionResponse } from '../server/companion-policy.ts'
import { companionEvidence } from '../server/companion-data.ts'
import { DEFAULT_POWER } from '../src/architect/power.ts'
import type { CompanionContext } from '../src/lib/lunarCompanion.ts'
import { DEFAULT_SURFACE_PREFERENCES, parseSurfacePreferences } from '../src/lib/surfacePolish.ts'
import { skipOffer } from '../src/lib/buriReactions.ts'
import { cleanDigestItems, MAX_DIGEST_ITEMS, suggestionKey } from '../src/lib/contracts.ts'
import { parseCompanionRequest } from '../src/lib/lunarCompanion.ts'
import { panelQuestion } from '../src/lib/guideQuestions.ts'
import { characterState, shorten, TALK_MS, POINT_MS } from '../src/lib/characterController.ts'

let checks = 0
const check = (x: unknown, label: string) => { assert.ok(x, label); checks++ }
const bad = (fn: () => unknown, label: string) => { assert.throws(fn, undefined, label); checks++ }

// --- Chader Buri reacts to the visit -------------------------------------------------
const base: ReactionScene = { landed: true, siteSlug: 'shackleton-rim', siteName: 'Shackleton Rim', airborne: false, trailSteps: 0, trailDistanceM: 0, photos: 0, flags: 0, earthUp: true, sunState: 'lit' }
const none = new Set<string>()
check(detectReaction(null, base, none, 'shackleton-rim') === null, 'The first landing is left to the guided tour')
check(detectReaction(null, { ...base, landed: false }, none, null) === null, 'Nothing is said before landing')
check(detectReaction(base, { ...base, landed: false, airborne: true }, none, 'shackleton-rim') === null, 'Nothing is said after leaving the surface')
const arrival = detectReaction(base, { ...base, siteSlug: 'malapert-massif', siteName: 'Malapert Massif' }, none, 'shackleton-rim')
check(arrival?.key === 'arrive:malapert-massif' && arrival.text.includes('Malapert Massif'), 'A second site is greeted by name')
check(detectReaction(base, { ...base, airborne: true }, none, 'shackleton-rim')?.key === 'jump', 'A first jump is noticed')
check(detectReaction(base, { ...base, airborne: true }, new Set(['jump']), 'shackleton-rim') === null, 'A remark is never repeated')
check(detectReaction({ ...base, airborne: true }, { ...base, airborne: true }, none, 'shackleton-rim') === null, 'Staying airborne is not a new jump')
check(detectReaction(base, { ...base, photos: 1 }, none, 'shackleton-rim')?.key === 'photo', 'A photograph is noticed')
check(detectReaction(base, { ...base, flags: 1 }, none, 'shackleton-rim')?.key === 'flag', 'A survey flag is noticed')
check(detectReaction(base, { ...base, trailSteps: 6 }, none, 'shackleton-rim')?.key === 'prints', 'Bootprints are noticed after a few steps')
check(detectReaction({ ...base, trailDistanceM: 59, trailSteps: 80 }, { ...base, trailDistanceM: 61, trailSteps: 82 }, none, 'shackleton-rim')?.key === 'walk-60', 'A walking milestone is noticed once crossed')
check(detectReaction({ ...base, trailDistanceM: 61 }, { ...base, trailDistanceM: 10 }, none, 'shackleton-rim') === null, 'Resetting the viewpoint is not a milestone')
check(detectReaction(base, { ...base, earthUp: false }, none, 'shackleton-rim')?.key === 'earthSet', 'Earth dropping below the skyline is noticed')
check(detectReaction({ ...base, earthUp: false }, base, none, 'shackleton-rim')?.key === 'earthRise', 'Earth rising over the skyline is noticed')
check(detectReaction(base, { ...base, sunState: 'shadowed' }, none, 'shackleton-rim')?.key === 'sunSet', 'The Sun disc leaving the skyline is noticed')
check(detectReaction(base, { ...base, sunState: 'grazing' }, none, 'shackleton-rim') === null, 'A grazing Sun is not called a sunset')
check(detectReaction({ ...base, sunState: 'shadowed' }, { ...base, sunState: 'grazing' }, none, 'shackleton-rim')?.key === 'sunRise', 'Light returning is noticed')
const busy = detectReaction(base, { ...base, airborne: true, earthUp: false, photos: 1, trailSteps: 6 }, none, 'shackleton-rim')
check(busy?.key === 'earthSet', 'Scene events outrank the visitor’s own actions when several happen at once')
check(Object.values(REACTION_LINES).every(line => (typeof line === 'function' ? line('Shackleton Rim') : line).length <= 130), 'Every remark fits a short bubble')
check(!Object.values(REACTION_LINES).some(line => /safe|guarantee|certif|NASA approv/i.test(typeof line === 'function' ? line('x') : line)), 'No remark claims safety or approval')

// --- Preferences --------------------------------------------------------------------
check(DEFAULT_SURFACE_PREFERENCES.suitAudio && DEFAULT_SURFACE_PREFERENCES.buriReactions, 'Suit sounds and comments start on')
check(parseSurfacePreferences({ quietHud: true, astronautView: false, motion: false }).buriReactions === true, 'Older saved preferences gain the new options')
check(parseSurfacePreferences({ suitAudio: false }).suitAudio === false, 'Turning suit sounds off is remembered')

// --- New guide operations --------------------------------------------------------------
for (const kind of ['play', 'pause', 'close', 'photo', 'jump', 'flag'] as const) check(readGuideAction({ kind, value: '' })?.kind === kind, `Chader Buri may request ${kind}`)
check(readGuideAction({ kind: 'explain', value: 'on' })?.value === 'on', 'Explain mode can be turned on')
bad(() => readGuideAction({ kind: 'explain', value: 'maybe' }), 'Explain mode only accepts on/off')
bad(() => readGuideAction({ kind: 'deleteEverything', value: '' }), 'Unknown operations are refused')
check(new Set(guideDestinations).size === guideDestinations.length, 'Operation names are unique')

// --- The model's structured reply carries a surface action through the server ---------
const index = JSON.parse(readFileSync('public/data/prediction-index.json', 'utf8'))
const context: CompanionContext = { slug: 'malapert-massif', row: 1104, view: { screen: 'surface', search: '' }, constraints: { missionDays: 14, minLitPct: 60, maxDarkH: 72, minLinkPct: 60, maxGapH: 72, power: { ...DEFAULT_POWER, panelAreaM2: 3.08, loadW: 1200 } }, datasetId: index.datasetId, model: index.model.version }
let sentBody: { systemInstruction: { parts: { text: string }[] }; generationConfig: { responseJsonSchema: { properties: { action: { properties: { kind: { enum: string[] } } } } } } } | null = null
const mock = (reply: unknown) => (async (_url: string, init: { body: string }) => {
  sentBody = JSON.parse(init.body)
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(reply) }] } }] }), { status: 200 })
}) as unknown as typeof fetch
const jumpReply = { action: { kind: 'jump', value: '' }, message: 'Off you go! Bend your knees and push.', visitSlug: null, focus: 'none', questions: [], proposedMission: null }
const res = await companionResponse('POST', { context, messages: [{ role: 'user', content: 'Make me jump!' }] }, { apiKey: 'test-key', model: 'gemini-2.5-flash' }, mock(jumpReply), companionEvidence)
const body = JSON.parse(res.body)
check(res.status === 200 && body.reply.action.kind === 'jump', 'A surface jump request passes the server checks')
check(sentBody!.generationConfig.responseJsonSchema.properties.action.properties.kind.enum.includes('photo'), 'Gemini is offered the new operations in its schema')
check(/respectful, helpful guide for visitors of every age/.test(sentBody!.systemInstruction.parts[0].text) && /Never address visitors with pet names/.test(sentBody!.systemInstruction.parts[0].text) && /no shona/.test(sentBody!.systemInstruction.parts[0].text) && /reply in the language and script of the visitor's latest message/.test(sentBody!.systemInstruction.parts[0].text) && /when it is unclear, reply in English/.test(sentBody!.systemInstruction.parts[0].text) && /keep numbers, units .* UTC dates and times, site names and option labels exactly as they appear in the evidence, written with the digits 0-9/.test(sentBody!.systemInstruction.parts[0].text) && !/Always reply in English/.test(sentBody!.systemInstruction.parts[0].text), 'The persona uses respectful conversation without pet names, in the visitor\u2019s language, keeping displayed numbers and units unchanged')
check(/action setup opens the guided mission questions/.test(sentBody!.systemInstruction.parts[0].text) && /action guide opens the visual how-to page/.test(sentBody!.systemInstruction.parts[0].text) && /not a forecast for the selected future mission/.test(sentBody!.systemInstruction.parts[0].text), 'The guide can point to the new support tools without treating weather reports as future mission evidence')
check(/target 30-60 plain words/.test(sentBody!.systemInstruction.parts[0].text) && /end with one concrete, useful next action/.test(sentBody!.systemInstruction.parts[0].text) && /Never call it calculated success, a success probability or a chance of mission success/.test(sentBody!.systemInstruction.parts[0].text), 'Simple replies stay brief, provide a requested next step and describe calculated results without implying operational success')
check(/A zero count means only no DONKI entries returned for that event type and date range/.test(sentBody!.systemInstruction.parts[0].text) && /For a weather explanation, leave action and suggestion null/.test(sentBody!.systemInstruction.parts[0].text) && /available Check reports or Read NASA report control and the displayed dates/.test(sentBody!.systemInstruction.parts[0].text), 'Zero DONKI entries are not described as absent detections and weather explanations keep their next step on the report')
check(/never say a mission will succeed, is set to succeed, works or is safe/.test(sentBody!.systemInstruction.parts[0].text), 'A pass is only ever described as meeting the selected requirements')
const rogue = await companionResponse('POST', { context, messages: [{ role: 'user', content: 'Hi' }] }, { apiKey: 'test-key' }, mock({ ...jumpReply, action: { kind: 'formatDisk', value: '' } }), companionEvidence)
check(rogue.status === 502, 'An invented operation from the model is rejected, not performed')

// --- Model fallback: a retired or overloaded model hands over to the next one ----------------
const calls: string[] = []
const flaky = (statuses: number[]) => (async (url: string) => {
  calls.push(url.split('/models/')[1].split(':')[0])
  const status = statuses[calls.length - 1] ?? 200
  if (status !== 200) return new Response(JSON.stringify({ error: { message: 'unavailable' } }), { status })
  return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(jumpReply) }] } }] }), { status: 200 })
}) as unknown as typeof fetch
const ask = { context, messages: [{ role: 'user' as const, content: 'Make me jump!' }] }
calls.length = 0
check((await companionResponse('POST', ask, { apiKey: 'k', model: 'retired-flash, busy-flash, good-flash' }, flaky([404, 503, 200]), companionEvidence)).status === 200 && calls.join() === 'retired-flash,busy-flash,good-flash', 'A retired then overloaded model falls through to a working one')
calls.length = 0
const allBusy = await companionResponse('POST', ask, { apiKey: 'k', model: 'a-flash,b-flash' }, flaky([503, 503]), companionEvidence)
check(allBusy.status === 503 && /busy/.test(JSON.parse(allBusy.body).error), 'When every model is overloaded the visitor is told she is busy')
calls.length = 0
check((await companionResponse('POST', ask, { apiKey: 'k', model: 'a-flash,b-flash' }, flaky([403]), companionEvidence)).status === 502 && calls.length === 1, 'A key or billing refusal is not retried on other models')
calls.length = 0
const timeouts = (async (url: string, init: { signal: AbortSignal }) => { calls.push(url); if (calls.length === 1) { await new Promise((_, reject) => { const hang = setTimeout(() => {}, 60000); init.signal.addEventListener('abort', () => { clearTimeout(hang); reject(new Error('timeout')) }) }) } return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(jumpReply) }] } }] }), { status: 200 }) }) as unknown as typeof fetch
const slow = await companionResponse('POST', ask, { apiKey: 'k', model: 'slow-flash,fast-flash' }, timeouts, companionEvidence)
check(slow.status === 200 && calls.length === 2, 'A model that hangs is abandoned in time for the next one to answer')
check((await companionResponse('GET', null, { apiKey: 'k' })).body.includes('gemini-3.6-flash'), 'The default model list starts with an available Flash model')
check((await companionResponse('GET', null, { apiKey: 'k', model: 'Bad Model!,ok-flash' })).body.includes('"ok-flash"'), 'Malformed model names are ignored')

// --- Formal action policy: requested operations run, her own ideas wait for Allow ----------
const withSuggestion = (suggestion: unknown, action: unknown = null) => ({ action, suggestion, message: 'Shall we look at the next sunrise?', visitSlug: null, focus: 'none', questions: [], proposedMission: null })
const sunrise = await companionResponse('POST', ask, { apiKey: 'k', model: 'good-flash' }, mock(withSuggestion({ action: { kind: 'advance', value: '12' }, reason: 'Sunrise is twelve hours away.' })), companionEvidence)
const sr = JSON.parse(sunrise.body).reply
check(sunrise.status === 200 && sr.action === null && sr.suggestion.action.kind === 'advance' && sr.suggestion.reason.includes('twelve'), 'Her own idea arrives as a suggestion, not an action')
check(sentBody!.generationConfig.responseJsonSchema.properties.suggestion !== undefined && sentBody!.systemInstruction.parts[0].text.includes('Allow / Not now') && /ACTION POLICY/.test(sentBody!.systemInstruction.parts[0].text), 'Gemini is told the action policy and can only suggest through the schema')
const invented = await companionResponse('POST', ask, { apiKey: 'k', model: 'good-flash' }, mock(withSuggestion({ action: { kind: 'deleteSite', value: '' }, reason: 'Tidy up.' })), companionEvidence)
check(invented.status === 200 && JSON.parse(invented.body).reply.suggestion === null && JSON.parse(invented.body).reply.message.length > 0, 'A suggestion outside the allowlist is dropped; her explanation is kept')
const tooFar = await companionResponse('POST', ask, { apiKey: 'k', model: 'good-flash' }, mock(withSuggestion({ action: { kind: 'advance', value: '213' }, reason: 'Wait for Earth.' })), companionEvidence)
check(tooFar.status === 200 && JSON.parse(tooFar.body).reply.suggestion === null, 'A suggestion beyond the seven-day limit is dropped')
const badSlug = await companionResponse('POST', ask, { apiKey: 'k', model: 'good-flash' }, mock(withSuggestion({ action: { kind: 'visit', value: 'atlantis' }, reason: 'Nice view.' })), companionEvidence)
check(badSlug.status === 200 && JSON.parse(badSlug.body).reply.suggestion === null, 'A suggested trip to an unknown site is dropped')
const twice = await companionResponse('POST', ask, { apiKey: 'k', model: 'good-flash' }, mock(withSuggestion({ action: { kind: 'jump', value: '' }, reason: 'Fun.' }, { kind: 'jump', value: '' })), companionEvidence)
check(JSON.parse(twice.body).reply.suggestion === null, 'The same operation is never both performed and suggested')
const legacy = await companionResponse('POST', ask, { apiKey: 'k', model: 'good-flash' }, mock(jumpReply), companionEvidence)
check(legacy.status === 200 && JSON.parse(legacy.body).reply.suggestion === null, 'Replies without a suggestion field stay valid')

// --- Screen awareness and dismissal memory travel with the question ------------------------
const screen = { screen: 'plan', items: [{ id: 'battery', label: 'Minimum battery charge', value: '5.2 (reserve 20)', unit: '%', status: 'fail', source: 'Calculated' }] }
await companionResponse('POST', { ...ask, screen, dismissed: ['advance:12', 'not a key', 'x'.repeat(200)] }, { apiKey: 'k', model: 'good-flash' }, mock(jumpReply), companionEvidence)
const userParts = (sentBody as unknown as { contents: { parts: { text: string }[] }[] }).contents.at(-1)!.parts.map(p => p.text)
check(userParts.some(t => t.startsWith('screenDigest:') && t.includes('Minimum battery charge') && t.includes('"fail"')), 'The open screen’s readouts reach Gemini with the question')
check(userParts.some(t => t.startsWith('dismissedSuggestions:') && t.includes('advance:12') && !t.includes('not a key')), 'Dismissed suggestions are sent; malformed entries are dropped')
check(/screenDigest/.test(sentBody!.systemInstruction.parts[0].text) && /the red one/.test(sentBody!.systemInstruction.parts[0].text), 'She is told to match “this number” to the readouts')
const parsed = parseCompanionRequest({ ...ask, screen: { screen: 'plan', items: Array.from({ length: 50 }, (_, i) => ({ id: 'r' + i, label: 'Readout ' + i, value: 'x'.repeat(300), status: 'red' })) } })
check(parsed.screen!.items.length === MAX_DIGEST_ITEMS && parsed.screen!.items[0].value.length <= 80 && !('status' in parsed.screen!.items[0]), 'Screen readouts are bounded and unknown statuses dropped')
check(parseCompanionRequest(ask).screen === null && parseCompanionRequest(ask).dismissed.length === 0, 'Questions without a screen still work')
check(cleanDigestItems([{ label: '', value: '1' }, null, 'text']).length === 0, 'Empty or malformed readouts are discarded')
check(suggestionKey({ kind: 'advance', value: '12' }) === 'advance:12', 'Dismissal keys are stable')
check(panelQuestion('plan').includes('mission decision') && panelQuestion(null).length > 10, 'Every screen has an “Ask Chader Buri” question')

// --- Free consent offers in her comment bubbles -------------------------------------------
check(skipOffer(11.2, 'Earthrise')?.action.value === '12' && skipOffer(11.2, 'Earthrise')?.label === 'Skip 12 h to Earthrise', 'Earthrise offer skips to just after the crossing')
check(skipOffer(400, 'sunrise') === undefined && skipOffer(null, 'sunrise') === undefined && skipOffer(.2, 'sunrise') === undefined, 'No offer beyond seven days, outside the cache or already rising')
const set = detectReaction(base, { ...base, earthUp: false, nextEarthriseH: 30.4 }, none, 'shackleton-rim')
check(set?.key === 'earthSet' && set.offer?.action.kind === 'advance' && set.offer.action.value === '31', 'Earthset comes with a skip-to-Earthrise offer')
check(detectReaction({ ...base, earthUp: false }, base, none, 'shackleton-rim')?.offer === undefined, 'Earthrise needs no offer')

// --- Character controller: what she does on the surface --------------------------------
const say = (focus: 'sun' | 'earth' | 'skyline' | 'none', at: number) => ({ message: 'Look there, dear. That is where the Sun hides behind the ridge.', focus, at })
check(characterState({ busy: true, reply: null, line: null, now: 0 }).pose === 'listening', 'She listens while Gemini thinks')
check(characterState({ busy: false, reply: say('none', 1000), line: null, now: 2000 }).pose === 'talking', 'She talks right after replying')
check(characterState({ busy: false, reply: say('sun', 1000), line: null, now: 2000 }).target === 'sun', 'She points at what her reply is about')
check(characterState({ busy: false, reply: say('sun', 0), line: null, now: TALK_MS + 10 }).bubble === null && characterState({ busy: false, reply: say('sun', 0), line: null, now: TALK_MS + 10 }).pose === 'pointing', 'Her bubble fades before her pointing does')
check(characterState({ busy: false, reply: say('earth', 0), line: null, now: POINT_MS + 10 }).pose === 'idle', 'She returns to idle')
check(characterState({ busy: false, reply: null, line: 'Here we are.', now: 0 }).bubble === 'Here we are.', 'Tour lines can appear over her')
check(shorten('a'.repeat(400)).length <= 150 && shorten('One. Two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen. ' + 'x'.repeat(200)).endsWith('.'), 'Long replies are shortened at a sentence end')

console.log(`Chader Buri reaction and control checks passed: ${checks} (mock transport only).`)
