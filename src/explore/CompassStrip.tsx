import type { VisitPose } from '../lib/visit'
import type { VisitPoseStore } from './visitPoseStore'
import { useVisitPose } from './useVisitPose'
import { compassTicks, relativeTurn, bearingFromTo } from './fieldMath'
import { OUTPOST_POSITION, EQUIPMENT_POSITIONS } from '../lib/surfaceMission'
import { antennaDistanceM, antennaBearing } from './fieldObjective'
import type { HighlightObject } from './useFieldBridge'
/** Only this small leaf follows every camera pose. */
export function CompassStrip({store,fallback,sun,earth,highlight}:{store?:VisitPoseStore;fallback:VisitPose;sun:{az:number};earth:{az:number};highlight:HighlightObject}){
 const pose=useVisitPose(store,fallback),p={heading:pose.heading},east=pose.eastM??0,north=pose.northM??0,fromLanding=Math.hypot(east,north),visitorAt={eastM:east,northM:north},landerBearing=bearingFromTo(east,north,OUTPOST_POSITION.eastM,OUTPOST_POSITION.northM)
  const HALF = 60
  const tapePos = (az: number) => { const d = relativeTurn(p.heading, az), edge = Math.abs(d) > HALF; return { left: `${50 + Math.max(-HALF, Math.min(HALF, d)) / HALF * 50}%`, edge, side: d < 0 ? 'left' : 'right' } }
  const compassMarks = [
    { id: 'sun', label: 'Sun', az: sun.az, tone: 'sun' },
    { id: 'earth', label: 'Earth', az: earth.az, tone: 'earth' },
    { id: 'lander', label: 'Lander', az: landerBearing, tone: 'lander' },
    ...(fromLanding > 3 ? [{ id: 'landing', label: 'Landing point', az: bearingFromTo(east, north, 0, 0), tone: 'landing' }] : []),
    // While the objective asks the visitor to walk to the antenna, the tape shows where it is.
    ...(highlight === 'antenna' && antennaDistanceM(visitorAt) > 0.5 ? [{ id: 'antenna', label: 'Antenna', az: antennaBearing(visitorAt), tone: 'antenna' }] : []),
    // The equipment an activity is about gets a mark so it can be found.
    ...(highlight === 'panel' && Math.hypot(EQUIPMENT_POSITIONS.panel.eastM - east, EQUIPMENT_POSITIONS.panel.northM - north) > 0.5 ? [{ id: 'panel', label: 'Panel', az: bearingFromTo(east, north, EQUIPMENT_POSITIONS.panel.eastM, EQUIPMENT_POSITIONS.panel.northM), tone: 'antenna' }] : []),
  ]

 return <div className="field-compass" role="img" aria-label={`Heading ${Math.round(p.heading)} degrees. Sun ${Math.round(relativeTurn(p.heading, sun.az))} degrees, Earth ${Math.round(relativeTurn(p.heading, earth.az))} degrees, lander ${Math.round(relativeTurn(p.heading, landerBearing))} degrees from straight ahead.`}>
        <div className="field-compass-track">
          {compassTicks(p.heading, HALF, 15).map(t => <span key={t.bearing} className="field-tick" data-major={!!t.label} style={{ left: `${50 + t.offset / HALF * 50}%` }}>{t.label && <b>{t.label}</b>}</span>)}
        </div>
        <div className="field-compass-marks">
          {(() => {
            // Marks that would touch share one label ("Sun · Lander") instead of stacking over the tick numbers.
            // Widths are estimated in pixels of the tape (min(460px, 44vw); full width on phones).
            const tapePx = typeof window === 'undefined' ? 460 : window.innerWidth < 720 ? window.innerWidth - 32 : Math.min(460, window.innerWidth * 0.44)
            const textPx = (labels: string[]) => labels.reduce((s, l) => s + l.length * 8 + 14, 0) + (labels.length - 1) * 12 + 14
            type Group = { marks: { id: string; label: string; tone: string }[]; x: number; edge?: string }
            const span = (g: Group) => { const w = textPx(g.marks.map(m => m.label)); return g.edge === 'left' ? [0, w] : g.edge === 'right' ? [tapePx - w, tapePx] : [g.x - w / 2, g.x + w / 2] }
            const groups: Group[] = []
            for (const m of compassMarks.map(m => ({ ...m, pos: tapePos(m.az) })).sort((a, b) => (a.pos.edge && a.pos.side === 'left' ? -1 : parseFloat(a.pos.left)) - (b.pos.edge && b.pos.side === 'left' ? -1 : parseFloat(b.pos.left)))) {
              const next: Group = { marks: [m], x: parseFloat(m.pos.left) / 100 * tapePx, edge: m.pos.edge ? m.pos.side : undefined }
              const prev = groups.at(-1)
              if (prev && span(next)[0] < span(prev)[1] + 6) { prev.marks.push(m); if (next.edge === 'right') prev.edge = 'right'; else if (!prev.edge) prev.x = (prev.x * (prev.marks.length - 1) + next.x) / prev.marks.length }
              else groups.push(next)
            }
            return groups.map(group => { const g = group.marks, edge = group.edge, x = Math.max(0, Math.min(100, group.x / tapePx * 100))
              return <span key={g.map(m => m.id).join('-')} className="field-mark-group" data-edge={edge} style={{ left: `${edge === 'left' ? 0 : edge === 'right' ? 100 : x}%` }}>
                {g.map((m, i) => <span key={m.id} className="field-mark" data-tone={m.tone}>{i > 0 && <em aria-hidden="true">·</em>}<i />{m.label}</span>)}
              </span> })
          })()}
        </div>
        <span className="field-heading">{String(Math.round(p.heading) % 360).padStart(3, '0')}°</span>
      </div>
}
