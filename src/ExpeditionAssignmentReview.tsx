import { useEffect, useMemo, useState } from 'react'
import type { ExpeditionProps } from './ExpeditionPanel'
import type { AssignmentStep } from './lib/expedition'
import { buildExpeditionDebrief } from './lib/expedition'
import { buildSeries } from './architect/solver'
import { explorationDecision } from './lib/explorationDecision'
import { parseRowT } from './lib/sim'
import { MODEL_VERSION } from './modelIdentity'
import { DecisionDebrief } from './DecisionDebrief'

type Props = Pick<ExpeditionProps, 'site' | 'epoch' | 'row' | 'viewpoint' | 'sunRows' | 'earthRows' | 'horizon' | 'decisionConstraints' | 'assignment' | 'onAssignment' | 'lastInspection' | 'flags' | 'photos' | 'equipment' | 'comparisonCount' | 'onDecisionCompare' | 'datasetId'> & { steps: AssignmentStep[] }

function DebriefDownload({ name, value }: { name: string; value: unknown }) {
  const contents = JSON.stringify(value, null, 2), [url, setURL] = useState('')
  useEffect(() => { const next = URL.createObjectURL(new Blob([contents], { type: 'application/json' })); setURL(next); return () => URL.revokeObjectURL(next) }, [contents])
  return <a className="tool-button" href={url || undefined} aria-disabled={!url} download={name}>Export decision debrief</a>
}

/** The same guarded field assignment and decision debrief in both exploration interfaces. */
export function ExpeditionAssignmentReview(p: Props) {
  const complete = p.steps.length > 0 && p.steps.every(s => s.done)
  const series = useMemo(() => complete ? buildSeries(p.site.slug, p.sunRows, p.earthRows, p.horizon) : null, [complete, p.site.slug, p.sunRows, p.earthRows, p.horizon])
  const decisionRow = p.assignment?.decisionRow ?? Math.round(p.row)
  const pair = useMemo(() => series ? explorationDecision(series, decisionRow, parseRowT(p.sunRows[0].t).getTime(), p.decisionConstraints) : null, [series, decisionRow, p.sunRows, p.decisionConstraints])
  const start = (kind: NonNullable<Props['assignment']>['kind']) => p.onAssignment({ kind, siteSlug: p.site.slug, startedUTC: new Date().toISOString(), startDistanceM: p.viewpoint.trailDistanceM ?? 0, inspectionId: p.lastInspection?.id ?? null, flagIds: p.flags.map(f => f.id), photoIds: p.photos.map(f => f.id), panelAz: p.equipment.panelAz, panelTilt: p.equipment.panelTilt, comparisonCount: p.comparisonCount, decisionRow: Math.round(p.row) })
  return <div className="expedition-assignment-review">
    <h3>Mission assignments</h3>
    {!p.assignment ? <><p>Optional field tasks. End with a reasoned landing-date choice.</p><div className="expedition-menu"><button onClick={() => start('scout')}><span>Scout report<small>Inspect, mark, photograph and walk home</small></span></button><button onClick={() => start('power')}><span>Power experiment<small>Deploy, orient, photograph and compare</small></span></button></div></> : <>
      <h4>{p.assignment.kind === 'scout' ? 'Scout report' : 'Power experiment'} · {p.steps.filter(s => s.done).length}/4</h4>
      {complete ? <details className="decision-assumptions"><summary>4 / 4 field tasks complete</summary><ol className="assignment-steps">{p.steps.map(s => <li key={s.label} data-done={s.done}>✓ {s.label}</li>)}</ol></details> : <ol className="assignment-steps">{p.steps.map(s => <li key={s.label} data-done={s.done}>{s.done ? '✓' : '○'} {s.label}</li>)}</ol>}
      {complete && pair ? <><DecisionDebrief pair={pair} reflection={p.assignment.reflection} onChange={reflection => p.onAssignment({ ...p.assignment!, reflection })} onCompare={() => p.onDecisionCompare(pair.rowA)} />
        {(pair.recommendation === null || p.assignment.reflection?.reviewedUTC) && <DebriefDownload name={`chader-buri-${p.site.slug}-debrief.json`} value={buildExpeditionDebrief({ site: p.site, observerHeightM: p.horizon.observerHeightAboveGroundM ?? 0, sceneUTC: p.epoch.toISOString(), datasetId: p.datasetId, model: MODEL_VERSION, assignment: p.assignment, steps: p.steps, comparison: pair, inspection: p.lastInspection, flags: p.flags, photos: p.photos, equipment: p.equipment })} />}
      </> : <p>Next: {p.steps.find(s => !s.done)?.label}.</p>}
      <button className="tool-button" onClick={() => p.onAssignment(null)}>End assignment</button>
    </>}
  </div>
}
