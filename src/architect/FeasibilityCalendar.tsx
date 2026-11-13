import { useMemo } from 'react'
import { buildCalendarMonths, type CalendarCell } from './calendar'
import type { Constraints, SiteSeries } from './solver'

const WD = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function cellLabel(startMs: number, cell: CalendarCell) {
  const d = new Date(startMs + cell.day * 24 * 3600_000)
  const date = `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
  return cell.bestHour === null
    ? `${date} UT: no landing start meets the enabled requirements`
    : `${date} UT: best start ${String(cell.bestHour).padStart(2, '0')}:00, tightest margin ${(cell.margin! * 100).toFixed(1)}%`
}

/**
 * Best landing start per day for the featured site, as a compact month grid.
 * Clicking a feasible day pins that day's best start. Gray = infeasible;
 * green depth = how much slack the tightest constraint keeps.
 */
export function FeasibilityCalendar({
  startMs, series, c, loDay, hiDay, missionHours, siteName, onPick,
}: {
  startMs: number
  series: SiteSeries
  c: Constraints
  loDay: number
  hiDay: number
  missionHours: number
  siteName: string
  onPick: (row: number) => void
}) {
  const months = useMemo(
    () => buildCalendarMonths(startMs, series, c, loDay, hiDay, missionHours),
    [startMs, series, c, loDay, hiDay, missionHours],
  )
  const maxMargin = Math.max(
    0,
    ...months.flatMap((m) => m.cells
      .filter((x): x is CalendarCell & { bestHour: number; margin: number } => !!x && x.bestHour !== null)
      .map((x) => x.margin)),
  )
  const feasibleDays = months.flatMap((m) => m.cells).filter((x): x is CalendarCell => !!x && x.bestHour !== null).length

  return (
    <section className="mt-5" aria-label={`Feasibility calendar for ${siteName}`}>
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-inkdim">
        Feasibility calendar · {siteName}
      </h3>
      <p className="mt-1 text-[12px] leading-6 text-inkdim">
        Best landing start each day over the selected range ({feasibleDays} feasible of{' '}
        {Math.max(0, hiDay - loDay + 1)}). Gray days admit no start that meets the enabled
        requirements; deeper green keeps more slack on the tightest constraint. Click a day to
        inspect its best start.
      </p>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-3">
        {months.map((m) => (
          <div key={m.label} className="min-w-[224px]">
            <div className="mb-1 text-[12px] font-semibold text-ink">{m.label}</div>
            <div className="grid grid-cols-[repeat(7,20px)] gap-[2px]" role="group" aria-label={m.label}>
              {WD.map((w, i) => (
                <span key={i} className="text-center text-[12px] leading-3 text-inkdim">{w}</span>
              ))}
              {m.cells.map((cell, i) =>
                cell === null ? (
                  <span key={`b${i}`} />
                ) : (
                  <button
                    key={cell.day}
                    onClick={() => cell.bestHour !== null && onPick(cell.day * 24 + cell.bestHour)}
                    title={cellLabel(startMs, cell)}
                    aria-label={cellLabel(startMs, cell)}
                    disabled={cell.bestHour === null}
                    className={
                      'h-[20px] w-[20px] rounded-[2px] border text-[10px] leading-none font-tabular transition-colors duration-150 ' +
                      (cell.bestHour === null
                        ? 'border-rule bg-paper3 text-inkdim/60'
                        : 'border-rule hover:border-ink')
                    }
                    style={
                      cell.bestHour !== null
                        ? { background: `color-mix(in srgb, var(--color-viable) ${Math.round(18 + 72 * ((cell.margin ?? 0) / maxMargin))}%, var(--color-paper))` }
                        : undefined
                    }
                  >
                    {new Date(startMs + cell.day * 24 * 3600_000).getUTCDate()}
                  </button>
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
