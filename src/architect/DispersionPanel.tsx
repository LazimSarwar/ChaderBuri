import { useEffect, useState } from 'react'
import type { Ephemeris } from '../data'
import type { Constraints } from './solver'
import type { RobustnessAssessment,RobustnessProducts } from './robustness'
import type { PredictionIndex } from '../lib/predictionIndex'
import { exportSnapshot } from '../lib/exportSnapshot'

export function DispersionPanel({
  slug,
  sun,
  earth,
  row,
  constraints,
  datasetIndex, assessment, products,
}: {
  slug: string
  sun: Ephemeris
  earth: Ephemeris
  row: number
  constraints: Constraints
  datasetIndex: PredictionIndex
  assessment: RobustnessAssessment
  products: RobustnessProducts
}) {
  const [selected,setSelected]=useState(0)
  useEffect(()=>setSelected(0),[slug])
  const data=products.footprint.status==='ready'?products.footprint.data:null
  const result=assessment.footprint.status==='ready'?assessment.footprint.data:null
  const error=assessment.footprint.status==='unavailable'?'Footprint unavailable; not assessed.':''
  const point = result?.samples[selected]
  const exportReport = () => {
    const report = {
      version: 2,
      generatedUTC:new Date().toISOString(),
      reproducibility:exportSnapshot(datasetIndex,[slug]),
      site: slug,
      landing: sun.rows[row].t,
      constraints,
      terrain: data,
      ephemeris: { sun: sun.provenance, earth: earth.provenance },
      geometry:
        'Local translation of nominal apparent topocentric vectors; differential light-time and aberration not recomputed',
      interpretation:
        'Nineteen-point sensitivity; not continuous landing safety or probability',
      result,
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
    )
    const a = document.createElement('a')
    a.href = url
    a.download = `chader-buri-${slug}-dispersion.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <section
      className="mt-4 rounded-xl border border-edge bg-panel2/60 p-4"
      aria-label="Landing dispersion check"
    >
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">
          What if you miss the target?
        </h3>
        {result && (
          <div className="flex items-center gap-3">
            <strong
              className={
                result.passing === 19
                  ? 'text-viable'
                  : result.passing
                    ? 'text-sun'
                    : 'text-danger'
              }
            >
              {result.verdict} · {result.passing}/19 pass
            </strong>
            <button
              onClick={exportReport}
              className="rounded border border-edge px-2 py-1 text-xs text-inkdim"
            >
              Report JSON
            </button>
          </div>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-inkdim">
        250 m landing radius. Centre, six inner points and twelve outer points;
        each has its own LOLA terrain horizon. Every point is checked against the
        same visibility and battery requirements as the nominal window; thermal
        survival and RF are not assessed here.
      </p>
      {!result ? (
        <p className="mt-3 text-xs text-inkdim" role="status">
          {error || 'Loading terrain samples…'}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-5">
          <svg
            viewBox="0 0 230 230"
            className="h-52 w-52 shrink-0"
            role="group"
            aria-label="Sampled landing footprint, north up"
          >
            <circle
              cx="115"
              cy="115"
              r="90"
              fill="none"
              stroke="var(--color-edge2)"
              strokeDasharray="4 4"
            />
            <circle cx="115" cy="115" r="45" fill="none" stroke="var(--color-edge)" />
            <text
              x="115"
              y="13"
              textAnchor="middle"
              fill="var(--color-inkdim)"
              fontSize="11"
            >
              N · 250 m
            </text>
            {result.samples.map((p, i) => (
              <g
                key={i}
                role="button"
                tabIndex={0}
                aria-label={`Sample ${i + 1}, ${p.result.pass ? 'passes' : 'fails'}`}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelected(i)
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  cx={115 + p.terrain.eastM * 0.36}
                  cy={115 - p.terrain.northM * 0.36}
                  r="10"
                  fill={p.result.pass ? 'var(--color-viable)' : 'var(--color-danger)'}
                  stroke={selected === i ? '#ffffff' : 'var(--color-ink)'}
                  strokeWidth={selected === i ? 3 : 1}
                />
                <text
                  x={115 + p.terrain.eastM * 0.36}
                  y={119 - p.terrain.northM * 0.36}
                  textAnchor="middle"
                  fontSize="11"
                  fill="var(--color-ink)"
                >
                  {i + 1}
                </text>
              </g>
            ))}
          </svg>
          {point && (
            <div className="min-w-40 flex-1 text-xs leading-6 text-inkdim">
              <p className="text-ink">
                Sample {selected + 1} ·{' '}
                {selected === 0
                  ? 'nominal target'
                  : `${point.terrain.eastM.toFixed(0)} m east, ${point.terrain.northM.toFixed(0)} m north`}
              </p>
              <p>
                Sunlit {point.result.litPct.toFixed(1)}% · Earth link{' '}
                {point.result.linkPct.toFixed(1)}%
              </p>
              <p>
                Longest darkness {point.result.longestDarkH} h · link gap{' '}
                {point.result.longestGapH} h
              </p>
              {point.result.power && (
                <p>
                  Minimum battery {point.result.power.minPct.toFixed(1)}% ·{' '}
                  {point.result.power.firstUnmetH === null
                    ? 'no energy shortfall'
                    : `unmet demand begins at ${point.result.power.firstUnmetH.toFixed(1)} h`}
                </p>
              )}
              <p className="mt-2">
                Elevation {point.terrain.siteHeightM.toFixed(0)} m · DEM{' '}
                {data!.demResolutionM} m/pixel
              </p>
            </div>
          )}
        </div>
      )}
      <p className="mt-2 text-[12px] leading-relaxed text-inkdim">
        Robust = all samples pass; marginal = mixed; fragile = none pass.
        Sampled visibility and energy sensitivity, not continuous landing safety
        or probability. Nearby sky directions are translated from the nominal
        apparent ephemeris; corrections for differential light-time are not
        recomputed. This does not assess rocks, slopes, thermal survival or
        touchdown dynamics.
      </p>
    </section>
  )
}
