import type { MissionEvent } from './missionEvents'

/** Display labels only: mission event rows and numerical results stay unchanged. */
export function missionEventLabel(event: Pick<MissionEvent, 'kind' | 'label'>) {
  if (event.kind !== 'sky') return event.label
  const labels: Record<string, string> = { Sunrise: 'Sun visible · hourly sample', Sunset: 'Sun hidden · hourly sample', Earthrise: 'Earth visible · hourly sample', Earthset: 'Earth hidden · hourly sample' }
  return labels[event.label] ?? event.label + ' · hourly sample'
}
export const MISSION_EVENT_TIMING_NOTE = 'Sky events here mark the first hourly sample after the change. Time previews estimate the crossing between samples, so Earth or the Sun may already be visible before this sample.'
export const CROSSING_TIMING_NOTE = 'Crossing times are estimated between hourly predictions. The mission timeline marks the first hourly sample after the change; its time can be later.'
export function viewLightingText(sun: 'above' | 'partial' | 'below', lamp: boolean) {
  return (sun === 'above' ? 'Sun above skyline.' : sun === 'partial' ? 'Sun partly hidden.' : 'Sun behind terrain.') + (lamp ? ' Helmet lamp on: inspection light only, no solar power.' : ' Helmet lamp off. Use Lamp for inspection light; it adds no solar power.')
}
