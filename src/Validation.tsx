import { useState } from 'react'
import { ArrowLeft, Check, FlaskConical, Loader2, RadioTower, X } from 'lucide-react'
import { horizonAt, type Duty, type Ephemeris, type Horizon, type Mission, type Site } from './data'
import { horizonsUTC, observeAt } from './lib/horizons'
import { missionLanded } from './data'
import { angularSep } from './data'

type EphPair = { sun: Ephemeris; earth: Ephemeris }

type ValidationProps = {
  sites: Site[]
  missions: Mission[]
  eph: Record<string, EphPair>
  horizons: Record<string, Horizon>
  duty: Record<string, Duty>
  onBack: () => void
  backLabel?: string
}

/** In-browser re-derivation of the duty-cycle statistics straight from the
 *  raw Horizons rows and the LOLA horizon mask. Independent of whatever wrote
 *  the cached duty JSON — if these differ, the pipeline is broken. */
function rederive(eph: EphPair, horizon: Horizon) {
  let lit = 0
  let link = 0
  let darkRun = 0
  let darkMax = 0
  let litRun = 0
  let litMax = 0
  const rows = eph.sun.rows
  for (let i = 0; i < rows.length - 1; i++) {
    const s = rows[i]
    const e = eph.earth.rows[i]
    const L = s.el > horizonAt(horizon, s.az)
    const E = e.el > horizonAt(horizon, e.az)
    if (L) lit++
    if (E) link++
    litRun = L ? litRun + 1 : 0
    litMax = Math.max(litMax, litRun)
    darkRun = L ? 0 : darkRun + 1
    darkMax = Math.max(darkMax, darkRun)
  }
  return {
    hours: rows.length - 1,
    litPct: (lit / (rows.length - 1)) * 100,
    linkPct: (link / (rows.length - 1)) * 100,
    longestLitH: litMax,
    longestDarkH: darkMax,
  }
}

function Verdict({ ok }: { ok: boolean }) {
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] ' +
        (ok ? 'bg-viable/15 text-viable' : 'bg-danger/15 text-danger')
      }
    >
      {ok ? <Check className="h-3 w-3" strokeWidth={3} /> : <X className="h-3 w-3" strokeWidth={3} />}
      {ok ? 'pass' : 'fail'}
    </span>
  )
}

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
        <span className="font-mono text-[12px] text-sun">{n}</span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

type LiveCheck = {
  label: string
  sub: string
  cachedAz: number | null
  cachedEl: number | null
  liveAz: number
  liveEl: number
  /** arc-angle between cached and live direction, degrees (null if no cached value) */
  deltaDeg: number | null
  ok: boolean
}

const MON_NUM: Record<string, string> = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
}

type MissionTest = {
  name: string
  epochUTC: string
  lat: number
  lonEast: number
  /** what actually happened, from published/observed reporting */
  reference: string
  source: string
  /** Chader Buri's live prediction, phrased as a check */
  kind:
    | { type: 'sunlit'; minEl: number } // landed in daylight: sun elevation >= minEl
    | { type: 'lowSun'; maxEl: number } // grazing/low-sun landing
    | { type: 'eclipse'; maxSep: number } // Sun-Earth separation seen from the Moon
}

const MISSION_TESTS: { test: MissionTest; observed: string }[] = [
  {
    test: {
      name: 'IM-1 Odysseus — landed in sunlight',
      epochUTC: '2024-02-22 23:23',
      lat: -80.3,
      lonEast: 1.3,
      reference: 'Touched down near Malapert A in daylight; the solar array generated power on the surface.',
      source: 'Intuitive Machines IM-1 mission updates; NASA CLPS',
      kind: { type: 'sunlit', minEl: 5 },
    },
    observed: 'Sun up, generating power',
  },
  {
    test: {
      name: 'IM-2 Athena — grazing-sun landing',
      epochUTC: '2025-03-06 17:30',
      lat: -84.7906,
      lonEast: 29.1957,
      reference: 'Tipped over on touchdown; operated ~13 h on battery. Low Sun is a geometry check; panel orientation and thermal effects are not reconstructed.',
      source: 'Intuitive Machines IM-2 updates; LROC landing-region imagery',
      kind: { type: 'lowSun', maxEl: 5 },
    },
    observed: 'Low grazing sun',
  },
  {
    test: {
      name: 'Blue Ghost 1 — landed just after local sunrise',
      epochUTC: '2025-03-02 08:35',
      lat: 18.56,
      lonEast: 61.81,
      reference: 'Deliberately scheduled just after local sunrise at Mons Latreille; operated a full lunar day.',
      source: 'Firefly Aerospace mission updates; NASA press kit',
      kind: { type: 'lowSun', maxEl: 10 },
    },
    observed: 'Sun recently risen',
  },
  {
    test: {
      name: 'Total lunar eclipse — Sun eclipsed by Earth',
      epochUTC: '2025-03-14 06:58',
      lat: -89.936,
      lonEast: 222.4923,
      reference: 'Total lunar eclipse, maximum 06:58 UT: from the Moon, the Earth crosses the Sun.',
      source: 'NASA lunar eclipse catalog (2025 Mar 13–14)',
      kind: { type: 'eclipse', maxSep: 0.75 },
    },
    observed: 'Sun–Earth separation < 0.75° (umbra)',
  },
]

/** cached row timestamp "2026-Sep-01 00:00" -> Horizons "2026-09-01 00:00" */
function toHorizonsTime(cachedT: string): string {
  const [year, mon, day, hm] = cachedT.split(/[- ]/)
  return `${year}-${MON_NUM[mon] ?? '01'}-${day} ${hm}`
}

function arcDeg(az1: number, el1: number, az2: number, el2: number): number {
  const r = Math.PI / 180
  const c =
    Math.sin(el1 * r) * Math.sin(el2 * r) +
    Math.cos(el1 * r) * Math.cos(el2 * r) * Math.cos((az1 - az2) * r)
  return Math.acos(Math.min(1, Math.max(-1, c))) / r
}

type MissionResult = {
  name: string
  reference: string
  source: string
  predicted: string
  detail: string
  tolerance: string
  ok: boolean
}

/** Real-mission validation: for each flown event, the published observation,
 *  Chader Buri's live Horizons prediction, the difference, and the tolerance —
 *  computed in the browser at run time. Nothing here is a stored number. */
function MissionValidation() {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [results, setResults] = useState<MissionResult[]>([])
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setState('running')
    setError(null)
    setResults([])
    const out: MissionResult[] = []
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    try {
      for (const { test } of MISSION_TESTS) {
        const epoch = test.epochUTC
        const sunRows = await observeAt('sun', test.lat, test.lonEast, epoch)
        const sun = sunRows[0]
        let predicted = ''
        let detail = ''
        let tolerance = ''
        let ok = false
        if (test.kind.type === 'sunlit') {
          predicted = `sun elevation +${sun.el.toFixed(2)}° at the landing site`
          detail = 'above the local horizontal; terrain obstruction not tested here'
          tolerance = `elevation ≥ +${test.kind.minEl}°`
          ok = sun.el >= test.kind.minEl
        } else if (test.kind.type === 'lowSun') {
          predicted = `sun elevation +${sun.el.toFixed(2)}° at the landing site`
          detail = sun.el > 0 ? 'low sun — just risen / grazing' : 'below horizon'
          tolerance = `0° < elevation ≤ +${test.kind.maxEl}°`
          ok = sun.el > 0 && sun.el <= test.kind.maxEl
        } else {
          const earthRows = await observeAt('earth', test.lat, test.lonEast, epoch)
          const sep = angularSep(sun.az, sun.el, earthRows[0].az, earthRows[0].el)
          predicted = `Sun–Earth separation ${sep.toFixed(3)}° as seen from the Moon`
          detail = 'Earth crossing the solar disc (eclipse in progress)'
          tolerance = `separation ≤ ${test.kind.maxSep}° (Moon inside umbra)`
          ok = sep <= test.kind.maxSep
        }
        out.push({ name: test.name, reference: test.reference, source: test.source, predicted, detail, tolerance, ok })
        setResults([...out])
        await wait(700)
      }
      setState('done')
    } catch (e) {
      setError(String(e).slice(0, 160))
      setState(out.length > 0 ? 'done' : 'error')
    }
  }

  const passing = results.filter((r) => r.ok).length
  const allOk = results.length > 0 && passing === results.length

  return (
    <div className="rounded-xl border border-edge bg-panel/60 p-4">
      <p className="max-w-3xl text-[12px] leading-relaxed text-inkdim">
        Four qualitative geometry checks against reported mission conditions. Each row
        shows the published observation, Chader Buri's prediction queried live
        from JPL Horizons at run time, and the tolerance the check accepts.
        These live checks share the cache source. They do not independently validate terrain, electrical power, or mission failure causes.
      </p>
      <button
        onClick={run}
        disabled={state === 'running'}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-sun/50 bg-sun/10 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-sun transition-colors duration-150 hover:bg-sun/20 disabled:opacity-50"
      >
        {state === 'running' ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Re-deriving predictions…
          </>
        ) : (
          <>
            <RadioTower className="h-3.5 w-3.5" /> Run geometry checks
          </>
        )}
      </button>

      {state === 'error' && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/[0.06] p-3 text-[12px] text-danger">
          Live query failed: {error}
        </p>
      )}

      <ol className="mt-3 space-y-2">
        {MISSION_TESTS.map(({ test }, i) => {
          const r = results[i]
          return (
            <li key={test.name} className="rounded-lg border border-edge bg-panel2/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-ink">{test.name}</span>
                {r ? <Verdict ok={r.ok} /> : <span className="font-mono text-[12px] text-inkdim/60">{test.epochUTC} UT</span>}
              </div>
              <div className="mt-1.5 grid gap-x-6 gap-y-1 text-[12px] leading-relaxed md:grid-cols-2">
                <span className="text-inkdim">
                  <span className="font-semibold uppercase tracking-[0.1em] text-ink/70">observed: </span>
                  {test.reference}{' '}
                  <span className="text-inkdim/70">({test.source})</span>
                </span>
                {r ? (
                  <span className="text-ink">
                    <span className="font-semibold uppercase tracking-[0.1em] text-ink/70">Chader Buri predicts: </span>
                    {r.predicted} — {r.detail}. tolerance: {r.tolerance}.
                  </span>
                ) : (
                  <span className="text-inkdim/60">prediction pending live run…</span>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      {state === 'done' && results.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <Verdict ok={allOk} />
          <span className="text-inkdim">
            {allOk
              ? `${passing}/${results.length} flown-mission checks match — predictions re-derived live, never stored`
              : `${results.length - passing} of ${results.length} checks disagree — investigate before trusting`}
          </span>
        </div>
      )}
    </div>
  )
}

/** Live cross-check: the browser queries JPL Horizons right now and diffs
 *  NASA's answer against Chader Buri's cached files — including epochs far
 *  outside the cached window (the 2024/2025 touchdowns). Zero local
 *  computation is involved in the "live" column: it is NASA's answer,
 *  verbatim, from their public API. */function LiveCrossCheck({
  sites,
  missions,
  spotSite,
  spotEpochs,
  heightKm,
}: {
  sites: Site[]
  missions: Mission[]
  spotSite: string
  heightKm: number
  spotEpochs: { t: string; az: number; el: number }[]
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [checks, setChecks] = useState<LiveCheck[]>([])
  const [ms, setMs] = useState<number | null>(null)

  const anchor = sites.find((s) => s.slug === spotSite) ?? sites[0]

  async function run() {
    setState('running')
    setError(null)
    setChecks([])
    const t0 = performance.now()
    const out: LiveCheck[] = []
    // Horizons throttles rapid-fire queries (the data pipeline sleeps between
    // calls too); pace these politely and keep whatever succeeds
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    let firstError: string | null = null
    try {
      // 1) the three cached spot epochs, re-observed live at the anchor site
      for (const ep of spotEpochs) {
        const rows = await observeAt('sun', anchor.lat, anchor.lonEast, toHorizonsTime(ep.t), heightKm)
        const live = rows[0]
        const delta = arcDeg(ep.az, ep.el, live.az, live.el)
        out.push({
          label: 'Cached epoch, re-observed live',
          sub: `${anchor.name} · ${ep.t} UT`,
          cachedAz: ep.az,
          cachedEl: ep.el,
          liveAz: live.az,
          liveEl: live.el,
          deltaDeg: delta,
          ok: delta <= 0.1,
        })
        setChecks([...out])
        await wait(700)
      }
      // 2) flown touchdowns — epochs the cached window doesn't cover at all
      for (const m of missions) {
        if (!missionLanded(m) || !m.sunAtTouchdown || m.lat === null || m.lonEast === null || !m.landingUTC)
          continue
        const epoch = m.landingUTC.slice(0, 16).replace('T', ' ')
        try {
          const rows = await observeAt('sun', m.lat, m.lonEast, horizonsUTC(new Date(Date.parse(m.landingUTC))))
          const live = rows[0]
          const cached = m.sunAtTouchdown
          const delta = arcDeg(cached.az, cached.el, live.az, live.el)
          out.push({
            label: `${m.name} · touchdown, observed live`,
            sub: `${epoch} UT · ${Math.abs(m.lat).toFixed(2)}°${m.lat < 0 ? 'S' : 'N'} ${Math.abs(m.lonEast).toFixed(2)}°${m.lonEast < 0 ? 'W' : 'E'} — outside the cached window`,
            cachedAz: cached.az,
            cachedEl: cached.el,
            liveAz: live.az,
            liveEl: live.el,
            deltaDeg: delta,
            ok: delta <= 0.25,
          })
        } catch (e) {
          firstError = `${m.name}: ${String(e).slice(0, 120)}`
        }
        setChecks([...out])
        await wait(700)
      }
      setMs(performance.now() - t0)
      setState(out.length > 0 ? 'done' : 'error')
      if (out.length === 0 && firstError) setError(firstError)
    } catch (e) {
      firstError = String(e)
      if (out.length > 0) {
        setChecks(out)
        setMs(performance.now() - t0)
        setState('done')
        setError(firstError)
      } else {
        setError(firstError)
        setState('error')
      }
    }
  }

  const passing = checks.filter((c) => c.ok).length
  const allOk = checks.length > 0 && passing === checks.length

  return (
    <div className="rounded-xl border border-edge bg-panel/60 p-4">
      <p className="max-w-2xl text-[12px] leading-relaxed text-inkdim">
        This check phones home. The browser sends observer queries to JPL
        Horizons' public API — the same live NASA service that fed the data
        pipeline — and diffs the answers against Chader Buri's cached files,
        including the 2024/2025 touchdowns that lie far outside the cached
        window. The live column is NASA's answer, verbatim.
      </p>
      <button
        onClick={run}
        disabled={state === 'running'}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-sun/50 bg-sun/10 px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-sun transition-colors duration-150 hover:bg-sun/20 disabled:opacity-50"
      >
        {state === 'running' ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Querying Horizons…
          </>
        ) : (
          <>
            <RadioTower className="h-3.5 w-3.5" /> Run live cross-check
          </>
        )}
      </button>

      {state === 'error' && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/[0.06] p-3 text-[12px] text-danger">
          Live query failed: {error}. The offline checks above still stand —
          this page needs network access to reach ssd.jpl.nasa.gov.
        </p>
      )}

      {checks.length > 0 && (
        <table className="mt-3 w-full font-mono text-[12px]">
          <thead>
            <tr className="border-b border-edge text-left text-[12px] uppercase tracking-[0.14em] text-inkdim">
              <th className="py-1.5 pr-2">Observation</th>
              <th className="pr-2 text-right">Cached az / el</th>
              <th className="pr-2 text-right">Live az / el</th>
              <th className="pr-2 text-right">Δ</th>
              <th className="text-right">Verdict</th>
            </tr>
          </thead>
          <tbody className="font-tabular">
            {checks.map((c, i) => (
              <tr key={i} className="border-b border-edge/50 align-top">
                <td className="py-1.5 pr-2">
                  <div className="text-ink/90">{c.label}</div>
                  <div className="text-[12px] text-inkdim">{c.sub}</div>
                </td>
                <td className="pr-2 text-right text-inkdim">
                  {c.cachedAz === null ? '—' : `${c.cachedAz.toFixed(2)}° / ${c.cachedEl!.toFixed(2)}°`}
                </td>
                <td className="pr-2 text-right text-ink">
                  {c.liveAz.toFixed(2)}° / {c.liveEl.toFixed(2)}°
                </td>
                <td className="pr-2 text-right text-inkdim">
                  {c.deltaDeg === null ? '—' : `${c.deltaDeg.toFixed(3)}°`}
                </td>
                <td className="text-right">
                  <Verdict ok={c.ok} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {state === 'done' && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
          <Verdict ok={allOk} />
          <span className="text-inkdim">
            {allOk
              ? `${passing}/${checks.length} live observations match the cached pipeline · ${ms!.toFixed(0)} ms`
              : `${checks.length - passing} of ${checks.length} live observations disagree — investigate`}
            <span className="ml-2 text-inkdim/70">
              (live data: ssd.jpl.nasa.gov, DE441, queried {new Date().toISOString().slice(0, 16)}Z)
            </span>
          </span>
        </div>
      )}
    </div>
  )
}

export function Validation({ sites, missions, eph, horizons, duty, onBack, backLabel='Back to the Moon' }: ValidationProps) {  const flown = missions.filter(missionLanded)
  const siteBySlug = new Map(sites.map((s) => [s.slug, s]))

  // runtime re-derivation vs cached duty JSON
  const rederived = sites.map((s) => {
    const pair = eph[s.slug]
    const got = rederive(pair, horizons[s.slug])
    const cached = duty[s.slug]
    const near = (a: number, b: number, tol = 0.15) => Math.abs(a - b) <= tol
    return {
      site: s,
      cached,
      got,
      ok:
        cached &&
        near(got.litPct, cached.litPct) &&
        near(got.linkPct, cached.linkPct) &&
        near(got.longestDarkH, cached.longestDarkH, 2) &&
        near(got.longestLitH, cached.longestLitH, 2),
    }
  })
  const allPass = rederived.every((r) => r.ok)

  // bowl test: the floor of Shackleton must be materially darker than its rim
  const rim = duty['shackleton-rim']
  const floor = duty['shackleton-floor']
  const bowlOk = !!(rim && floor && floor.litPct < rim.litPct - 5)

  // Horizons spot checks: three epochs, verbatim cached values
  const spotSite = eph['shackleton-rim'] ? 'shackleton-rim' : sites[0].slug
  const sunRows = eph[spotSite].sun.rows
  const spotIdx = [0, Math.floor(sunRows.length / 2), sunRows.length - 1]

  return (
    <div className="h-full overflow-y-auto bg-paper">
      <div className="mx-auto max-w-4xl px-5 py-8">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-md border border-edge px-2.5 py-1.5 text-[12px] font-semibold uppercase tracking-[0.14em] text-inkdim transition-colors duration-150 hover:border-edge2 hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {backLabel}
        </button>

        <h1 className="mt-5 flex items-center gap-2.5 font-display text-2xl font-bold text-ink">
          <FlaskConical className="h-6 w-6 text-sun" />
          Validation
        </h1>
        <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-inkdim">
          Every number in Chader Buri is traced to a cited source — JPL Horizons
          (DE441) for Sun and Earth geometry, NASA LRO LOLA GDR for terrain and
          horizon masks. This page re-derives what it can <em>in your browser,
          right now</em>, so you don't have to trust a screenshot.
        </p>

        <p className="mt-3 rounded-xl border border-sun/30 bg-sun/5 p-3 text-[12px] text-inkdim">These are internal consistency and qualitative geometry checks. Sources & methods contains the completed regional 100-clone comparisons, actual ten-minute source probes and their limits. The regional 1 m residual remains unresolved, and these checks do not establish accuracy at every site. Power and optional single-node thermal results are screening estimates, not flight qualification.</p>
        <Section n="01" title="Touchdown geometry — flown CLPS missions">
          <div className="space-y-3">
            {flown.map((m) => {
              const s = m.siteSlug ? siteBySlug.get(m.siteSlug) : null
              const hz = m.siteSlug ? horizons[m.siteSlug] : null
              const sun = m.sunAtTouchdown
              const litNow = sun && hz ? sun.el > horizonAt(hz, sun.az) : null
              return (
                <div key={m.name} className="rounded-xl border border-edge bg-panel/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-display text-[14px] font-semibold text-ink">{m.name}</span>
                    <span className="rounded bg-sun/10 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-sun/90">
                      {m.provider}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-[12px] sm:grid-cols-4">
                    <div>
                      <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Touchdown</div>
                      <div className="text-ink font-tabular">{m.landingUTC?.slice(0, 16).replace('T', ' ')} UT</div>
                    </div>
                    <div>
                      <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Coordinates</div>
                      <div className="text-ink font-tabular">
                        {m.lat !== null && m.lonEast !== null
                          ? `${m.lat.toFixed(2)}° ${m.lonEast.toFixed(2)}°E`
                          : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Engine · sun at touchdown</div>
                      <div className="text-ink font-tabular">
                        {sun ? `${sun.az.toFixed(1)}° az · ${sun.el.toFixed(1)}° el` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">LOLA horizon verdict</div>
                      <div>
                        {litNow === null ? (
                          <span className="text-inkdim">site outside cached set</span>
                        ) : (
                          <Verdict ok={litNow} />
                        )}
                      </div>
                    </div>
                  </div>
                  {s && (
                    <div className="mt-2 text-[12px] text-inkdim">
                      compared with the cached horizon mask of{' '}
                      <span className="text-ink/80">{s.name}</span>
                    </div>
                  )}
                  <p className="mt-2 text-[12px] leading-relaxed text-ink/85">{m.note}</p>
                  <p className="mt-1 text-[12px] italic text-inkdim">Sources: {m.sources}</p>
                </div>
              )
            })}
          </div>
        </Section>

        <Section n="02" title="Duty cycles re-derived in your browser vs published values">
          <p className="text-[12px] leading-relaxed text-inkdim">
            The table below recomputes every site's illumination and Earth-link
            statistics from the raw hourly Horizons rows and the LOLA horizon
            mask, then diffs them against the published duty-cycle files. If a
            row fails, the pipeline is broken — the app should not be trusted.
          </p>
          <table className="mt-3 w-full font-mono text-[12px]">
            <thead>
              <tr className="border-b border-edge text-left text-[12px] uppercase tracking-[0.14em] text-inkdim">
                <th className="py-1.5 pr-2">Site</th>
                <th className="pr-2 text-right">Lit % cached</th>
                <th className="pr-2 text-right">re-derived</th>
                <th className="pr-2 text-right">Link % cached</th>
                <th className="pr-2 text-right">re-derived</th>
                <th className="pr-2 text-right">Longest dark</th>
                <th className="text-right">Verdict</th>
              </tr>
            </thead>
            <tbody className="font-tabular">
              {rederived.map((r) => (
                <tr key={r.site.slug} className="border-b border-edge/50">
                  <td className="py-1.5 pr-2 text-ink/90">{r.site.name}</td>
                  <td className="pr-2 text-right text-inkdim">{r.cached?.litPct.toFixed(1)}</td>
                  <td className="pr-2 text-right text-ink">{r.got.litPct.toFixed(1)}</td>
                  <td className="pr-2 text-right text-inkdim">{r.cached?.linkPct.toFixed(1)}</td>
                  <td className="pr-2 text-right text-ink">{r.got.linkPct.toFixed(1)}</td>
                  <td className="pr-2 text-right text-inkdim">{r.cached?.longestDarkH} h</td>
                  <td className="text-right">
                    <Verdict ok={!!r.ok} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            <Verdict ok={allPass} />
            <span className="text-inkdim">
              {allPass
                ? `all ${rederived.length} sites match (tolerance 0.15 pts / 2 h)`
                : 'mismatch — investigate before trusting the analysis'}
            </span>
          </div>
        </Section>

        <Section n="03" title="Bowl test — Shackleton rim vs floor">
          {rim && floor ? (
            <div className="rounded-xl border border-edge bg-panel/60 p-4">
              <div className="grid grid-cols-2 gap-6 font-mono text-[12px] sm:grid-cols-4">
                <div>
                  <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Rim crest · lit</div>
                  <div className="text-ink font-tabular">{rim.litPct.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Bowl floor · lit</div>
                  <div className="text-ink font-tabular">{floor.litPct.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Drop</div>
                  <div className="text-ink font-tabular">{(rim.litPct - floor.litPct).toFixed(1)} pts</div>
                </div>
                <div>
                  <div className="text-[12px] uppercase tracking-[0.16em] text-inkdim">Verdict</div>
                  <Verdict ok={bowlOk} />
                </div>
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-inkdim">
                The floor of a polar crater must be materially darker than its
                rim crest — the rim sees over the terrain to the horizon while
                the bowl does not. A physics check: if the engine ever lights
                the bowl, its terrain masking is wrong.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-inkdim">Shackleton pair not in cached set.</p>
          )}
        </Section>

        <Section n="04" title="Horizons spot checks — reproduce these numbers">
          <p className="text-[12px] leading-relaxed text-inkdim">
            Three epochs from the cached series, verbatim. To reproduce: JPL
            Horizons (<span className="text-ink/80">ssd.jpl.nasa.gov/horizons</span>),
            ephemeris type <span className="text-ink/80">OBSERVER</span>, target{' '}
            <span className="text-ink/80">Sun [10]</span>, site coordinate{' '}
            <span className="text-ink/80">
              {(() => {
                const s = siteBySlug.get(spotSite)
                return s ? `${s.lat.toFixed(4)}, ${s.lonEast.toFixed(4)}` : ''
              })()}
            </span>{' '}
            (lat, lon-east, geodetic, Moon IAU_{''}SROSS / DE441), quantities 4
            (az/el), 1-hour steps. Values must match to rounding.
          </p>
          <table className="mt-3 w-full font-mono text-[12px]">
            <thead>
              <tr className="border-b border-edge text-left text-[12px] uppercase tracking-[0.14em] text-inkdim">
                <th className="py-1.5 pr-2">Epoch (UTC)</th>
                <th className="pr-2 text-right">Sun az</th>
                <th className="text-right">Sun el</th>
              </tr>
            </thead>
            <tbody className="font-tabular">
              {spotIdx.map((i) => {
                const r = sunRows[i]
                return (
                  <tr key={r.t} className="border-b border-edge/50">
                    <td className="py-1.5 pr-2 text-ink/90">{r.t}</td>
                    <td className="pr-2 text-right text-ink">{r.az.toFixed(3)}°</td>
                    <td className="text-right text-ink">{r.el.toFixed(3)}°</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>

        <Section n="05" title="Live cross-check — queried from JPL Horizons, right now">
          <LiveCrossCheck
            sites={sites}
            missions={missions}
            spotSite={spotSite}
            heightKm={eph[spotSite].sun.provenance?.observer.heightKm ?? 0}
            spotEpochs={spotIdx.map((i) => sunRows[i])}
          />
        </Section>

        <Section n="06" title="Mission geometry consistency — live source checks">
          <MissionValidation />
        </Section>

        <p className="mt-10 border-t border-edge pt-4 text-[12px] leading-relaxed text-inkdim">
          Ephemeris NASA/JPL Horizons (DE441) · Terrain NASA LRO LOLA GDR V2.0,
          horizons marched to 160 km · Coordinates approximate until verified
          against published lander positions · Limits shown in the Mission
          Architect are user-set, not NASA requirements.
        </p>
      </div>
    </div>
  )
}
