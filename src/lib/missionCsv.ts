import type { Ephemeris, Horizon, Site } from '../data.ts'
import type { Scn } from '../architect/comparison.ts'
import type { SiteSeries } from '../architect/solver.ts'
import type { PredictionIndex } from './predictionIndex.ts'
import { exportSnapshot } from './exportSnapshot.ts'
import { missionTimeline, momentAt } from './missionMoment.ts'
import { missionEvents } from '../explore/missionEvents.ts'
import { TIMING_LIMITATION } from './attribution.ts'

export type CsvCell = string | number | boolean | null | undefined
export type MissionCsvKind = 'hourly' | 'events'
export type MissionCsvInput = {
  index: PredictionIndex
  scenarios: (Scn & { label?: string })[]
  series: Map<string, SiteSeries>
  sites: Site[]
  eph: Record<string, Record<'sun' | 'earth', Ephemeris>>
  horizons: Record<string, Horizon>
  generatedUTC?: string
}

/** RFC 4180. Text is spreadsheet-safe; negative numeric measurements remain numbers. */
export function csvCell(value: CsvCell): string {
  if (value == null) return ''
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('A CSV value is not a finite number.')
  let text = String(value)
  if (typeof value === 'string' && (/^[\s\uFEFF]*[=+\-@]/u.test(text) || /^[\t\r\n]/.test(text))) text = "'" + text
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text
}

export function csvTable(headers: string[], rows: CsvCell[][]): string {
  if (rows.some(row => row.length !== headers.length)) throw new Error('CSV columns do not match.')
  return '\uFEFF' + [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

const HOUR = 3_600_000
const COMMON = [
  'schema_version', 'export_generated_utc', 'scenario_id', 'scenario_label', 'site_slug', 'site_name',
  'latitude_deg', 'longitude_east_deg', 'landing_utc', 'mission_end_utc', 'mission_duration_h',
  'battery_assessment', 'thermal_assessment', 'requirements_and_hardware_json',
  'dataset_id', 'model_version', 'model_sha256', 'sun_product_sha256', 'earth_product_sha256', 'horizon_product_sha256',
  'sites_product_sha256', 'analysis_observer_height_m', 'terrain_source', 'source_coverage_start_utc', 'source_coverage_end_utc',
  'sampling_and_event_limits', 'scope',
]
const HOURLY = [
  'utc', 'mission_hour', 'mission_day', 'sample_kind', 'interval_end_utc', 'interval_duration_h',
  'sun_azimuth_deg', 'sun_elevation_deg', 'sun_skyline_deg', 'sun_clearance_deg', 'sun_centre_visible',
  'earth_azimuth_deg', 'earth_elevation_deg', 'earth_skyline_deg', 'earth_clearance_deg', 'earth_centre_visible',
  'effective_solar_fraction', 'solar_generation_w', 'base_load_w', 'heater_load_w', 'total_demand_w',
  'battery_charge_pct', 'battery_reserve_pct', 'below_battery_reserve', 'lander_temperature_c', 'survival_limit_c',
]
const EVENTS = ['event_utc', 'mission_hour', 'event_id', 'event_kind', 'event', 'timing_basis', 'note']

/** Exports the existing nominal models; never clips a mission to available coverage. */
export function missionCsv(input: MissionCsvInput, kind: MissionCsvKind): { filename: string; text: string; rows: number } {
  const { index, scenarios, series, sites, eph, horizons } = input
  const startMs = Date.parse(index.coverage.start), generatedUTC = input.generatedUTC ?? new Date().toISOString()
  if (!Number.isFinite(startMs) || !Number.isFinite(Date.parse(generatedUTC))) throw new Error('The export clock is unavailable.')
  if (!scenarios.length || scenarios.length > 3) throw new Error('Choose one to three complete mission scenarios.')
  const identity = exportSnapshot(index, scenarios.map(s => s.slug))
  const stamp = (row: number) => new Date(Math.round(startMs + row * HOUR)).toISOString()
  const rows: CsvCell[][] = []
  for (let i = 0; i < scenarios.length; i++) {
    const s = scenarios[i], data = series.get(s.slug), pair = eph[s.slug], horizon = horizons[s.slug]
    const site = sites.find(site => site.slug === s.slug), hours = s.c.missionDays * 24, end = s.row + hours
    if (!site || !data || !pair || !horizon || !Number.isInteger(s.row) || s.row < 0 || !Number.isInteger(s.c.missionDays) || hours < 72 || hours > 720 || end > data.hours || end >= pair.sun.rows.length || end >= pair.earth.rows.length || end >= index.coverage.samples) {
      throw new Error(`Scenario ${String.fromCharCode(65 + i)} needs complete site data and coverage for the whole mission. No partial CSV was downloaded.`)
    }
    if (s.c.thermal && !s.c.power) throw new Error(`Scenario ${String.fromCharCode(65 + i)} needs the battery model enabled for thermal survival. No partial CSV was downloaded.`)
    const sha = (path: string) => identity.productFingerprints[path]?.sha256 ?? null
    const common: CsvCell[] = [
      1, generatedUTC, String.fromCharCode(65 + i), s.label ?? `Option ${String.fromCharCode(65 + i)}`, s.slug, site.name,
      site.lat, site.lonEast, stamp(s.row), stamp(end), hours, s.c.power ? 'assessed' : 'disabled', s.c.power && s.c.thermal ? 'assessed' : 'disabled', JSON.stringify(s.c),
      identity.datasetId, identity.model.version, identity.model.sha256, sha(`/data/ephemeris/${s.slug}.sun.json`), sha(`/data/ephemeris/${s.slug}.earth.json`), sha(`/data/horizons/${s.slug}.json`),
      sha('/data/sites.json'), horizon.observerHeightAboveGroundM ?? identity.analysisObserverHeightM, horizon.demSource,
      stamp(0), stamp(index.coverage.samples - 1), TIMING_LIMITATION,
      'Nominal landing-point screening. Earth visibility is not radio service. Footprint, RF, landing hazards and crew safety are not assessed by this export. Blank values are unavailable, disabled, or outside an interval as identified by the status columns.',
    ]
    if (kind === 'hourly') {
      const timeline = missionTimeline(data, s.row, s.c)
      for (let h = 0; h <= hours; h++) {
        const m = momentAt(timeline, pair.sun.rows, pair.earth.rows, horizon, h)
        rows.push([...common, stamp(m.row), h, m.day, m.ended ? 'mission_end_boundary' : 'interval_start', m.ended ? null : stamp(m.row + 1), m.ended ? null : 1,
          m.sun.az, m.sun.el, m.sun.skyline, m.sun.clearance, m.sun.visible,
          m.earth.az, m.earth.el, m.earth.skyline, m.earth.clearance, m.earth.visible,
          m.ended ? null : data.solar.fraction[m.row], m.solarW, m.ended ? null : s.c.power?.loadW, m.heaterW, m.demandW,
          m.batteryPct, m.reservePct, m.batteryPct === null ? null : m.belowReserve, m.tempC, m.survivalC,
        ])
      }
    } else {
      const events = [{ id: 'landing', label: 'Landing', row: s.row, kind: 'boundary', note: 'Start of the selected mission window.' }, ...missionEvents(data, s.row, s.c).events]
      for (const event of events) rows.push([...common, stamp(event.row), event.row - s.row, event.id, event.kind, event.label,
        event.kind === 'boundary' ? 'Selected mission boundary' : event.kind === 'sky' ? 'Hourly centre visibility transition' : 'Existing mission model estimate', event.note])
    }
  }
  const prefix = scenarios.length === 1 ? `${scenarios[0].slug}-` : `comparison-${scenarios.length}-options-`
  return { filename: `chader-buri-${prefix}${stamp(scenarios[0].row).slice(0, 10)}-${kind}.csv`, text: csvTable([...COMMON, ...(kind === 'hourly' ? HOURLY : EVENTS)], rows), rows: rows.length }
}
