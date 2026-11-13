import { useEffect, useMemo, useState } from 'react'
import type { Ephemeris, Horizon } from '../data'
import { loadSpace, type BodyData } from '../space/ephemeris'
import {
  DEFAULT_RELAY,
  relayCoverage,
  relayPhaseSweep,
  type RelayConfig,
} from './relay'

export function RelayPanel({
  horizon,
  earth,
  row,
  hours,
}: {
  horizon: Horizon
  earth: Ephemeris
  row: number
  hours: number
}) {
  const [enabled, setEnabled] = useState(false),
    [moon, setMoon] = useState<BodyData | null>(null),
    [error, setError] = useState('')
  const [config, setConfig] = useState(DEFAULT_RELAY)
  const [sweepEnabled, setSweepEnabled] = useState(false)
  useEffect(() => {
    if (!enabled) return
    let active = true
    loadSpace()
      .then((data) => {
        if (active) setMoon(data.bodies.find((b) => b.name === 'Moon')!)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [enabled])
  const evaluation = useMemo(() => {
    if (!enabled || !moon) return null
    try {
      return {
        result: relayCoverage(moon, horizon, earth.rows, row, hours, config),
        error: '',
      }
    } catch (e) {
      return { result: null, error: String(e) }
    }
  }, [moon, horizon, earth, row, hours, config, enabled])
  const sweepEvaluation = useMemo(() => {
    if (!enabled || !moon || !sweepEnabled) return null
    try {
      return {
        sweep: relayPhaseSweep(moon, horizon, earth.rows, row, hours, config),
        error: '',
      }
    } catch (e) {
      return { sweep: null, error: String(e) }
    }
  }, [moon, horizon, earth, row, hours, config, enabled, sweepEnabled])
  const r = evaluation?.result
  const sweep = sweepEvaluation?.sweep
  return (
    <section
      className="mt-4 rounded-xl border border-edge bg-panel2/60 p-4"
      aria-label="Relay orbit design"
    >
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />{' '}
        Could a relay bridge the gap?
      </label>
      <p className="mt-2 text-xs leading-relaxed text-inkdim">
        Design a hypothetical lunar orbit. This is a geometric feasibility
        study, independent of the mission verdict; it does not represent an
        operating satellite or a booked communications service.
      </p>
      {enabled && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {(
              [
                [
                  'altitudeKm',
                  'Altitude above reference Moon (km)',
                  100,
                  10000,
                ],
                [
                  'inclinationDeg',
                  'Inclination to initial Moon equator (°)',
                  0,
                  180,
                ],
                ['nodeDeg', 'Initial ascending-node longitude (°)', -180, 180],
                ['phaseDeg', 'Phase at landing (°)', 0, 360],
              ] as [keyof RelayConfig, string, number, number][]
            ).map(([key, label, min, max]) => (
              <label key={key} className="text-[12px] leading-5 text-inkdim">
                {label}
                <input
                  className="mt-1 w-full rounded border border-edge bg-panel p-2 text-ink"
                  type="number"
                  min={min}
                  max={max}
                  value={config[key]}
                  onChange={(e) => {
                    const value = Number(e.target.value)
                    if (Number.isFinite(value) && value >= min && value <= max)
                      setConfig((c) => ({ ...c, [key]: value }))
                  }}
                />
              </label>
            ))}
          </div>
          {r ? (
            <>
              <div className="mt-4 flex flex-wrap gap-5 text-sm">
                <span>
                  Relay geometry{' '}
                  <strong className="text-sun">{r.relayPct.toFixed(1)}%</strong>
                </span>
                <span>
                  DTE <strong>{r.dtePct.toFixed(1)}%</strong>
                </span>
                <span>
                  Either path{' '}
                  <strong className="text-viable">
                    {r.combinedPct.toFixed(1)}%
                  </strong>
                </span>
                <span>
                  Longest combined gap{' '}
                  <strong>{r.longestGapH.toFixed(2)} h</strong>
                </span>
              </div>
              <p className="mt-2 text-xs text-inkdim">
                Orbital period {r.periodH.toFixed(2)} h · {r.intervals.length}{' '}
                geometric relay passes · {r.stepMinutes}-minute sampling
              </p>
              <svg
                viewBox={`0 0 ${hours} 12`}
                preserveAspectRatio="none"
                className="mt-3 h-5 w-full rounded bg-paper3"
                role="img"
                aria-label="Relay visibility across mission, gold intervals visible"
              >
                {r.intervals.map((p, i) => (
                  <rect
                    key={i}
                    x={p.startH}
                    y={0}
                    width={p.endH - p.startH}
                    height={12}
                    fill="var(--color-sun)"
                  />
                ))}
              </svg>
              <div className="mt-4 border-t border-edge pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-ink">Landing-phase design sweep</p>
                    <p className="mt-1 text-[12px] leading-relaxed text-inkdim">
                      Compare 24 starting phases at 15° spacing. Ranking minimizes the longest
                      combined outage, then maximizes total availability.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-md border border-sun/50 bg-sun/10 px-3 py-2 text-[12px] font-semibold text-sun"
                    onClick={() => setSweepEnabled((value) => !value)}
                    aria-expanded={sweepEnabled}
                  >
                    {sweepEnabled ? 'Hide phase sweep' : 'Sweep 24 phases'}
                  </button>
                </div>
                {sweep && (
                  <div className="mt-3 rounded-lg border border-edge bg-panel/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <span>
                        Best phase <strong className="text-sun">{sweep.best.phaseDeg}°</strong>
                      </span>
                      <span>
                        Either path <strong className="text-viable">{sweep.best.result.combinedPct.toFixed(1)}%</strong>
                      </span>
                      <span>
                        Longest gap <strong>{sweep.best.result.longestGapH.toFixed(2)} h</strong>
                      </span>
                      <button
                        type="button"
                        className="text-earth underline underline-offset-4"
                        onClick={() => setConfig((current) => ({ ...current, phaseDeg: sweep.best.phaseDeg }))}
                      >
                        Apply best phase
                      </button>
                    </div>
                    <svg
                      viewBox="0 0 240 58"
                      preserveAspectRatio="none"
                      className="mt-3 h-20 w-full"
                      role="img"
                      aria-label={`Combined contact availability across 24 relay phases; best phase ${sweep.best.phaseDeg} degrees gives ${sweep.best.result.combinedPct.toFixed(1)} percent availability and ${sweep.best.result.longestGapH.toFixed(2)} hour longest gap`}
                    >
                      <line x1="0" x2="240" y1="52" y2="52" stroke="var(--color-edge2)" strokeWidth="0.7" />
                      {sweep.samples.map((sample, index) => {
                        const height = Math.max(1, sample.result.combinedPct * 0.48)
                        const best = sample.phaseDeg === sweep.best.phaseDeg
                        const selected = sample.phaseDeg === config.phaseDeg
                        return (
                          <rect
                            key={sample.phaseDeg}
                            x={index * 10 + 1}
                            y={52 - height}
                            width="7"
                            height={height}
                            rx="1"
                            fill={best ? 'var(--color-viable)' : selected ? 'var(--color-sun)' : 'var(--color-earth)'}
                            opacity={best || selected ? 1 : 0.58}
                          >
                            <title>{`${sample.phaseDeg}° · ${sample.result.combinedPct.toFixed(1)}% either path · ${sample.result.longestGapH.toFixed(2)} h longest gap`}</title>
                          </rect>
                        )
                      })}
                      <text x="1" y="57" fill="var(--color-inkdim)" fontSize="4">0°</text>
                      <text x="239" y="57" textAnchor="end" fill="var(--color-inkdim)" fontSize="4">345°</text>
                    </svg>
                    <p className="mt-1 text-[11px] text-inkdim">
                      Green is the outage-first optimum; gold is the selected phase. This sweep changes
                      starting phase only—not altitude, orbit plane, hardware or service assumptions.
                    </p>
                  </div>
                )}
                {sweepEvaluation?.error && (
                  <p className="mt-3 text-xs text-danger" role="status">{sweepEvaluation.error}</p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-3 text-xs" role="status">
              {error || evaluation?.error || 'Loading lunar orientation…'}
            </p>
          )}
          <p className="mt-3 text-[12px] leading-relaxed text-inkdim">
            Circular two-body orbit using NAIF Moon GM and SPICE lunar
            orientation. Ground-to-relay must clear the LOLA horizon;
            relay-to-Earth must clear the 1737.4 km reference Moon. Hourly
            apparent Earth vectors are interpolated. No orbital perturbations,
            RF link budget, antenna limits, satellite power, outages or
            scheduling are modelled. Sub-five-minute passes can be missed.
          </p>
          <p className="mt-2 text-[12px] text-inkdim">
            <a
              className="text-sun underline"
              href="https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Lunar_Pathfinder_Europe_s_first_step_towards_a_connected_Moon"
              target="_blank"
              rel="noreferrer"
            >
              ESA Lunar Pathfinder
            </a>{' '}
            is a separate mission, currently planned for 2027; this orbit is not
            its trajectory.
          </p>
        </>
      )}
    </section>
  )
}
