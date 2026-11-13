import { useMemo, useState } from 'react'
import type { Horizon } from './data'

// Surface-local semantic colours support light workspace panels and dark scene
// overlays without changing the horizon measurements.
const SUN = 'var(--color-sun)'
const EARTH = 'var(--color-earth)'
const SURFACE = 'var(--color-paper3)'
const TEXT_MUTED = 'var(--color-inkdim)'

const W = 312
const H = 190
const PAD = { top: 14, right: 12, bottom: 26, left: 30 }
const EL_MIN = -10
const EL_MAX = 30

const azTicks = [
  { az: 0, label: 'N' },
  { az: 90, label: 'E' },
  { az: 180, label: 'S' },
  { az: 270, label: 'W' },
  { az: 360, label: 'N' },
]

const elTicks = [-10, 0, 10, 20, 30]

type Marker = { az: number; el: number; name: string; color: string }

function x(az: number) {
  return PAD.left + (az / 360) * (W - PAD.left - PAD.right)
}
function y(el: number) {
  return PAD.top + (1 - (el - EL_MIN) / (EL_MAX - EL_MIN)) * (H - PAD.top - PAD.bottom)
}

export function SkyChart({
  horizon,
  sunAz,
  sunEl,
  earthAz,
  earthEl,
}: {
  horizon: Horizon
  sunAz: number
  sunEl: number
  earthAz: number
  earthEl: number
}) {
  const [hoverAz, setHoverAz] = useState<number | null>(null)

  const terrainPath = useMemo(() => {
    let d = `M ${x(0)} ${y(EL_MIN)}`
    for (let az = 0; az <= 360; az++) {
      const el = Math.min(horizon.profile[az % 360], EL_MAX)
      d += ` L ${x(az).toFixed(1)} ${y(Math.max(el, EL_MIN)).toFixed(1)}`
    }
    d += ` L ${x(360)} ${y(EL_MIN)} Z`
    return d
  }, [horizon])

  const markers: Marker[] = [
    { az: sunAz, el: sunEl, name: 'Sun', color: SUN },
    { az: earthAz, el: earthEl, name: 'Earth', color: EARTH },
  ]

  const hoverH = hoverAz !== null ? horizon.profile[((hoverAz % 360) + 360) % 360] : null

  return (
    <div className="sky-chart">
      <div className="relative select-none" style={{ touchAction: 'none' }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label={`Terrain horizon profile for ${horizon.site}: elevation versus azimuth, with current Sun and Earth positions`}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            const px = ((e.clientX - rect.left) / rect.width) * W
            const az = ((px - PAD.left) / (W - PAD.left - PAD.right)) * 360
            setHoverAz(az >= 0 && az <= 360 ? Math.round(az) : null)
          }}
          onMouseLeave={() => setHoverAz(null)}
        >
          {elTicks.map((t) => (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(t)}
                y2={y(t)}
                stroke={t === 0 ? 'var(--color-edge)' : 'var(--color-rule)'}
                strokeWidth={1}
              />
              <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end" fontSize={9} fill={TEXT_MUTED}>
                {t}°
              </text>
            </g>
          ))}
          {azTicks.map((t) => (
            <text
              key={t.az}
              x={x(t.az)}
              y={H - 8}
              textAnchor="middle"
              fontSize={9}
              fill={TEXT_MUTED}
            >
              {t.label}
            </text>
          ))}

          <path
            d={terrainPath}
            fill="var(--color-earth)"
            fillOpacity={0.35}
            stroke="var(--color-earth)"
            strokeWidth={1.1}
          />

          {hoverAz !== null && (
            <line
              x1={x(hoverAz)}
              x2={x(hoverAz)}
              y1={PAD.top}
              y2={H - PAD.bottom}
              stroke="var(--color-inkdim)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {markers.map((m) => {
            const mx = x(m.az)
            const my = y(Math.max(Math.min(m.el, EL_MAX), EL_MIN))
            const labelRight = mx < W * 0.72
            return (
              <g key={m.name}>
                <circle cx={mx} cy={my} r={5} fill={m.color} stroke={SURFACE} strokeWidth={2} />
                <text
                  x={labelRight ? mx + 8 : mx - 8}
                  y={my + 3}
                  textAnchor={labelRight ? 'start' : 'end'}
                  fontSize={10}
                  fill="var(--color-ink)"
                  fontWeight={600}
                >
                  {m.name}
                </text>
              </g>
            )
          })}

          <text x={PAD.left} y={PAD.top - 4} fontSize={9} fill={TEXT_MUTED}>
            elevation (deg above local horizon)
          </text>
        </svg>

        {hoverAz !== null && hoverH !== null && (
          <div
            className="pointer-events-none absolute rounded border border-edge bg-panel px-2 py-1 font-mono text-[12px] text-ink"
            style={{
              left: `${(x(hoverAz) / W) * 100}%`,
              top: 0,
              transform:
                hoverAz > 280 ? 'translateX(-105%)' : hoverAz < 80 ? 'translateX(5%)' : 'translateX(-50%)',
            }}
          >
            az {((hoverAz % 360) + 360) % 360}° · terrain {hoverH.toFixed(1)}°
          </div>
        )}
      </div>

      <div className="mt-1 flex items-center gap-3 text-[12px] text-inkdim">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: SUN }} /> Sun
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: EARTH }} /> Earth
        </span>
        <span className="flex items-center gap-1">
          <svg width="12" height="8">
            <rect x="0" y="1" width="12" height="6" fill="var(--color-earth)" fillOpacity={0.5} />
          </svg>
          terrain
        </span>
      </div>

      <details className="mt-1.5">
        <summary className="cursor-pointer text-[12px] text-inkdim hover:text-ink">
          View horizon as table
        </summary>
        <div className="mt-1 max-h-28 overflow-y-auto rounded border border-edge">
          <table className="w-full font-mono text-[12px]">
            <thead className="sticky top-0 bg-panel2 text-inkdim">
              <tr>
                <th className="px-2 py-0.5 text-left font-normal">azimuth</th>
                <th className="px-2 py-0.5 text-right font-normal">terrain el</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 24 }, (_, i) => i * 15).map((az) => (
                <tr key={az} className="border-t border-edge/60 text-ink">
                  <td className="px-2 py-0.5">{az}°</td>
                  <td className="px-2 py-0.5 text-right">{horizon.profile[az].toFixed(1)}°</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
