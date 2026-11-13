import { useEffect, useState } from 'react'

type Ablation = {
  version: number
  createdUTC: string
  method: string
  rows: {
    slug: string
    litPctPoint1h: number
    litPctDisc1h: number
    litPctPoint10min: number
    maxAbsSpreadPct: number
    linkPct: number
  }[]
  maxSpreadPct: number
}

/** Model-ablation spread for the duty-cycle screening numbers. */
export function UncertaintyPanel() {
  const [report, setReport] = useState<Ablation | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    fetch('/data/benchmark/model-ablation.json')
      .then((r) => {
        if (!r.ok) throw new Error('Ablation report unavailable')
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
        <h3>Model-choice spread</h3>
        <p className="benchmark-note">{error} — regenerate with <code>python scripts/build_uncertainty.py</code>.</p>
      </section>
    )
  if (!report) return <section className="evidence-card mt-6"><p className="ls-shimmer h-4 w-48 rounded" /></section>
  return (
    <section className="evidence-card mt-6">
      <p className="eyebrow">Legacy classification diagnostic</p>
      <h3>Equivalent thresholds & interpolated sampling</h3>
      <p>
        A uniform solar disc being half visible is the same geometric threshold as its centre
        clearing a level ridge, apart from equality. That comparison is not independent evidence.
        The ten-minute column interpolates the same hourly cache; it is not new source data.
        Use the actual finer-source probes above for the targeted transition checks.
      </p>
      <div className="benchmark-table-wrap">
        <table className="benchmark-table">
          <caption>
            Legacy report covers {report.rows.length} sites · observed classification spread {report.maxSpreadPct} percentage points, not an accuracy bound
          </caption>
          <thead>
            <tr>
              <th>Site</th>
              <th>Point · 1 h (shipped)</th>
              <th>50% disc · same threshold</th>
              <th>Interpolated · 10 min</th>
              <th>Max spread</th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((r) => (
              <tr key={r.slug}>
                <th>{r.slug.replace(/-/g, ' ')}</th>
                <td>{r.litPctPoint1h.toFixed(2)}%</td>
                <td>{r.litPctDisc1h.toFixed(2)}%</td>
                <td>{r.litPctPoint10min.toFixed(2)}%</td>
                <td>{r.maxAbsSpreadPct.toFixed(2)} pp</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[12px] leading-6 text-inkdim">{report.method}</p>
    </section>
  )
}
