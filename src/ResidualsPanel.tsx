import { useEffect, useState } from 'react'

type Residuals = {
  version: number
  createdUTC: string
  method: string
  gateMaxDeg: number
  controlGateMinDeg: number
  results: {
    slug: string
    target: 'sun' | 'earth'
    samples: number
    maxDeg: number
    rmsDeg: number
    medianDeg: number
    worst: { t: string; deltaDeg: number }
  }[]
  negativeControl: { shiftHours: number; samples: number; medianDeg: number; minDeg: number; failsGate: boolean }
  passed: boolean
  queries: number
}

function sci(d: number) {
  return d >= 0.01 ? d.toFixed(4) : d.toExponential(1)
}

export function ResidualsPanel() {
  const [report, setReport] = useState<Residuals | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetch('/data/benchmark/horizons-residuals.json')
      .then((r) => {
        if (!r.ok) throw new Error('Residual fixture unavailable')
        return r.json()
      })
      .then((r) => {
        if (active) setReport(r)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
    return () => {
      active = false
    }
  }, [])
  if (error)
    return (
      <section className="evidence-card mt-6">
        <h3>Live cross-check residuals</h3>
        <p className="benchmark-note">{error} — regenerate with <code>python scripts/build_horizons_residuals.py</code>.</p>
      </section>
    )
  if (!report) return <section className="evidence-card mt-6"><p className="ls-shimmer h-4 w-48 rounded" /></section>
  const overallMax = Math.max(...report.results.map((r) => r.maxDeg))
  return (
    <section className="evidence-card mt-6">
      <p className="eyebrow">Provenance fixture · cached predictions vs their live source</p>
      <h3>Horizons residuals</h3>
      <p>
        Each cached hourly az/el was re-queried live from JPL Horizons (same DE441 observer
        convention, including site heights) at {report.results[0]?.samples ?? 0} deterministic
        epochs per series. Separation uses atan2 cross/dot, so sub-arcsecond agreement is not
        masked by an acos floor. {report.queries} live queries,
        generated {new Date(report.createdUTC).toISOString().slice(0, 10)}.
      </p>
      <div className="benchmark-table-wrap">
        <table className="benchmark-table">
          <caption>
            Every series within the {report.gateMaxDeg}° gate · worst residual {sci(overallMax)}° ·{' '}
            <span className={report.passed ? 'text-viable' : 'text-danger'}>
              {report.passed ? 'gate met' : 'GATE FAILED'}
            </span>
          </caption>
          <thead>
            <tr>
              <th>Series</th>
              <th>Samples</th>
              <th>Max</th>
              <th>RMS</th>
              <th>Median</th>
              <th>Worst epoch (UT)</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((r) => (
              <tr key={`${r.slug}.${r.target}`}>
                <th>{r.slug.replace(/-/g, ' ')} · {r.target}</th>
                <td>{r.samples}</td>
                <td>{sci(r.maxDeg)}°</td>
                <td>{sci(r.rmsDeg)}°</td>
                <td>{sci(r.medianDeg)}°</td>
                <td>{r.worst.t}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="benchmark-note mt-4">
        Negative control: the same queries shifted +{report.negativeControl.shiftHours} h score a
        median of {report.negativeControl.medianDeg.toFixed(2)}° (min {report.negativeControl.minDeg.toFixed(2)}°) —{' '}
        {report.negativeControl.failsGate
          ? 'they fail the gate, so this fixture cannot pass vacuously.'
          : 'CONTROL DID NOT FAIL — fixture is vacuous and must be regenerated.'}
      </p>
      <p className="mt-3 text-[12px] leading-6 text-inkdim">
        This checks that the cached predictions match their declared source. It is a provenance
        record, not an independent astronomical validation. Regenerate:{' '}
        <code>npm run data:residuals</code>.
      </p>
    </section>
  )
}
