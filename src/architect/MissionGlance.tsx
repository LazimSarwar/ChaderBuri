import { useRef } from 'react'
import type { PowerRun } from './power.ts'
import type { Constraints, SiteSeries } from './solver.ts'

const W = 800, LEFT = 64, RIGHT = 784, BAT_TOP = 18, BAT_BOTTOM = 122, SUN_Y = 140, EARTH_Y = 160, STRIP_H = 12
const runsOf = (prefix: Int32Array, start: number, end: number) => {
  const out: [number, number][] = []
  let open = -1
  for (let h = start; h < end; h++) {
    const on = prefix[h + 1] - prefix[h] === 1
    if (on && open < 0) open = h
    if (!on && open >= 0) { out.push([open, h]); open = -1 }
  }
  if (open >= 0) out.push([open, end])
  return out
}

/** Events worth pointing at on the timeline, in absolute hourly rows. */
export type GlanceMarks = { lowest?: { row: number; pct: number } | null; reserveRow?: number | null; dark?: [number, number] | null; gap?: [number, number] | null }

/**
 * Time cursor for the timeline. `hour` is mission-relative (0 = landing, span = end of mission).
 * Click or drag on the chart, or focus it and use the arrow keys (Shift or Page keys: one day).
 */
export type GlanceCursor = { hour: number; onChange: (hour: number) => void; text: string; label: string }

/** Mission at a glance: battery charge through the mission, with the hours of sunlight and Earth in view beneath it. */
/** highlight: an interval Chader Buri is pointing at, as absolute [start, end) rows. */
export function MissionGlance({ series, row, c, run, marks = {}, cursor, highlight }: { series: SiteSeries; row: number; c: Constraints; run: PowerRun | null; marks?: GlanceMarks; cursor?: GlanceCursor; highlight?: [number, number] | null }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const end = Math.min(series.hours, row + Math.round(c.missionDays * 24)), span = Math.max(1, end - row)
  const lit = runsOf(series.litPrefix, row, end), link = runsOf(series.linkPrefix, row, end)
  const x = (h: number) => LEFT + (Math.max(0, Math.min(span, h)) / span) * (RIGHT - LEFT)
  const xr = (absRow: number) => x(absRow - row)
  const y = (pct: number) => BAT_BOTTOM - (pct / 100) * (BAT_BOTTOM - BAT_TOP)
  const points = run?.points ?? []
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.hour).toFixed(1)},${y(p.socPct).toFixed(1)}`).join(' ')
  const reserve = c.power?.reservePct ?? 0
  const days = c.missionDays, step = days > 20 ? 5 : days > 10 ? 2 : 1
  const band = (r: [number, number], top: number, label: string, anchorTop: boolean) => {
    const a = xr(r[0]), b = xr(r[1]), mid = (a + b) / 2
    return <g className="mp-glance-mark">
      <rect x={a} y={top - 3} width={Math.max(2, b - a)} height={STRIP_H + 6} className="mp-glance-band" />
      <text x={Math.max(LEFT + 4, Math.min(RIGHT - 4, mid))} y={anchorTop ? top - 6 : top + STRIP_H + 14} textAnchor={mid < LEFT + 80 ? 'start' : mid > RIGHT - 80 ? 'end' : 'middle'} className="mp-glance-note">{label}</text>
    </g>
  }

  // Pointer position → whole mission hour.
  const hourAt = (clientX: number) => {
    const r = svgRef.current?.getBoundingClientRect()
    if (!r || r.width === 0) return 0
    const px = ((clientX - r.left) / r.width) * W
    return Math.round(Math.max(0, Math.min(span, ((px - LEFT) / (RIGHT - LEFT)) * span)))
  }
  const move = (h: number) => cursor?.onChange(Math.max(0, Math.min(span, h)))
  const onKey = (e: React.KeyboardEvent) => {
    if (!cursor) return
    const big = e.shiftKey ? 24 : 1
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? cursor.hour + big : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? cursor.hour - big
      : e.key === 'PageUp' ? cursor.hour + 24 : e.key === 'PageDown' ? cursor.hour - 24 : e.key === 'Home' ? 0 : e.key === 'End' ? span : null
    if (next === null) return
    e.preventDefault(); move(next)
  }
  const ch = cursor ? Math.max(0, Math.min(span, cursor.hour)) : null
  const interactive = cursor ? {
    tabIndex: 0, role: 'slider', 'aria-label': cursor.label, 'aria-valuemin': 0, 'aria-valuemax': span, 'aria-valuenow': ch ?? 0, 'aria-valuetext': cursor.text,
    onKeyDown: onKey,
    onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => { if (e.pointerType !== 'touch') e.currentTarget.setPointerCapture(e.pointerId); move(hourAt(e.clientX)) },
    onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => { if (e.buttons & 1 && e.pointerType !== 'touch') move(hourAt(e.clientX)) },
  } : { role: 'img' }

  return <figure className="mp-glance" data-cursor={!!cursor} aria-label={`Mission timeline: ${run ? `battery lowest ${run.minPct.toFixed(0)} percent, ` : ''}${lit.length} sunlit spells and ${link.length} Earth-in-view spells over ${days} days`}>
    <svg ref={svgRef} viewBox={`0 0 ${W} 214`} {...interactive}>
      <text x="0" y={y(100) + 4} className="mp-glance-axis">100%</text>
      <text x="0" y={y(50) + 4} className="mp-glance-axis">50%</text>
      <text x="0" y={y(0) + 4} className="mp-glance-axis">0%</text>
      {[0, 50, 100].map(v => <line key={v} x1={LEFT} x2={RIGHT} y1={y(v)} y2={y(v)} className="mp-glance-grid" />)}
      {marks.dark && <rect x={xr(marks.dark[0])} y={BAT_TOP} width={Math.max(2, xr(marks.dark[1]) - xr(marks.dark[0]))} height={EARTH_Y + STRIP_H - BAT_TOP} className="mp-glance-shadow" />}
      {run ? <>
        <path d={`${line} L${x(points.at(-1)?.hour ?? 0)},${y(0)} L${LEFT},${y(0)} Z`} className="mp-glance-area" />
        <path d={line} className="mp-glance-line" />
        <line x1={LEFT} x2={RIGHT} y1={y(reserve)} y2={y(reserve)} className="mp-glance-reserve" />
        <text x="0" y={y(reserve) + 4} className="mp-glance-reserve-label">Reserve</text>
        {marks.lowest && <g className="mp-glance-mark"><circle cx={xr(marks.lowest.row)} cy={y(marks.lowest.pct)} r="4.5" className="mp-glance-min" /><text x={Math.min(RIGHT - 4, Math.max(LEFT + 4, xr(marks.lowest.row)))} y={Math.min(BAT_BOTTOM - 4, y(marks.lowest.pct) + 16)} textAnchor={xr(marks.lowest.row) > RIGHT - 90 ? 'end' : xr(marks.lowest.row) < LEFT + 90 ? 'start' : 'middle'} className="mp-glance-note">Lowest {marks.lowest.pct.toFixed(0)}%</text></g>}
        {marks.reserveRow != null && <g className="mp-glance-mark"><line x1={xr(marks.reserveRow)} x2={xr(marks.reserveRow)} y1={BAT_TOP} y2={BAT_BOTTOM} className="mp-glance-breach" /><text x={Math.min(RIGHT - 4, xr(marks.reserveRow) + 4)} y={BAT_TOP + 10} textAnchor={xr(marks.reserveRow) > RIGHT - 140 ? 'end' : 'start'} className="mp-glance-breach-label">Below reserve</text></g>}
      </> : <text x={(LEFT + RIGHT) / 2} y={(BAT_TOP + BAT_BOTTOM) / 2} textAnchor="middle" className="mp-glance-axis">Battery not assessed: turn on “Require battery reserve”</text>}
      <text x="0" y={SUN_Y + 10} className="mp-glance-axis">Sun</text>
      <rect x={LEFT} y={SUN_Y} width={RIGHT - LEFT} height={STRIP_H} className="mp-glance-track" />
      {lit.map(([a, b]) => <rect key={a} x={xr(a)} y={SUN_Y} width={Math.max(1, xr(b) - xr(a))} height={STRIP_H} className="mp-glance-sun" />)}
      <text x="0" y={EARTH_Y + 10} className="mp-glance-axis">Earth</text>
      <rect x={LEFT} y={EARTH_Y} width={RIGHT - LEFT} height={STRIP_H} className="mp-glance-track" />
      {link.map(([a, b]) => <rect key={a} x={xr(a)} y={EARTH_Y} width={Math.max(1, xr(b) - xr(a))} height={STRIP_H} className="mp-glance-earth" />)}
      {marks.gap && band(marks.gap, EARTH_Y, `Longest Earth gap ${marks.gap[1] - marks.gap[0]} h`, false)}
      {Array.from({ length: Math.floor(days / step) + 1 }, (_, i) => i * step).map(d => <text key={d} x={x(d * 24)} y="208" textAnchor={d === 0 ? 'start' : d >= days ? 'end' : 'middle'} className="mp-glance-axis">Day {d}</text>)}
      {highlight && <rect className="mp-glance-pointed" pointerEvents="none" x={xr(highlight[0])} y={BAT_TOP - 4} width={Math.max(3, xr(highlight[1]) - xr(highlight[0]))} height={EARTH_Y + STRIP_H + 8 - BAT_TOP} rx="4"><title>Highlighted by Chader Buri</title></rect>}
      {ch !== null && <g className="mp-glance-cursor" pointerEvents="none">
        <line x1={x(ch)} x2={x(ch)} y1={BAT_TOP - 8} y2={EARTH_Y + STRIP_H + 4} />
        <rect x={x(ch) - 3} y={BAT_TOP - 12} width="6" height="6" rx="1.5" />
        {run && points[ch] && <circle cx={x(ch)} cy={y(points[ch].socPct)} r="4" />}
      </g>}
    </svg>
    <figcaption><span><i className="is-battery" />Battery charge</span><span><i className="is-sun" />Sun above the terrain</span><span><i className="is-earth" />Earth in view</span>{marks.dark && <span><i className="is-shadow" />Longest darkness</span>}{run && <span><i className="is-reserve" />Reserve limit</span>}{cursor && <span><i className="is-cursor" />Time cursor</span>}</figcaption>
  </figure>
}
