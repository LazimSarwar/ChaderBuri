/** Presentation of existing mission-console results; no geometry or mission calculation. */
export type AntennaMission = {
  days: number
  basis: string
  earthPct: number
  longestEarthGapH: number
  minEarthPct: number
  maxEarthGapH: number
  opportunityPct: number | null
  longestOpportunityGapH: number | null
  nextEarthsetUTC: string | null
  phase: 'before' | 'during' | 'ended' | 'after'
}

export function antennaMissionText(m: AntennaMission) {
  const example = m.basis === 'Illustrative exploration mission'
  const limits = example ? 'example limits' : 'your Earth-visibility limits'
  const misses = m.earthPct < m.minEarthPct || m.longestEarthGapH > m.maxEarthGapH
  return {
    title: `${example ? 'Example ' : ''}${m.days}-day mission`,
    earth: `Earth above the skyline: ${m.earthPct.toFixed(1)}%. Longest time behind terrain: ${m.longestEarthGapH.toFixed(1)} h.`,
    stations: m.opportunityPct === null || m.longestOpportunityGapH === null
      ? 'Earth + DSN opportunity is not assessed yet. Open Earth link to check data availability.'
      : `Earth + DSN opportunity: ${m.opportunityPct.toFixed(1)}%. Longest gap without a simultaneous opportunity: ${m.longestOpportunityGapH.toFixed(1)} h.`,
    next: m.phase === 'after' || m.phase === 'ended'
      ? 'The scene has reached or passed the mission end. Return to arrival in Time to investigate this mission.'
      : m.nextEarthsetUTC
        ? `Next sampled Earthset: ${m.nextEarthsetUTC}.`
        : 'No later Earthset sample in the selected mission. This does not rule out interruptions between hourly samples.',
    consequence: misses
      ? `This site/date misses ${limits} (at least ${m.minEarthPct}% Earth visibility; at most ${m.maxEarthGapH} h behind terrain). Compare another site or arrival.`
      : `This site/date meets ${limits} (at least ${m.minEarthPct}% Earth visibility; at most ${m.maxEarthGapH} h behind terrain). Review Earth link before comparing alternatives.`,
  }
}
