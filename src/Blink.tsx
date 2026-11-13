import { useEffect, useRef, useState } from 'react'
import { ArrowLeftRight } from 'lucide-react'
import type { SimClock } from './Moon'

const HOUR = 3_600_000

const pad2 = (n: number) => String(n).padStart(2, '0')
const toISODate = (ms: number) => {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
}

type BlinkProps = {
  clock: React.RefObject<SimClock>
  startMs: number
  totalHours: number
  /** App pauses transport state so play/pause UI stays truthful. */
  onEngage: () => void
}

/** Blink-two-dates: eases the sim clock back and forth between two real
 *  dates, sweeping the terminator across the terrain. Roadmap item 4. */
export function Blink({ clock, startMs, totalHours, onEngage }: BlinkProps) {
  const [open, setOpen] = useState(false)
  const [on, setOn] = useState(false)
  const [a, setA] = useState(() => toISODate(startMs + ((Date.now() - startMs) % (totalHours * HOUR))))
  const [b, setB] = useState(() =>
    toISODate(Math.min(startMs + totalHours * HOUR, startMs + 30 * 24 * HOUR)),
  )
  const [period, setPeriod] = useState(8)
  const raf = useRef(0)

  const endMs = startMs + totalHours * HOUR
  const rowOf = (iso: string) => {
    const ms = Date.parse(iso + 'T00:00:00Z')
    if (Number.isNaN(ms)) return null
    return Math.max(0, Math.min(totalHours - 1, (ms - startMs) / HOUR))
  }

  useEffect(() => {
    if (!on) return
    const ra = rowOf(a)
    const rb = rowOf(b)
    if (ra === null || rb === null) return
    clock.current.playing = false
    onEngage()
    const t0 = performance.now()
    const tick = (now: number) => {
      const phase = 0.5 - 0.5 * Math.cos(((now - t0) / 1000 / period) * Math.PI * 2)
      clock.current.row = ra + (rb - ra) * phase
      raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, a, b, period])

  const field =
    'w-full rounded-md border border-edge bg-paper2 px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-edge2'

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-pressed={on}
        className={
          'flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ' +
          (on
            ? 'border-sun/50 bg-sun/10 text-sun'
            : 'border-edge text-inkdim hover:border-edge2 hover:text-ink')
        }
        title="Blink two dates: sweep the terminator between two real times"
      >
        <ArrowLeftRight className="h-3.5 w-3.5" />
        <span>Blink two dates</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-edge bg-panel/95 p-3 backdrop-blur-md">
          <div className="text-[12px] font-semibold uppercase tracking-[0.22em] text-inkdim">
            Blink two dates
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-inkdim">
            Sweeps the terminator between two real times — watch a site pass
            into and out of sunlight. Closing More tools stops the sweep.
          </p>
          <label className="mt-2 block text-[12px] font-medium uppercase tracking-[0.14em] text-inkdim">
            Date A
            <input
              type="date"
              className={'mt-1 ' + field}
              value={a}
              min={toISODate(startMs)}
              max={toISODate(endMs)}
              onChange={(e) => setA(e.target.value)}
            />
          </label>
          <label className="mt-2 block text-[12px] font-medium uppercase tracking-[0.14em] text-inkdim">
            Date B
            <input
              type="date"
              className={'mt-1 ' + field}
              value={b}
              min={toISODate(startMs)}
              max={toISODate(endMs)}
              onChange={(e) => setB(e.target.value)}
            />
          </label>
          <label className="mt-2 block text-[12px] font-medium uppercase tracking-[0.14em] text-inkdim">
            Sweep — {period}s
            <input
              type="range"
              min={2}
              max={30}
              step={1}
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="mt-1 w-full"
            />
          </label>
          <button
            onClick={() => setOn((v) => !v)}
            className={
              'mt-3 w-full rounded-md border px-2 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] transition-colors duration-150 ' +
              (on
                ? 'border-sun/50 bg-sun/10 text-sun'
                : 'border-edge text-inkdim hover:border-sun/50 hover:text-sun')
            }
          >
            {on ? '◼ Stop blink' : '▶ Start blink'}
          </button>
        </div>
      )}
    </div>
  )
}
