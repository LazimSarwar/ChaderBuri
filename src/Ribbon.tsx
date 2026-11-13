import { memo, useMemo, useRef } from 'react'
import { clamp, fmtDayShort, parseRowT } from './lib/sim'
import type { EphRow, Horizon } from './data'

const WIN = 720 // hours shown: 30 days
const TOTAL_H = 26 // svg viewBox height

type RibbonProps = {
  sunRows: EphRow[]
  earthRows: EphRow[]
  horizon: Horizon
  row: number
  setRow: (r: number) => void
  /** Mission window chosen in the Mission Architect, outlined on the ribbon. */
  missionWindow?: { startRow: number; endRow: number } | null
  onClearWindow?: () => void
}

/**
 * 30-day mission ribbon: per-hour sun (amber) and Earth-link (cyan) segments,
 * terrain-masked. Drag anywhere to scrub time.
 */
// Memoised: its output depends only on these props (App passes stable callbacks), so the App's frequent surface
// re-renders do not rebuild the hour cells.
export const Ribbon = memo(function Ribbon({
  sunRows,
  earthRows,
  horizon,
  row,
  setRow,
  missionWindow,
  onClearWindow,
}: RibbonProps) {
  const total = sunRows.length - 1
  const boxRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const start = clamp(Math.round(row) - WIN / 2, 0, total - WIN)

  const cols = useMemo(() => {
    const hz = (az: number) => horizon.profile[Math.round(az) % 360]
    const out: { lit: boolean; link: boolean; midnight: boolean; label?: string }[] = []
    for (let i = start; i < start + WIN; i++) {
      const s = sunRows[i]
      const e = earthRows[i]
      const d = parseRowT(s.t)
      const midnight = d.getUTCHours() === 0
      let label: string | undefined
      if (midnight && (d.getUTCDate() - 1) % 5 === 0) label = fmtDayShort(d)
      out.push({ lit: s.el > hz(s.az), link: e.el > hz(e.az), midnight, label })
    }
    return out
  }, [start, sunRows, earthRows, horizon])

  const markerX = clamp(row - start, 0, WIN)

  // visible slice of the Architect's mission window (the ribbon only shows 30 days)
  const winX1 = missionWindow ? clamp(missionWindow.startRow - start, 0, WIN) : 0
  const winX2 = missionWindow ? clamp(missionWindow.endRow - start, 0, WIN) : 0
  const showWindow = !!missionWindow && winX2 > winX1

  const scrub = (clientX: number) => {
    const box = boxRef.current
    if (!box) return
    const r = box.getBoundingClientRect()
    const frac = clamp((clientX - r.left) / r.width, 0, 1)
    setRow(Math.round(start + frac * WIN))
  }

  return (
    <div className="pointer-events-auto flex items-stretch gap-3 rounded-xl border border-edge bg-panel/80 px-3 py-2 backdrop-blur-md md:px-4">
      <div className="hidden w-24 shrink-0 flex-col justify-center leading-tight sm:flex">
        <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-inkdim">
          30-day
        </span>
        <span className="text-[12px] font-semibold uppercase tracking-[0.22em] text-inkdim">
          ribbon
        </span>
        <span className="mt-1 font-mono text-[10px] text-inkdim/70">
          {fmtDayShort(parseRowT(sunRows[start].t))} → {fmtDayShort(parseRowT(sunRows[start + WIN].t))}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          ref={boxRef}
          className="relative h-8 cursor-ew-resize select-none touch-none"
          role="slider" tabIndex={0} aria-label="Simulation epoch" aria-valuemin={0} aria-valuemax={total} aria-valuenow={Math.round(row)} aria-valuetext={parseRowT(sunRows[Math.round(row)].t).toISOString()}
          onKeyDown={e => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); setRow(e.key === 'Home' ? 0 : e.key === 'End' ? total : row + (e.key === 'ArrowLeft' ? -1 : 1)) } }}
          onPointerDown={(e) => {
            dragging.current = true
            e.currentTarget.setPointerCapture(e.pointerId)
            scrub(e.clientX)
          }}
          onPointerMove={(e) => {
            if (dragging.current) scrub(e.clientX)
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
        >
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${WIN} ${TOTAL_H}`}
            preserveAspectRatio="none"
          >
            {cols.map((c, i) =>
              c.midnight ? (
                <line
                  key={`g${i}`}
                  x1={i}
                  x2={i}
                  y1={0}
                  y2={TOTAL_H}
                  stroke="var(--color-edge)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null,
            )}
            {cols.map((c, i) => (
              <rect key={`s${i}`} x={i} y={2} width={1.15} height={9} fill={c.lit ? 'var(--color-sun)' : 'var(--color-paper3)'} />
            ))}
            {cols.map((c, i) => (
              <rect key={`e${i}`} x={i} y={15} width={1.15} height={9} fill={c.link ? 'var(--color-earth)' : 'var(--color-paper3)'} />
            ))}
            {showWindow && (
              <rect
                x={winX1}
                y={0.5}
                width={winX2 - winX1}
                height={TOTAL_H - 1}
                fill="var(--color-ink)"
                fillOpacity={0.07}
                stroke="var(--color-ink)"
                strokeOpacity={0.7}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            <line
              x1={markerX}
              x2={markerX}
              y1={0}
              y2={TOTAL_H}
              stroke="var(--color-ink)"
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {/* day labels (html so they don't stretch) */}
          {cols.map((c, i) =>
            c.label ? (
              <span
                key={`l${i}`}
                className="pointer-events-none absolute top-0 -translate-x-1/2 font-mono text-[12px] text-inkdim"
                style={{ left: `${(i / WIN) * 100}%` }}
              >
                {c.label}
              </span>
            ) : null,
          )}
        </div>
        <div className="flex items-center gap-4 text-[12px] font-medium uppercase tracking-[0.18em] text-inkdim">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-[2px] bg-sun/80" /> sunlit
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-[2px] bg-earth/80" /> earth visible
          </span>
          {missionWindow && (
            <button
              onClick={onClearWindow}
              className="flex items-center gap-1.5 text-inkdim transition-colors duration-150 hover:text-ink"
              title="Clear the mission window"
            >
              <span className="inline-block h-2 w-3 rounded-[2px] border border-ink/70 bg-ink/10" /> mission window ×
            </button>
          )}
          <details className="ribbon-sources ml-auto"><summary>Data sources</summary><p>Ephemeris NASA/JPL Horizons (DE441) · Terrain NASA LRO LOLA GDR V2.0 · horizons marched to 160 km</p></details>
          <span className="hidden shrink-0 md:inline">drag to scrub · terrain-masked</span>
        </div>
      </div>
    </div>
  )
})
