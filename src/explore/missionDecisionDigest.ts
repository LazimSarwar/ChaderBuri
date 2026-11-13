import type { ScreenDigestItem } from '../lib/contracts.ts'
import type { Constraints } from '../architect/solver.ts'
import type { MissionReading } from './missionReadout.ts'
export const MISSION_DECISION_SCREEN = 'surface-mission-readout'
export const EXCURSION_SCREEN = 'surface-excursion'
export function missionDecisionDigest(p: { site: string; sceneUTC: string; arrivalUTC: string; basis: string; constraints: Constraints; current?: MissionReading; alternative?: MissionReading; alternativeName?: string }): ScreenDigestItem[] {
  const facts: ScreenDigestItem[] = [
    { id: 'proposal-site', label: 'Inspected mission site (proposal)', value: p.site },
    { id: 'proposal-time', label: 'Inspected arrival UTC (not scene clock)', value: p.arrivalUTC },
    { id: 'proposal-scene', label: 'Current 3D scene UTC', value: p.sceneUTC },
    { id: 'proposal-basis', label: 'Inspected equipment source', value: p.basis },
    { id: 'proposal-days', label: 'Inspected mission duration', value: String(p.constraints.missionDays), unit: 'days' },
    { id: 'proposal-scope', label: 'Assessment scope', value: 'Nominal cached model; local hazards and flight feasibility unassessed' },
  ]
  const power = p.constraints.power
  if (power) facts.push({ id: 'proposal-equipment', label: 'Inspected lander equipment', value: `${power.panelAreaM2} m² ${power.orientation}; ${power.loadW} W; ${power.capacityWh / 1000} kWh` }, { id: 'proposal-reserve', label: 'Visitor-chosen battery reserve', value: String(power.reservePct), unit: '%' })
  const add = (name: string, reading: MissionReading | undefined, prefix: string) => {
    if (!reading) return
    const r = reading.result
    facts.push({ id: `${prefix}-site`, label: `${prefix} site`, value: name }, { id: `${prefix}-verdict`, label: `${prefix} nominal verdict`, value: r.pass ? 'Meets selected requirements' : 'Does not meet selected requirements' },
      { id: `${prefix}-sun`, label: `${prefix} Sun above skyline`, value: r.litPct.toFixed(1), unit: '%' }, { id: `${prefix}-earth`, label: `${prefix} Earth above skyline`, value: r.linkPct.toFixed(1), unit: '%' },
      { id: `${prefix}-battery`, label: `${prefix} lowest battery`, value: r.power ? r.power.minPct.toFixed(1) : 'Not assessed', unit: r.power ? '%' : undefined })
  }
  add(p.site, p.current, 'A'); add(p.alternativeName ?? 'Alternative', p.alternative, 'B')
  return facts
}
