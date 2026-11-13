import { referencePanelPower } from './lib/science'
import { useState } from 'react'
import { Loader2, Radar, RadioTower } from 'lucide-react'
import { eclipseFactor, horizonAt, sunVerdict, type Horizon, type Site } from './data'
import { DSN_MASK_DEG, dsnPasses } from './lib/dsn'
import { observeAt, snapshotMode } from './lib/horizons'

type ProbeOutcome = {
  fetchedUTC: string
  sunRadius?: number
  earthRadius?: number
  sunRange?: number
  epochUTC: string
  sunAz: number
  sunEl: number
  sunHz: number
  earthAz: number
  earthEl: number
  earthHz: number
  dsn: { name: string; elevDeg: number; ok: boolean }[]
}

/** Field probe: observe the selected supported site at ANY epoch by querying
 *  JPL Horizons live — including dates far outside the cached window — then
 *  run the same LOLA terrain-mask engine the rest of the app uses. The
 *  advisor brief's "any-epoch mode, narrow first version": supported sites
 *  only, one epoch at a time, provenance shown. */
export function FieldProbe({ site, horizon }: { site: Site; horizon: Horizon }) {
  const [when, setWhen] = useState(new Date().toISOString().slice(0, 16))
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProbeOutcome | null>(null)
  const [ranSite, setRanSite] = useState<string | null>(null)
  const [custom, setCustom] = useState(false)
  const [customLat, setCustomLat] = useState('')
  const [customLon, setCustomLon] = useState('')
  const customValid = custom && customLat !== '' && customLon !== '' && Math.abs(+customLat) <= 90 && Math.abs(+customLon) <= 180

  async function run() {
    if (!when) return
    const lat = custom ? +customLat : site.lat
    const lon = custom ? +customLon : site.lonEast
    const heightKm = custom ? 0 : horizon.siteHeightM / 1000
    setState('running')
    setError(null)
    const epochUTC = when.replace('T', ' ')
    try {
      // sequential + paced: Horizons throttles parallel bursts
      const sunRows = await observeAt('sun', lat, lon, epochUTC, heightKm)
      await new Promise((r) => setTimeout(r, 600))
      const earthRows = await observeAt('earth', lat, lon, epochUTC, heightKm)
      const s = sunRows[0]
      const e = earthRows[0]
      setResult({
        epochUTC, fetchedUTC: new Date().toISOString(), sunRadius: s.radiusDeg, earthRadius: e.radiusDeg, sunRange: s.rangeKm,
        sunAz: s.az,
        sunEl: s.el,
        sunHz: custom ? 0 : horizonAt(horizon, s.az),
        earthAz: e.az,
        earthEl: e.el,
        earthHz: custom ? 0 : horizonAt(horizon, e.az),
        dsn: dsnPasses(new Date(Date.parse(epochUTC.replace(' ', 'T') + 'Z'))),
      })
      setRanSite(custom ? `@${customLat},${customLon}` : site.slug)
      setState('done')
    } catch (err) {
      setError(String(err).slice(0, 160))
      setState('error')
    }
  }

  // stale result from a different site (or coordinates) than currently selected
  const ranLabel = ranSite ?? ''
  const stale = result !== null && (custom ? ranLabel !== `@${customLat},${customLon}` : ranLabel !== site.slug)
  const show = result !== null && !stale
  const verdict = show ? sunVerdict(result!.sunEl, result!.sunHz, result!.sunRadius) : null
  const lit = verdict !== null && verdict !== 'shadowed'
  const grazing = verdict === 'grazing'
  const dte = show ? result!.earthEl > result!.earthHz : false
  const eclipse = show && lit ? eclipseFactor(result!.sunAz, result!.sunEl, result!.earthAz, result!.earthEl, result!.sunRadius, result!.earthRadius) : 1
  const watts = show ? referencePanelPower({ az: result!.sunAz, el: result!.sunEl, radiusDeg: result!.sunRadius, rangeKm: result!.sunRange }, { az: result!.earthAz, el: result!.earthEl, radiusDeg: result!.earthRadius }, result!.sunHz) : 0
  const dsnUp = show ? result!.dsn.filter((d) => d.ok) : []
  const inCache = false // a probe is by definition outside the tabulated window view

  return (
    <div className="rounded-xl border border-violet-400/30 bg-violet-400/[0.04] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.18em] text-inkdim">
          <Radar className="h-3.5 w-3.5 text-violet-300" /> Query an epoch
        </span>
        {show && <span className="rounded bg-violet-400/15 px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.1em] text-violet-300">Fetched {result!.fetchedUTC.slice(11, 19)} UTC</span>}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-inkdim">
        Observe this site at any date — the browser queries JPL Horizons live and
        runs the same LOLA terrain mask. Works far outside the tabulated window.
        Or probe any custom coordinates.
      </p>
      <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-[12px] text-inkdim">
        <input
          type="checkbox"
          checked={custom}
          onChange={(e) => setCustom(e.target.checked)}
          className="h-3 w-3 accent-[var(--color-earth)]"
        />
        custom coordinates
      </label>
      {custom && (
        <div className="mt-1.5 flex gap-2">
          <input
            type="number"
            step="0.0001"
            min="-90"
            max="90"
            placeholder="latitude ° (−90…90)"
            value={customLat}
            onChange={(e) => setCustomLat(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-edge bg-paper2 px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-edge2"
            aria-label="Custom latitude (degrees, south negative)"
          />
          <input
            type="number"
            step="0.0001"
            min="-180"
            max="180"
            placeholder="longitude ° (E+ / W−)"
            value={customLon}
            onChange={(e) => setCustomLon(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-edge bg-paper2 px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-edge2"
            aria-label="Custom longitude (degrees east positive)"
          />
        </div>
      )}
      <div className="mt-2 flex gap-2">
        <input
          type="datetime-local"
          value={when}
          min="2000-01-01T00:00"
          max="2049-12-31T23:59"
          onChange={(e) => setWhen(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-edge bg-paper2 px-2 py-1 font-mono text-[12px] text-ink outline-none focus:border-edge2"
          aria-label="Probe epoch (UTC)"
        />
        <button
          onClick={run}
          disabled={!when || state === 'running' || (custom && !customValid)}
          className="flex shrink-0 items-center gap-1 rounded-md border border-earth/40 bg-earth/10 px-2.5 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-earth transition-colors duration-150 hover:bg-earth/20 disabled:opacity-40"
        >
          {state === 'running' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RadioTower className="h-3.5 w-3.5" />
          )}
          Probe
        </button>
        {snapshotMode() && (
          <span className="shrink-0 self-center rounded border border-edge px-1.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-inkdim" title="Demo mode: probes resolve from a recorded live fixture, not the network">
            Cached snapshot
          </span>
        )}
      </div>
      <p className="mt-1 font-mono text-[12px] text-inkdim/70">epoch is UTC · live source: ssd.jpl.nasa.gov (DE441)</p>

      {state === 'error' && (
        <p className="mt-2 rounded-lg border border-danger/40 bg-danger/[0.06] p-2 text-[12px] text-danger">
          Probe failed: {error}
        </p>
      )}
      {stale && (
        <p className="mt-2 text-[12px] text-inkdim">
          Showing {ranSite!.startsWith('@') ? `custom coordinates ${ranSite!.slice(1)}` : site.name} — the probe below was
          taken elsewhere. Run it again.
        </p>
      )}

      {show && (
        <div className="mt-3">
          <div className="font-mono text-[12px] text-ink">
            {result!.epochUTC.replace(' ', ' · ')} UT
            {inCache && <span className="ml-2 text-inkdim">· in cached window</span>}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-edge bg-panel2/60 p-2">
              <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.14em] text-inkdim">
                sun
                <span
                  className={
                    'rounded px-1 py-0.5 text-[12px] ' +
                    (verdict === 'lit'
                      ? 'bg-viable/15 text-viable'
                      : verdict === 'grazing'
                        ? 'bg-sun/15 text-sun'
                        : 'bg-danger/15 text-danger')
                  }
                >
                  {verdict ?? '—'}
                </span>
              </div>
              <div className="mt-1 font-mono text-[12px] text-ink font-tabular">
                {result!.sunAz.toFixed(1)}° az · {result!.sunEl.toFixed(2)}° el
              </div>
              <div className="text-[12px] text-inkdim">
                ridge {result!.sunHz.toFixed(1)}° ·{' '}
                {eclipse < 0.999
                  ? `lunar eclipse — ${Math.round((1 - eclipse) * 100)}% of the Sun covered`
                  : grazing
                    ? 'limb only — partial power'
                    : lit
                      ? `${Math.round(watts)} W/m²`
                      : 'no power'}
              </div>
            </div>
            <div className="rounded-lg border border-edge bg-panel2/60 p-2">
              <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.14em] text-inkdim">
                earth
                <span
                  className={
                    'rounded px-1 py-0.5 text-[12px] ' + (dte ? 'bg-viable/15 text-viable' : 'bg-danger/15 text-danger')
                  }
                >
                  {dte ? 'visible' : 'masked'}
                </span>
              </div>
              <div className="mt-1 font-mono text-[12px] text-ink font-tabular">
                {result!.earthAz.toFixed(1)}° az · {result!.earthEl.toFixed(2)}° el
              </div>
              <div className="text-[12px] text-inkdim">
                ridge {result!.earthHz.toFixed(1)}° ·{' '}
                {dte ? 'Earth centre visible' : 'Earth centre masked'}
              </div>
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-inkdim/80">
            {dsnUp.length > 0 ? (
              <>
                DSN: {dsnUp.length}/3 complexes in view (
                {dsnUp.map((d) => `${d.name} +${d.elevDeg.toFixed(0)}°`).join(', ')}, mask{' '}
                {DSN_MASK_DEG}°) ·{' '}
              </>
            ) : (
              <>DSN: no complex sees the Moon — geometry below the mask · </>
            )}
            provenance: az/el predicted on demand from JPL Horizons (DE441, observer
            query at{' '}
            {custom
              ? `${(+customLat).toFixed(4)}°, ${(((+customLon % 360) + 360) % 360).toFixed(4)}°E, 0 m datum height`
              : `${site.lat.toFixed(4)}°, ${(((site.lonEast % 360) + 360) % 360).toFixed(4)}°E, ${horizon.siteHeightM.toFixed(0)} m datum height`}
            ){custom
              ? ' · verdicts against the spherical limb (0° mask) — no LOLA terrain profile exists for custom coordinates, so terrain shadowing is NOT resolved and results are optimistic near ridge lines'
              : ` · verdicts from the cached LOLA horizon mask of ${site.name}`}
          </p>
        </div>
      )}
    </div>
  )
}
