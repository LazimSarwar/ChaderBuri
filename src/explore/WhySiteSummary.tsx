import type { Constraints } from '../architect/solver'
import type { MissionReading } from './missionReadout'
import { LIMIT_LABEL } from './missionReadout'
import { AccuracyBadge } from './AccuracyBadge'

/** Plain-language presentation of the existing solver result, without a second verdict calculation. */
export function WhySiteSummary({ reading: a, constraints: c, resolutionM, validationNote, example }: { reading: MissionReading; constraints: Constraints; resolutionM: number; validationNote?: string; example: boolean }) {
  const r = a.result
  const badge = (scope: 'illumination' | 'earth' | 'power') => <AccuracyBadge scope={scope} resolutionM={resolutionM} heightM={a.observerHeightM} validationNote={validationNote} />
  return <section className="decision-why" aria-label="Site decision explained">
    <h3 data-meets={r.pass}>{example ? r.pass ? 'Meets the example mission limits' : 'Misses the example mission limits' : r.pass ? 'Meets these mission requirements' : 'Misses these mission requirements'}</h3>
    <p>{example ? `Example mission: a ${c.missionDays}-day prediction using the equipment and limits shown below.` : `This ${c.missionDays}-day prediction ${r.pass ? 'stays within' : 'misses at least one of'} the displayed mission limits.`} {r.pass ? 'The ranking’s tightest requirement' : 'The limiting requirement'} is {LIMIT_LABEL[r.limiting].toLowerCase()}.</p>
    <dl className="decision-why-facts">
      <div><dt>Light for solar power {badge('illumination')}</dt><dd>{r.litPct.toFixed(1)}% sunlight</dd><small>Longest darkness {r.longestDarkH.toFixed(1)} h · {example ? 'example limit' : 'limit'} {c.maxDarkH} h</small></div>
      <div><dt>Earth in view {badge('earth')}</dt><dd>{r.linkPct.toFixed(1)}% of mission hours</dd><small>Longest gap {r.longestGapH.toFixed(1)} h · {example ? 'example limit' : 'limit'} {c.maxGapH} h</small></div>
      {c.power && <div><dt>Battery reserve {badge('power')}</dt><dd>{r.power ? `${r.power.minPct.toFixed(1)}% minimum` : 'Unavailable'}</dd><small>{example ? 'Example minimum' : 'Minimum required'} {c.power.reservePct}%</small></div>}
    </dl>
    <p className="decision-why-scope">Predictions at the planned landing coordinate. Earth in view does not establish a radio link; meeting these limits does not certify a landing site.</p>
  </section>
}
