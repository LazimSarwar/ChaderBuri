import type { ReadingKind } from '../lib/contracts.ts'
export type AccuracyScope = 'illumination' | 'earth' | 'power' | 'thermal' | 'ground' | 'ranking' | 'comms' | 'time'
export function accuracyText(scope: AccuracyScope, resolutionM: number, heightM: number, validationNote?: string) {
  const kind: ReadingKind = scope === 'ground' || scope === 'comms' ? 'estimated' : 'calculated'
  const source = scope === 'ground' ? `Loaded LOLA DEM, ${resolutionM} m pixels; samples between pixels are interpolated.` : scope === 'comms' ? 'JPL/Horizons cached DSN elevations, 6° station mask, and nominal Earth visibility.' : 'Cached JPL directions, LOLA nominal skyline and the indexed screening solver.'
  const sampling = scope === 'ground' ? 'DEM derivatives and relief around the landing coordinate; unresolved rocks, craters and bearing strength not assessed.' : `Hourly sky samples; nominal landing coordinate; ${heightM} m analysis height. These values do not move with the astronaut.`
  return { kind, source, sampling, validation: scope === 'illumination' && validationNote ? validationNote : 'Model and geometry checks are separate from operational certification. No universal accuracy percentage is established.', scope: scope === 'comms' ? 'Estimated station opportunity, not a booked pass, measured bitrate or operational RF service.' : 'Predictions and model estimates, not live telemetry or landing/EVA certification.' }
}
