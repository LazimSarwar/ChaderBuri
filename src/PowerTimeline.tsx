import { referencePanelPower } from './lib/science.ts'
import { useMemo } from 'react'
import { parseRowT } from './lib/sim'
import { type EphRow, type Horizon } from './data'

const W = 600
const H = 110
const STRIP_H = 12
const THRESHOLD_W = 30 // W/m^2 example reference level (stated assumption)

type PowerTimelineProps = {
  sunRows: EphRow[]
  earthRows: EphRow[]
  horizon: Horizon
}

/**
 * Full-window power & comms story for the selected site:
 * hourly terrain-masked panel watts as an area, the example survival
 * threshold, and a direct-to-Earth link strip beneath.
 */
export function PowerTimeline({ sunRows, earthRows, horizon }: PowerTimelineProps) {
  const total = sunRows.length

  const { buckets, maxW, startLabel, midLabel, endLabel } = useMemo(() => {
    const hz = (az: number) => horizon.profile[Math.round(az) % 360]
    const B = 581
    const per = Math.ceil(total / B)
    const arr: { w: number; link: number }[] = []
    for (let b = 0; b < B; b++) {
      let w = 0
      let link = 0
      let n = 0
      for (let i = b * per; i < Math.min((b + 1) * per, total); i++) {
        const s = sunRows[i]
        const e = earthRows[i]
        w = Math.max(w, referencePanelPower(s, e, hz(s.az)))
        if (e.el > hz(e.az)) link++
        n++
      }
      arr.push({ w, link: n ? link / n : 0 })
    }
    const d0 = parseRowT(sunRows[0].t)
    const dm = parseRowT(sunRows[Math.floor(total / 2)].t)
    const d1 = parseRowT(sunRows[total - 1].t)
    const fmt = (d: Date) =>
      `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`
    return {
      buckets: arr,
      maxW: Math.max(150, ...arr.map((b) => b.w)) * 1.08,
      startLabel: fmt(d0),
      midLabel: fmt(dm),
      endLabel: fmt(d1),
    }
  }, [sunRows, earthRows, horizon])

  const B = buckets.length
  const x = (i: number) => (i / B) * W
  const y = (w: number) => H - (w / maxW) * (H - 6) - 2

  const area = useMemo(() => {
    let d = `M 0 ${H}`
    buckets.forEach((b, i) => {
      d += ` L ${x(i).toFixed(1)} ${y(b.w).toFixed(1)}`
    })
    d += ` L ${W} ${H} Z`
    return d
  }, [buckets, maxW])

  const thrY = y(THRESHOLD_W)
  const chartH = H + STRIP_H + 16

  return (
    <div>
      <div className="relative select-none">
        <svg viewBox={`0 0 ${W} ${chartH}`} className="w-full" role="img"
          aria-label="Cached-window estimated solar power and Earth visibility">
          <line x1={0} x2={W} y1={thrY} y2={thrY} stroke="var(--color-danger)" strokeWidth={1}
            strokeDasharray="4 3" opacity={0.7} />
          <path d={area} fill="var(--color-sun)" fillOpacity={0.25} stroke="var(--color-sun)" strokeWidth={1.2} />
          {/* comms strip */}
          {buckets.map((b, i) => (
            <rect key={i} x={x(i)} y={H + 4} width={W / B + 0.6} height={STRIP_H - 2}
              fill={b.link > 0.5 ? 'var(--color-earth)' : 'var(--color-paper3)'} />
          ))}
          <line x1={0} x2={W} y1={H + 4 + STRIP_H - 1} y2={H + 4 + STRIP_H - 1}
            stroke="var(--color-edge)" strokeWidth={1} />
        </svg>
        {/* labels */}
        <span className="pointer-events-none absolute left-1 top-0 font-mono text-[12px] text-danger/80">
          {THRESHOLD_W} W/m² example reference level
        </span>
        <span className="pointer-events-none absolute left-1 font-mono text-[12px] text-inkdim"
          style={{ top: `${((H + 4 + STRIP_H / 2) / chartH) * 100}%`, transform: 'translateY(-50%)' }}>
          earth link
        </span>
        <div className="flex justify-between font-mono text-[12px] text-inkdim">
          <span>{startLabel}</span>
          <span>{midLabel}</span>
          <span>{endLabel}</span>
        </div>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-inkdim">
        Peak panel output per {Math.ceil(total / 581)}-hour bucket, terrain/eclipsing masks, 28%-efficient horizontal
        panel. Threshold is an example assumption — the real number depends on the
        lander.
      </p>
    </div>
  )
}
