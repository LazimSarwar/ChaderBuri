import { useState } from 'react'
import { ChevronDown, ExternalLink, RefreshCw, Sun } from 'lucide-react'
import { SPACE_WEATHER_KINDS, WEATHER_LABELS, WEATHER_MEANING, useSpaceWeather, weatherSourceURL, weatherTime } from './lib/spaceWeather'
import type { SpaceWeatherKind } from './lib/spaceWeather'
import { useScreenDigest } from './lib/screenDigest'
import './space-weather.css'

const GUIDE: Record<SpaceWeatherKind, string> = {
  FLR: 'Flares describe solar radiation. The class is the reported X-ray strength; it is not a dose at the Moon.',
  CME: 'Eruptions can affect the wider space environment. Speed and a report time alone cannot establish a Moon impact.',
  SEP: 'Particle reports are important context for human exploration. A crew needs dedicated radiation monitoring and an operational forecast.',
  notifications: 'Read NASA’s linked notice for the observing location, timing and analyst interpretation.',
}

/** NASA's recent real-world reports stay separate from the simulated mission clock and its calculated verdict. */
export function SpaceWeather({ sceneUTC, compact = false }: { sceneUTC?: string; compact?: boolean }) {
  const { report, loading, error, refresh } = useSpaceWeather()
  const [expanded, setExpanded] = useState(!compact)
  const [filter, setFilter] = useState<SpaceWeatherKind>('SEP')
  const source = report?.sources.find(s => s.kind === filter)
  const events = report?.events.filter(e => e.kind === filter) ?? []
  const good = report?.status === 'available'
  const earlier = !!report && Date.now() - Date.parse(report.checkedUTC) > 15 * 60_000
  const summary = loading && !report ? 'Checking NASA reports…' : error ? 'Connection interrupted' : earlier ? 'Earlier NASA reports' : good ? 'Recent NASA reports' : report?.status === 'partial' ? 'Some reports delayed' : report?.status === 'unconfigured' ? 'NASA connection needed' : 'Reports unavailable'
  const missionDate = sceneUTC && Number.isFinite(Date.parse(sceneUTC)) ? new Date(sceneUTC).toISOString().slice(0,10) : null
  const reportDate = report?.checkedUTC.slice(0,10)
  useScreenDigest('weather', report ? [
    { id: 'weather-status', label: 'NASA space-weather connection', value: report.status, status: report.status === 'available' ? 'ok' : 'warn', source: 'NASA DONKI recent reports' },
    { id: 'weather-freshness', label: 'Displayed report freshness', value: error ? 'The current refresh failed. Displayed entries are from an earlier check.' : earlier ? 'Earlier check; use Check reports to update.' : 'See the checked time and each feed’s response time.', status: error || earlier ? 'warn' : 'ok', source: 'Report check and response timestamps' },
    { id: 'weather-checked', label: 'Reports checked at', value: report.checkedUTC, source: 'This server’s UTC fetch time' },
    { id: 'weather-range', label: 'Real-world report range', value: report.rangeStartUTC + ' to ' + report.rangeEndUTC, source: 'NASA DONKI query dates' },
    ...report.sources.map(feed => ({ id: 'weather-' + feed.kind, label: WEATHER_LABELS[feed.kind], value: (feed.count === null ? 'Count unknown' : feed.count + ' reports') + '; ' + feed.status + (feed.fetchedUTC ? '; response ' + feed.fetchedUTC : ''), status: feed.status === 'ok' ? 'ok' as const : 'warn' as const, source: 'NASA DONKI ' + feed.kind })),
    { id: 'weather-selected-type', label: 'Report type open on screen', value: WEATHER_LABELS[filter], source: 'Visitor’s selected NASA DONKI feed' },
    ...events.slice(0,3).flatMap((event, index) => [
      { id: `weather-event-${index}-title`, label: `Visible report ${index + 1}`, value: event.title.slice(0,80), source: 'NASA DONKI ' + event.kind },
      { id: `weather-event-${index}-time`, label: `Report ${index + 1} event time UTC`, value: event.timeUTC, source: 'NASA DONKI event timestamp' },
      ...(event.speedKms === undefined ? [] : [{ id: `weather-event-${index}-speed`, label: `Report ${index + 1} selected-analysis speed`, value: String(event.speedKms), unit: 'km/s', source: 'NASA DONKI most-accurate CME analysis' }]),
      ...(event.observingLocation ? [{ id: `weather-event-${index}-instrument`, label: `Report ${index + 1} observing instrument`, value: event.observingLocation.slice(0,80), source: 'NASA DONKI instrument attribution' }] : []),
    ]),
    { id: 'weather-scope', label: 'Report scope', value: 'Observed reports; not a forecast or a lunar radiation-dose measurement.', source: 'NASA DONKI report scope' },
    { id: 'weather-verdict', label: 'Mission decision scope', value: 'Not a site-safety assessment. Does not change the calculated mission verdict.', source: 'NASA DONKI report scope' },
  ] : null, JSON.stringify([report?.checkedUTC, report?.status, report?.sources, filter, events, error, earlier]))
  return <section className="space-weather" aria-label="NASA space weather" data-compact={compact}>
    <details open={expanded} onToggle={e => setExpanded(e.currentTarget.open)}>
      <summary><Sun size={19} aria-hidden="true" /><span><strong>Space weather</strong><small>{summary}</small></span><ChevronDown size={17} aria-hidden="true" /></summary>
      <div className="space-weather-body">
        <p className="space-weather-intro">What is the Sun doing? These are NASA’s recent real-world reports, separate from the mission simulation.</p>
        {report && <div className="space-weather-dates">
          <span>Checked <time dateTime={report.checkedUTC}>{weatherTime(report.checkedUTC)}</time></span>
          <span>Reports from {weatherTime(report.rangeStartUTC)} to {weatherTime(report.rangeEndUTC)}</span>
        </div>}
        {missionDate && reportDate && missionDate !== reportDate && <p className="space-weather-clock">Your scene is set to {weatherTime(sceneUTC!)}. These recent reports describe the real-world report dates above, not conditions at that mission time.</p>}
        {error && <p className="space-weather-status" role="alert">{error}</p>}
        {earlier && !error && <p className="space-weather-status" role="status">These reports are from an earlier check. Use Check reports for an updated response.</p>}
        {report && report.status !== 'available' && <p className="space-weather-status" role="status">{report.message}</p>}
        {loading && !report && <p role="status">Loading recent solar activity…</p>}
        {!!report?.sources.length && <>
          <div className="space-weather-types" role="group" aria-label="Space-weather report type">
            {SPACE_WEATHER_KINDS.map(kind => {
              const feed = report.sources.find(s => s.kind === kind)
              return <button key={kind} type="button" aria-pressed={kind === filter} onClick={() => setFilter(kind)}><span>{WEATHER_LABELS[kind]}</span><strong>{feed?.status === 'ok' ? `${feed.count} reported` : feed?.status === 'partial' ? `${feed.count} readable · incomplete` : feed?.status === 'stale' ? 'Earlier reports' : 'Unavailable'}</strong></button>
            })}
          </div>
          <p className="space-weather-meaning">{WEATHER_MEANING[filter]}</p>
          {source?.fetchedUTC && <p className="space-weather-feed-time">{source.status === 'stale' ? 'Earlier NASA response' : 'NASA response received'} <time dateTime={source.fetchedUTC}>{weatherTime(source.fetchedUTC)}</time>.</p>}
          {source?.message && <p className="space-weather-status" role="status">{source.message}</p>}
          {events.length ? <ol className="space-weather-events" aria-label={`${WEATHER_LABELS[filter]} reports`}>
            {events.map(event => <li key={event.id}>
              <div><strong>{event.title}</strong><time dateTime={event.timeUTC}>{weatherTime(event.timeUTC)}</time></div>
              {event.speedKms !== undefined && <p>NASA’s selected analysis: {event.speedKms.toLocaleString('en-US')} km/s.</p>}
              {event.observingLocation && <p>Reported instrument: {event.observingLocation}.</p>}
              <a href={weatherSourceURL(event.sourceURL)} target="_blank" rel="noopener noreferrer">Read NASA report<ExternalLink size={13} aria-hidden="true" /></a>
            </li>)}
          </ol> : source?.status === 'ok' && <p className="space-weather-empty">NASA returned no {WEATHER_LABELS[filter].toLowerCase()} entries in this date range. This is not an all-clear assessment.</p>}
          {source?.count !== null && source?.count !== undefined && source.count > events.length && <small>Showing the {events.length} most recent entries of {source.count} returned.</small>}
          <details className="space-weather-explain"><summary>Why this matters for a lunar visit</summary><p>{GUIDE[filter]}</p><p>Use space weather as mission context. These reports do not calculate an astronaut’s dose, local shielding or whether a site is safe, and they do not change the sunlight, Earth-link or battery result.</p></details>
        </>}
        <div className="space-weather-actions"><button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} aria-hidden="true" />{loading ? 'Checking…' : 'Check reports'}</button><a href="https://ccmc.gsfc.nasa.gov/tools/DONKI/" target="_blank" rel="noopener noreferrer">About NASA DONKI<ExternalLink size={13} aria-hidden="true" /></a></div>
      </div>
    </details>
  </section>
}
