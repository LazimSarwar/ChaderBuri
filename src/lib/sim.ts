const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

/** Parse a Horizons row timestamp: "2026-Nov-14 00:00" (UT). */
export function parseRowT(t: string): Date {
  const [d, hm] = t.split(' ')
  const [y, mon, day] = d.split('-')
  const [hh, mm] = hm.split(':')
  return new Date(Date.UTC(+y, MONTHS.indexOf(mon), +day, +hh, +mm))
}

/** Date for a fractional row index, given the first row's timestamp. */
export function rowToDate(startRowT: string, row: number, stepHours = 1): Date {
  return new Date(parseRowT(startRowT).getTime() + row * stepHours * 3600_000)
}

export function fmtUTC(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} UT`
}

export function fmtDayShort(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}

export function fmtClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

export type Speed = { label: string; value: number }

/** Sim-speed multipliers: 1× is real time (1 sim-second per second). */
export const SPEEDS: Speed[] = [
  { label: '1×', value: 1 },
  { label: '60×', value: 60 },
  { label: '600×', value: 600 },
  { label: '3600×', value: 3600 },
  { label: '6 hours/s', value: 21600 },
  { label: '1 day/s', value: 86400 },
  { label: '10 days/s', value: 864000 },
]

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export const lerp = (a: number, b: number, f: number) => a + (b - a) * f
