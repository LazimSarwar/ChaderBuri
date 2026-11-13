import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  buildSeries,
  evaluate,
  windowStats,
  type Constraints,
} from './architect/solver'
import type { Ephemeris, Horizon, Site } from './data'
import { parseRowT } from './lib/sim'

type Props = {
  sites: Site[]
  eph: Record<string, Record<'sun' | 'earth', Ephemeris>>
  horizons: Record<string, Horizon>
  currentSlug: string
  initialRow: number
  onOpenSite: (slug: string) => void
  onClose: () => void
  embedded?: boolean
}
export function ViabilityMap({
  sites,
  eph,
  horizons,
  currentSlug,
  initialRow,
  onOpenSite,
  onClose,
  embedded=false,
}: Props) {
  const panel = useRef<HTMLElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    if(!embedded)panel.current?.querySelector<HTMLElement>('button')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      if (event.key === 'Tab' && !embedded) {
        const items = Array.from(
          panel.current?.querySelectorAll<HTMLElement>(
            'button,input,[tabindex="0"]',
          ) ?? [],
        )
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault()
          items.at(-1)?.focus()
        } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
          event.preventDefault()
          items[0]?.focus()
        }
      }
    }
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('keydown', key)
      previous?.focus()
    }
  }, [])
  const [c, setC] = useState<Constraints>({
    missionDays: 14,
    minLitPct: 60,
    maxDarkH: 72,
    minLinkPct: 60,
    maxGapH: 72,
  })
  const [landing, setLanding] = useState(Math.floor(initialRow)),
    [selected, setSelected] = useState(currentSlug)
  const series = useMemo(
    () =>
      sites.map((s) =>
        buildSeries(
          s.slug,
          eph[s.slug].sun.rows,
          eph[s.slug].earth.rows,
          horizons[s.slug],
        ),
      ),
    [sites, eph, horizons],
  )
  const duration = Math.round(c.missionDays * 24),
    max = Math.min(...series.map((s) => s.hours)) - duration,
    start = Math.max(0, Math.min(landing, max))
  const ranked = sites
    .map((site, i) => ({
      site,
      index: i + 1,
      ev: evaluate(windowStats(series[i], start, start + duration), c),
    }))
    .sort((a, b) => b.ev.margin - a.ev.margin)
  const chosen = ranked.find((r) => r.site.slug === selected)!
  const epoch = parseRowT(eph[sites[0].slug].sun.rows[0].t).getTime()
  const date = new Date(epoch + start * 3600000)
    .toISOString()
    .slice(0, 16)
    .replace('T', ' ')
  return (
    <section
      ref={panel}
      className="workspace-modal atlas pointer-events-auto"
      role={embedded?'region':'dialog'}
      aria-modal={embedded?undefined:true}
      aria-label="Lunar south pole atlas"
    >
      <header className="workspace-heading flex items-center justify-between gap-3">
        <div>
          <p className="eyebrow">LRO / LOLA · terrain & mission windows</p>
          <h2>The south-pole atlas</h2>
        </div>
        <button
          className="tool-button"
          onClick={onClose}
          aria-label="Close atlas"
          data-panel-close
        >
          <X size={18} />
        </button>
      </header>
      <div className="atlas-layout">
        <div className="atlas-map-panel">
          <div className="atlas-map-title">
            <span>84°S — 90°S</span>
            <span>0°E ↑ · east clockwise</span>
          </div>
          <svg
            viewBox="0 0 640 640"
            role="group"
            aria-label="LOLA terrain map with numbered calculated landing sites"
          >
            <defs>
              <clipPath id="cap">
                <circle cx="320" cy="320" r="275" />
              </clipPath>
            </defs>
            <image
              href="/textures/polar_hillshade.png"
              x="45"
              y="45"
              width="550"
              height="550"
              clipPath="url(#cap)"
            />
            {[1, 2, 3].map((n) => (
              <g key={n}>
                <circle
                  cx="320"
                  cy="320"
                  r={(275 * n) / 3}
                  fill="none"
                  stroke="var(--color-edge2)"
                  strokeOpacity=".23"
                  strokeDasharray="3 6"
                />
                <text
                  x="326"
                  y={320 - (275 * n) / 3 + 15}
                  fill="var(--color-inkdim)"
                  fontSize="11"
                >
                  {90 - 2 * n}°S
                </text>
              </g>
            ))}
            {[0, 45, 90, 135, 180, 225, 270, 315].map((lon) => {
              const a = (lon * Math.PI) / 180
              return (
                <g key={lon}>
                  <line
                    x1="320"
                    y1="320"
                    x2={320 + 275 * Math.sin(a)}
                    y2={320 - 275 * Math.cos(a)}
                    stroke="var(--color-edge2)"
                    strokeOpacity=".18"
                  />
                  <text
                    x={320 + 302 * Math.sin(a)}
                    y={324 - 302 * Math.cos(a)}
                    textAnchor="middle"
                    fill="var(--color-inkdim)"
                    fontSize="11"
                  >
                    {lon}°
                  </text>
                </g>
              )
            })}
            <text
              x="320"
              y="339"
              textAnchor="middle"
              fill="var(--color-ink)"
              fontSize="11"
            >
              South pole
            </text>
            {ranked
              .filter((r) => r.site.lat <= -84)
              .map(({ site, index, ev }) => {
                const a = (site.lonEast * Math.PI) / 180,
                  r = ((site.lat + 90) / 6) * 275,
                  x = 320 + r * Math.sin(a),
                  y = 320 - r * Math.cos(a),
                  active = site.slug === selected
                return (
                  <g
                    key={site.slug}
                    role="button"
                    tabIndex={0}
                    aria-label={site.name}
                    onClick={() => setSelected(site.slug)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelected(site.slug)
                      }
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <title>
                      {site.name}:{' '}
                      {ev.pass
                        ? 'meets visibility thresholds'
                        : 'outside visibility thresholds'}
                    </title>
                    <circle
                      cx={x}
                      cy={y}
                      r={active ? 15 : 11}
                      fill={ev.pass ? 'var(--color-viable)' : 'var(--color-sun)'}
                      stroke={active ? 'white' : 'var(--color-ink)'}
                      strokeWidth={active ? 2 : 1}
                    />
                    <text
                      x={x}
                      y={y + 4}
                      textAnchor="middle"
                      fill="var(--color-paper)"
                      fontSize="11"
                      fontWeight="600"
                      pointerEvents="none"
                    >
                      {index}
                    </text>
                  </g>
                )
              })}
          </svg>
          <div className="atlas-legend">
            <span>
              <i style={{ background: 'var(--color-viable)' }} />
              Meets visibility limits
            </span>
            <span>
              <i style={{ background: 'var(--color-sun)' }} />
              Outside limits
            </span>
          </div>
          <p className="atlas-note">
            Azimuthal equidistant projection. Terrain relief uses illustrative
            northwest lighting. Marker results use hourly Sun/Earth geometry and
            terrain horizons. No predictions are interpolated between sites.
            IM-1 lies outside this map’s extent.
          </p>
        </div>
        <div className="atlas-data-panel">
          <div className="atlas-window">
            <label>
              Landing epoch <strong>{date} UTC</strong>
              <input
                aria-label="Atlas landing epoch"
                type="range"
                min={0}
                max={max}
                step={1}
                value={start}
                onChange={(e) => setLanding(+e.target.value)}
              />
            </label>
            <div className="atlas-inputs">
              {(
                [
                  ['missionDays', 'Duration (days)', 1, 90],
                  ['minLitPct', 'Min. sunlight (%)', 0, 100],
                  ['minLinkPct', 'Min. Earth link (%)', 0, 100],
                  ['maxDarkH', 'Max. darkness (h)', 0, 2160],
                  ['maxGapH', 'Max. link gap (h)', 0, 2160],
                ] as const
              ).map(([key, label, min, max]) => (
                <label key={key}>
                  {label}
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={c[key]}
                    onChange={(e) =>
                      setC((c) => ({
                        ...c,
                        [key]: Math.max(
                          min,
                          Math.min(max, Number(e.target.value) || min),
                        ),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="atlas-table-wrap">
            <table>
              <caption>
                Calculated sites · ranked by the tightest visibility margin
              </caption>
              <thead>
                <tr>
                  <th>Landing site</th>
                  <th>Sunlit</th>
                  <th>Earth</th>
                  <th>Longest dark</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ site, index, ev }) => (
                  <tr
                    key={site.slug}
                    className={selected === site.slug ? 'selected' : ''}
                  >
                    <th>
                      <button onClick={() => setSelected(site.slug)}>
                        <span
                          className="atlas-number"
                          style={{ color: ev.pass ? 'var(--color-viable)' : 'var(--color-sun)' }}
                        >
                          {index}
                        </span>
                        {site.name}
                      </button>
                    </th>
                    <td>{ev.litPct.toFixed(0)}%</td>
                    <td>{ev.linkPct.toFixed(0)}%</td>
                    <td>{ev.longestDarkH} h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="atlas-selection">
            <p className="eyebrow">
              Selected site ·{' '}
              {chosen.ev.pass
                ? 'visibility limits met'
                : 'visibility limits not met'}
            </p>
            <h3>{chosen.site.name}</h3>
            <p>
              {Math.abs(chosen.site.lat).toFixed(4)}°S ·{' '}
              {chosen.site.lonEast.toFixed(4)}°E · longest Earth-link gap{' '}
              {chosen.ev.longestGapH} h
            </p>
            <button
              className="primary-action"
              onClick={() => onOpenSite(selected)}
            >
              Explore this site <span>↗</span>
            </button>
            <p>
              Visibility screening only. Use Plan to test battery capacity and
              energy reserve.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
