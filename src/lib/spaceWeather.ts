import { useEffect, useState } from 'react'

export const SPACE_WEATHER_KINDS = ['FLR', 'CME', 'SEP', 'notifications'] as const
export type SpaceWeatherKind = typeof SPACE_WEATHER_KINDS[number]
export type SpaceWeatherEvent = {
  id: string; kind: SpaceWeatherKind; title: string; timeUTC: string; sourceURL: string
  classType?: string; speedKms?: number; observingLocation?: string
}
export type SpaceWeatherSource = {
  kind: SpaceWeatherKind; status: 'ok' | 'partial' | 'unavailable' | 'stale'
  count: number | null; fetchedUTC: string | null; message: string; skipped: number
}
export type SpaceWeatherReport = {
  configured: boolean; status: 'available' | 'partial' | 'unavailable' | 'unconfigured'
  checkedUTC: string; rangeStartUTC: string; rangeEndUTC: string
  sources: SpaceWeatherSource[]; events: SpaceWeatherEvent[]
  message: string; refreshAfterUTC: string
}

export const WEATHER_LABELS: Record<SpaceWeatherKind, string> = {
  FLR: 'Solar flares', CME: 'Solar eruptions', SEP: 'Energetic particles', notifications: 'NASA notices',
}
export const WEATHER_MEANING: Record<SpaceWeatherKind, string> = {
  FLR: 'A burst of radiation from the Sun. Flare reports help explain changing space-weather conditions.',
  CME: 'A cloud of solar material released into space. An eruption report alone does not say it will reach the Moon.',
  SEP: 'High-energy particles detected by the instruments listed in the report. This is not a measurement at your lunar site.',
  notifications: 'NASA analyst notices connect observations and explain their context. Open the original notice for its full analysis.',
}

let cached: SpaceWeatherReport | null = null
let pending: Promise<SpaceWeatherReport> | null = null

function validReport(value: unknown): value is SpaceWeatherReport {
  if (!value || typeof value !== 'object') return false
  const d = value as SpaceWeatherReport
  return typeof d.configured === 'boolean' && ['available', 'partial', 'unavailable', 'unconfigured'].includes(d.status) &&
    typeof d.checkedUTC === 'string' && Number.isFinite(Date.parse(d.checkedUTC)) &&
    typeof d.rangeStartUTC === 'string' && Number.isFinite(Date.parse(d.rangeStartUTC)) &&
    typeof d.rangeEndUTC === 'string' && Number.isFinite(Date.parse(d.rangeEndUTC)) &&
    typeof d.refreshAfterUTC === 'string' && Number.isFinite(Date.parse(d.refreshAfterUTC)) &&
    typeof d.message === 'string' && Array.isArray(d.sources) && d.sources.length <= 4 && Array.isArray(d.events) && d.events.length <= 40 &&
    d.sources.every(s => SPACE_WEATHER_KINDS.includes(s.kind) && ['ok', 'partial', 'unavailable', 'stale'].includes(s.status) && (s.count === null || Number.isSafeInteger(s.count) && s.count >= 0)) &&
    d.events.every(e => SPACE_WEATHER_KINDS.includes(e.kind) && typeof e.id === 'string' && typeof e.title === 'string' && Number.isFinite(Date.parse(e.timeUTC)) && typeof e.sourceURL === 'string')
}

export function weatherSourceURL(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || !(url.hostname === 'nasa.gov' || url.hostname.endsWith('.nasa.gov'))) return 'https://ccmc.gsfc.nasa.gov/tools/DONKI/'
    if ([...url.searchParams.keys()].some(key => /key|token|secret/i.test(key))) return 'https://ccmc.gsfc.nasa.gov/tools/DONKI/'
    return url.href
  } catch { return 'https://ccmc.gsfc.nasa.gov/tools/DONKI/' }
}

export function weatherTime(utc: string): string {
  const date = new Date(utc)
  return Number.isFinite(date.getTime()) ? date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC' : 'Time unavailable'
}

async function getReport(): Promise<SpaceWeatherReport> {
  if (cached && Date.parse(cached.refreshAfterUTC) > Date.now()) return cached
  if (!pending) pending = (async () => {
    const response = await fetch('/api/space-weather', { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('NASA space-weather reports could not be reached. Try again shortly.')
    const data: unknown = await response.json()
    if (!validReport(data)) throw new Error('NASA space-weather reports could not be read. Try again shortly.')
    cached = data
    return data
  })().finally(() => { pending = null })
  return pending
}

/** One shared request on opening, with manual refresh and a server cache. No scene-frame or interval polling. */
export function useSpaceWeather() {
  const [report, setReport] = useState<SpaceWeatherReport | null>(cached)
  const [loading, setLoading] = useState(!cached)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void getReport().then(data => { if (active) { setReport(data); setError('') } }).catch(() => { if (active) setError('NASA space-weather reports could not be reached. You can keep exploring.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  const refresh = async () => {
    if (loading) return
    setLoading(true); setError('')
    try { setReport(await getReport()) } catch { setError('NASA space-weather reports could not be reached. Any report below is from an earlier check.') }
    finally { setLoading(false) }
  }
  return { report, loading, error, refresh }
}
