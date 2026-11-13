import { useMemo } from 'react'
import { Globe2, Sun } from 'lucide-react'
import type { EphRow, Horizon } from '../data'
import { horizonAt } from '../data'
import { nextHorizonCrossing } from '../lib/attribution'
import { sampleSky } from '../lib/science'
import { bodyState, formatEta, relativeDirectionText, type BodyState } from './fieldMath'
import { HeightNote } from './HeightNote'

type Props = {
  heading: number
  row: number
  epoch: Date
  horizon: Horizon
  sunRows: EphRow[]
  earthRows: EphRow[]
  analysisObserverHeightM: number
  eyeHeightM: number
  missionLinked: boolean
  onFace: (az: number, el: number) => void
}
const STATE_TEXT: Record<BodyState, string> = { above: 'Above the measured skyline', partial: 'Partly behind the skyline', below: 'Behind the measured skyline' }
const deg = (v: number, digits = 1) => `${v.toFixed(digits)}°`
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}°`

/** Where the Sun and Earth are, how far they clear the measured horizon, and which way to turn. */
export function SunEarthPanel(p: Props) {
  const hourKey = Math.floor(p.row * 4)
  const bodies = useMemo(() => (['sun', 'earth'] as const).map(id => {
    const rows = id === 'sun' ? p.sunRows : p.earthRows, sky = sampleSky(rows, p.row)
    const skyline = horizonAt(p.horizon, sky.az), state = bodyState(id, sky.el, skyline, sky.radiusDeg)
    const up = state !== 'below'
    const crossing = nextHorizonCrossing(rows, p.epoch, p.horizon, !up)
    return { id, sky, skyline, state, up, crossing }
  }), [hourKey, p.horizon, p.sunRows, p.earthRows])
  return <div className="field-sky">
    {bodies.map(b => {
      const Icon = b.id === 'sun' ? Sun : Globe2, name = b.id === 'sun' ? 'Sun' : 'Earth'
      return <section key={b.id} className="field-body" data-body={b.id} data-state={b.state} aria-label={`${name} position`}>
        <header><Icon size={16} aria-hidden="true" /><h3>{name}</h3><span className="field-state">{STATE_TEXT[b.state]}</span></header>
        <dl className="field-facts">
          <div><dt>Azimuth</dt><dd>{deg(b.sky.az, 0)}</dd></div>
          <div><dt>Elevation</dt><dd>{deg(b.sky.el)}</dd></div>
          <div><dt>Skyline at that azimuth</dt><dd>{deg(b.skyline)}</dd></div>
          <div><dt>Clearance</dt><dd>{signed(b.sky.el - b.skyline)}</dd></div>
          <div><dt>From where you face</dt><dd>{relativeDirectionText(p.heading, b.sky.az)}</dd></div>
          <div><dt>{b.up ? (b.id === 'sun' ? 'Next sunset' : 'Next earthset') : (b.id === 'sun' ? 'Next sunrise' : 'Next earthrise')}</dt>
            <dd>{b.crossing ? <>{formatEta(b.crossing.hours)}<small>{b.crossing.atUTC} UTC</small></> : 'Not within the loaded predictions'}</dd></div>
        </dl>
        <button className="field-button" onClick={() => p.onFace(b.sky.az, b.sky.el)}>Turn to face the {name}</button>
      </section>
    })}
    <HeightNote eyeHeightM={p.eyeHeightM} analysisObserverHeightM={p.analysisObserverHeightM} missionLinked={p.missionLinked} />
    <p className="field-source">Positions: JPL Horizons predictions for the landing point. Skyline: the measured LOLA horizon at the landing point, not at your current position.</p>
  </div>
}
