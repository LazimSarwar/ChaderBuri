import assert from 'node:assert/strict'
import { createSpaceWeatherService, normalizeWeather, spaceWeatherHTTP } from '../server/space-weather.ts'
import type { IncomingMessage, ServerResponse } from 'node:http'

let checks = 0
function check(value: unknown, message: string) { assert.ok(value, message); checks++ }
const now = Date.parse('2026-11-13T12:00:00Z'), start = Date.parse('2026-11-07T00:00:00Z')
const fixtures: Record<string, unknown[]> = {
  FLR: [{ flrID: '2026-11-12T08:00:00-FLR-001', beginTime: '2026-11-12T08:00Z', classType: 'M2.5', link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/123' }],
  CME: [{ activityID: 'CME-001', startTime: '2026-11-12T09:00Z', cmeAnalyses: [{ isMostAccurate: false, speed: 500 }, { isMostAccurate: true, speed: 750 }], link: 'https://ccmc.gsfc.nasa.gov/DONKI/view/CME/123' }],
  SEP: [{ sepID: 'SEP-001', eventTime: '2026-11-12T10:00Z', instruments: [{ displayName: 'GOES-P: SEISS' }, { displayName: 'SOHO: ERNE' }] }],
  notifications: [{ messageID: 'NOTICE-001', messageIssueTime: '2026-11-12T11:00Z', messageType: 'FLR', messageBody: '<script>not-display-data</script>', messageURL: 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/123' }],
}
let time = now, calls = 0, failed = new Set<string>()
const urls: URL[] = []
const mock = (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input.toString()); urls.push(url); calls++
  const kind = url.pathname.split('/').at(-1)!
  return failed.has(kind) ? new Response('unavailable', { status: 503 }) : new Response(JSON.stringify(fixtures[kind]), { headers: { 'content-type': 'application/json' } })
}) as typeof fetch
const service = createSpaceWeatherService({ fetchImpl: mock, now: () => time })
const config = { apiKey: 'unit-test-key-never-log' }
const absent = await service.get({})
check(absent.status === 'unconfigured' && !absent.configured && calls === 0, 'A missing key does not send NASA requests or pretend to be a zero-event report')
const initial = await service.get(config)
check(initial.status === 'available' && initial.sources.length === 4 && initial.events.length === 4, 'All four successful feeds produce an available dated report')
check(initial.rangeStartUTC === '2026-11-07T00:00:00.000Z' && initial.rangeEndUTC === new Date(now).toISOString(), 'The query covers seven UTC calendar dates through the actual check time')
check(initial.sources.every(s => s.status === 'ok' && s.count === 1 && s.fetchedUTC === new Date(now).toISOString()), 'Counts and per-feed response timestamps are explicit')
check(initial.events.find(e => e.kind === 'CME')?.speedKms === 750, 'CME speed comes only from NASA’s selected most-accurate analysis')
check(initial.events.find(e => e.kind === 'SEP')?.observingLocation === 'GOES-P: SEISS, SOHO: ERNE', 'Particle events name the observing instruments rather than a lunar site')
check(urls.every(u => u.origin === 'https://api.nasa.gov' && u.searchParams.get('startDate') === '2026-11-07' && u.searchParams.get('endDate') === '2026-11-13'), 'Only the fixed NASA gateway and bounded report dates are fetched')
check(!JSON.stringify(initial).includes(config.apiKey) && !JSON.stringify(initial).includes('not-display-data'), 'Neither the API key nor raw notice prose enters the client payload')
check((await service.get(config)) === initial && calls === 4, 'Ten-minute cache avoids duplicate NASA requests')
time += 11 * 60_000; failed = new Set(['CME'])
const partial = await service.get(config)
const oldCME = partial.sources.find(s => s.kind === 'CME')!
check(partial.status === 'partial' && oldCME.status === 'stale' && oldCME.count === null, 'A failed feed is explicitly stale rather than reported as zero or current')
check(oldCME.fetchedUTC === initial.sources.find(s => s.kind === 'CME')?.fetchedUTC, 'Stale data retains its original response timestamp')
time += 25 * 3600_000; failed = new Set(['FLR','CME','SEP','notifications'])
const unavailable = await service.get(config)
check(unavailable.status === 'unavailable' && unavailable.events.length === 0 && unavailable.sources.every(s => s.status === 'unavailable' && s.count === null), 'Old cached observations expire instead of remaining current forever')

let concurrentCalls = 0
const parallel = createSpaceWeatherService({ now: () => now, fetchImpl: (async () => { concurrentCalls++; await new Promise(r => setTimeout(r,2)); return new Response('[]') }) as typeof fetch })
const simultaneous = await Promise.all(Array.from({ length: 12 }, () => parallel.get(config)))
check(concurrentCalls === 4 && simultaneous.every(r => r === simultaneous[0]), 'Concurrent app openings share one bounded refresh')
check(simultaneous[0].sources.every(s => s.status === 'ok' && s.count === 0), 'Successful empty feeds remain different from unavailable feeds')

const unsafe = normalizeWeather('FLR', [
  { flrID: '<svg/onload=alert(1)>', beginTime: '2026-11-12T08:00', classType: '<b>X9</b>', link: 'javascript:alert(1)' },
  { flrID: 'safe', beginTime: '2026-11-12T09:00Z', classType: 'X1.0', link: 'https://evil.nasa.gov.example.org/report' },
  { flrID: 'key', beginTime: '2026-11-12T10:00Z', classType: 'M1', link: 'https://api.nasa.gov/report?api_key=secret' },
  { flrID: 'old', beginTime: '2026-11-01T08:00Z', classType: 'M2.5' },
  { flrID: 'future', beginTime: '2026-11-14T08:00Z', classType: 'M2.5' },
  { beginTime: 'not-a-date' }, null,
], start, now)
check(unsafe.count === 3 && unsafe.skipped === 2, 'Out-of-range observations are excluded and malformed rows are counted')
check(unsafe.events.every(e => e.sourceURL === 'https://ccmc.gsfc.nasa.gov/tools/DONKI/'), 'Unsafe, impersonated and credential-bearing links are replaced by the official source')
check(!JSON.stringify(unsafe).includes('<') && unsafe.events.some(e => e.title === 'Solar flare · class not supplied'), 'Unknown or malicious flare classes are not promoted into invented severity')
check(unsafe.events.every(e => e.timeUTC.endsWith('Z')), 'NASA timestamps without a suffix are interpreted as UTC')
const migratedLink = normalizeWeather('FLR', [{ flrID: 'legacy-link', beginTime: '2026-11-12T08:00Z', classType: 'M1', link: 'https://kauai.ccmc.gsfc.nasa.gov/DONKI/view/FLR/123/-1' }], start, now)
check(migratedLink.events[0].sourceURL === 'https://ccmc.gsfc.nasa.gov/DONKI/view/FLR/123/-1', 'Legacy DONKI report links preserve their path on the documented replacement host')
const unchangedLinks = normalizeWeather('FLR', [
  { flrID: 'other-host', beginTime: '2026-11-12T08:00Z', link: 'https://science.nasa.gov/sun/' },
  { flrID: 'other-path', beginTime: '2026-11-12T09:00Z', link: 'https://kauai.ccmc.gsfc.nasa.gov/other/report' },
], start, now)
check(unchangedLinks.events.some(e => e.sourceURL === 'https://science.nasa.gov/sun/') && unchangedLinks.events.some(e => e.sourceURL === 'https://kauai.ccmc.gsfc.nasa.gov/other/report'), 'Report-link migration leaves other NASA hosts and non-DONKI paths unchanged')
const duplicate = normalizeWeather('FLR', [...fixtures.FLR, ...fixtures.FLR], start, now)
check(duplicate.count === 1, 'Duplicate event IDs do not inflate counts')
const invalidSpeed = normalizeWeather('CME', [{ activityID: 'x', startTime: '2026-11-12T00:00Z', cmeAnalyses: [{ isMostAccurate: true, speed: -5 }] }], start, now)
check(invalidSpeed.events[0].speedKms === undefined, 'Unknown CME speed stays unknown')
assert.throws(() => normalizeWeather('FLR', { error: 'failed' }, start, now)); checks++
assert.throws(() => normalizeWeather('FLR', Array(5001).fill(null), start, now)); checks++
const malformed = createSpaceWeatherService({ now: () => now, fetchImpl: (async () => new Response('{broken')) as typeof fetch })
check((await malformed.get(config)).status === 'unavailable', 'Malformed upstream JSON is handled as unavailable, not a successful empty report')
const rejected = createSpaceWeatherService({ now: () => now, fetchImpl: (async () => new Response('not exposed', { status: 403 })) as typeof fetch })
check((await rejected.get(config)).sources.every(s => s.message.includes('authorise') && !s.message.includes('not exposed')), 'An authorisation failure has an actionable message without exposing the NASA response')
const limited = createSpaceWeatherService({ now: () => now, fetchImpl: (async () => new Response('', { status: 429 })) as typeof fetch })
check((await limited.get(config)).sources.every(s => s.message.includes('request limit')), 'A NASA rate limit is distinguished from no reported events')
const oversized = createSpaceWeatherService({ now: () => now, fetchImpl: (async () => new Response('[]', { headers: { 'content-length': '2000000' } })) as typeof fetch })
check((await oversized.get(config)).sources.every(s => s.status === 'unavailable'), 'Oversized upstream reports are bounded')
const mixed = createSpaceWeatherService({ now: () => now, fetchImpl: (async () => new Response('[null]')) as typeof fetch })
const unreadable = await mixed.get(config)
check(unreadable.status === 'partial' && unreadable.sources.every(s => s.status === 'partial' && s.skipped === 1), 'Unreadable entries are labelled incomplete, never an all-clear zero count')

// NASA's September2026 migration can leave an individual api.nasa.gov route unavailable
// while the documented CCMC public route still serves the same event schema.
for (const gatewayStatus of [404,410,503]) {
  const attempts: { url: URL; signal: AbortSignal | null | undefined; redirect: RequestRedirect | undefined }[] = []
  const fallbackService = createSpaceWeatherService({ now: () => now, fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString())
    attempts.push({ url, signal: init?.signal, redirect: init?.redirect })
    const kind = url.pathname.split('/').at(-1)!
    return url.hostname === 'api.nasa.gov' ? new Response('', { status: gatewayStatus }) : new Response(JSON.stringify(fixtures[kind]))
  }) as typeof fetch })
  const recovered = await fallbackService.get(config)
  check(recovered.status === 'available' && recovered.events.length === 4 && attempts.length === 8, `${gatewayStatus}: official fallback restores each supported report without inventing zero counts`)
  const fallbackAttempts = attempts.filter(a => a.url.hostname === 'ccmc.gsfc.nasa.gov')
  check(fallbackAttempts.every(a => a.url.pathname.startsWith('/DONKI-API/get/') && !a.url.searchParams.has('api_key') && !a.url.href.includes(config.apiKey)), `${gatewayStatus}: the NASA credential never goes to the public fallback`)
  check(fallbackAttempts.every(a => a.url.searchParams.get('startDate') === '2026-11-07' && a.url.searchParams.get('endDate') === '2026-11-13' && [...a.url.searchParams.keys()].every(k => ['startDate','endDate','type'].includes(k))), `${gatewayStatus}: fallback uses the same fixed UTC dates and only supported parameters`)
  check(fallbackAttempts.every(a => a.signal === attempts.find(p => p.url.hostname === 'api.nasa.gov' && p.url.pathname.split('/').at(-1) === a.url.pathname.split('/').at(-1))?.signal && a.redirect === 'error'), `${gatewayStatus}: both attempts share one deadline and redirects cannot forward credentials`)
  check(!JSON.stringify(recovered).includes(config.apiKey), `${gatewayStatus}: recovered client payload contains no key`)
}
let gatewayOnlyCalls = 0
const gatewaySuccess = createSpaceWeatherService({ now: () => now, fetchImpl: (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input.toString()); check(url.hostname === 'api.nasa.gov', 'A successful gateway response does not contact a second provider'); gatewayOnlyCalls++; return new Response('[]')
}) as typeof fetch })
await gatewaySuccess.get(config)
check(gatewayOnlyCalls === 4, 'A primary success needs exactly one request per feed')
for (const blockedStatus of [401,403,429]) {
  const blockedAttempts: URL[] = []
  const blockedService = createSpaceWeatherService({ now: () => now, fetchImpl: (async (input: string | URL | Request) => {
    blockedAttempts.push(new URL(input instanceof Request ? input.url : input.toString())); return new Response('', { status: blockedStatus })
  }) as typeof fetch })
  const blocked = await blockedService.get(config)
  check(blocked.status === 'unavailable' && blockedAttempts.length === 4 && blockedAttempts.every(u => u.hostname === 'api.nasa.gov'), `${blockedStatus}: authorisation and quota failures remain explicit without a fallback retry`)
}
const failedFallback = createSpaceWeatherService({ now: () => now, fetchImpl: (async (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : input.toString())
  return url.pathname.endsWith('/FLR') ? new Response('', { status: url.hostname === 'api.nasa.gov' ? 404 : 503 }) : new Response('[]')
}) as typeof fetch })
const stillPartial = await failedFallback.get(config)
check(stillPartial.status === 'partial' && stillPartial.sources.find(s => s.kind === 'FLR')?.status === 'unavailable' && stillPartial.sources.filter(s => s.status === 'ok').length === 3, 'Failure at both official routes stays partial while successful feeds remain usable')
let httpStatus = 0, httpBody = ''
const fakeRes = { writeHead: (status: number) => { httpStatus = status }, end: (body: string) => { httpBody = body } } as unknown as ServerResponse
await spaceWeatherHTTP({ method: 'POST' } as IncomingMessage, fakeRes, config)
check(httpStatus === 405 && JSON.parse(httpBody).error.includes('GET'), 'The public endpoint rejects methods that do not retrieve reports')
console.log(`NASA space-weather checks passed: ${checks}`)
