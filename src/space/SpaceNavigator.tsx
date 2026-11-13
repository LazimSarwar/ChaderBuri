import { useEffect, useState } from 'react'
import { ChevronDown, Orbit, Scan, SlidersHorizontal } from 'lucide-react'
import {
  AU_KM,
  loadSpace,
  positionsAt,
  UNIT_KM,
  type SpaceData,
  type SpaceOptions,
} from './ephemeris'

export function SpaceNavigator({
  focus,
  row,
  options,
  onOptions,
  onFly,
  onOverview,
  onAtlas,
  onSky,
  onEarthMoon,
  compact=false,
}: {
  focus: string
  row: number
  options: SpaceOptions
  onOptions: (o: SpaceOptions) => void
  onFly: (name: string) => void
  onOverview: () => void
  onAtlas: () => void
  onSky: () => void
  onEarthMoon: () => void
  compact?: boolean
}) {
  const [data, setData] = useState<SpaceData | null>(null),
    [settings, setSettings] = useState(false)
  // Load only what the focused body needs (cached, shared with the scene); the
  // dropdown lists the full catalog so any body stays pickable.
  useEffect(() => {
    loadSpace([focus])
      .then((d) => setData({ ...d }))
      .catch(() => {})
  }, [focus])
  const body = data?.bodies.find((b) => b.name === focus)
  const positions = data ? positionsAt(data, row) : null
  const fromEarth =
    body && positions
      ? positions.get(body.name)!.distanceTo(positions.get('Earth')!) * UNIT_KM
      : null
  return (
    <aside
      className={`space-navigator pointer-events-auto${compact?' compact':''}`}
      aria-label="Space navigation"
      data-expanded={settings}
    >
      <div className="space-nav-row">
        <label className="body-picker">
          <Orbit size={16} />
          <select
            aria-label="Explore a celestial body"
            value={body?.name ?? ''}
            onChange={(e) => onFly(e.target.value)}
          >
            {!body && <option value="">{focus}</option>}
            {(data?.catalog ?? data?.bodies ?? [{ name: 'Moon', parent: 'Earth' }]).map((b) => (
              <option key={b.name} value={b.name}>
                {b.parent && b.parent !== 'Sun' ? '↳ ' : ''}
                {b.name}
              </option>
            ))}
          </select>
          <ChevronDown size={12} />
        </label>
        <button
          onClick={onOverview}
          title="See the whole solar system"
          aria-label="Whole solar system"
        >
          <Scan size={17} /><span className="space-nav-label">Overview</span>
        </button>
        <button
          onClick={() => setSettings(!settings)}
          aria-expanded={settings}
          aria-label="Scene display options"
        >
          <SlidersHorizontal size={16} /><span className="space-nav-label">Controls</span>
        </button>
      </div>
      <div className="space-quick">
        <button onClick={() => onFly('Moon')}>Moon</button>
        <button onClick={() => onFly('Earth')}>Earth</button>
        <button onClick={() => onFly('Sun')}>Sun</button>
        <button onClick={onAtlas}>Lunar atlas ↗</button>
      </div>
      <div className="lunar-view-shortcuts">
        <button className="lunar-sky-button" onClick={onEarthMoon}>Earth–Moon system ↗</button>
        <button className="lunar-sky-button" onClick={onSky}>
          Earth from lunar orbit ↗
        </button>
      </div>
      <div className="space-toggle-row">
        {focus === 'Moon' && (
          <>
            <label className="orbit-toggle">
              <input
                type="checkbox"
                checked={options.inspectionLight}
                onChange={(e) =>
                  onOptions({ ...options, inspectionLight: e.target.checked })
                }
              />{' '}
              Inspect dark terrain
            </label>
            {options.inspectionLight && (
              <p className="text-[12px] leading-relaxed text-inkdim">
                Drag across the Moon to move a display light. Only dark facets
                brighten; mission sunlight and battery calculations stay
                unchanged.
              </p>
            )}
          </>
        )}
        <label className="orbit-toggle">
          <input
            type="checkbox"
            checked={options.orbits}
            onChange={(e) =>
              onOptions({ ...options, orbits: e.target.checked })
            }
          />
          Show orbits
        </label>
      </div>
      {settings && (
        <div className="space-settings">
          {(
            [
              ['names', 'Body names'],
              ['enhanced', 'Enlarge distant bodies'],
              ['deepSky', 'Brighter star field'],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(e) =>
                  onOptions({ ...options, [key]: e.target.checked })
                }
              />
              {label}
            </label>
          ))}
          <p>
            Distances stay to scale. Distant disks can be enlarged to remain
            clickable. Brighter star field adjusts a procedural backdrop;
            it is not a measured star catalog.
          </p>
          <p>
            Orbit guides are instantaneous ellipses. The scene uses geometric
            positions; site conditions include the separate terrain calculation.
          </p>
          <p>Orbital positions follow cached JPL predictions; spins follow NAIF orientations. One playback clock moves every body together. Faster playback changes the displayed UTC date.</p>
          <a href="/data/space/assets.json" target="_blank" rel="noreferrer">
            Texture sources & credits ↗
          </a>
        </div>
      )}
      {focus !== 'Moon' && (
        <div className="body-context">
          <p className="eyebrow">
            {focus === 'Earth–Moon system' ? 'Moon orbits Earth · Earth orbits the Sun' : focus === 'Lunar sky'
              ? 'Looking out from the Moon'
              : focus === 'Solar system'
                ? 'Our planetary neighbourhood'
                : body?.parent === 'Sun'
                  ? 'Orbiting the Sun'
                  : body?.parent
                    ? `Moon of ${body.parent}`
                    : 'Our star'}
          </p>
          <h2>{focus}</h2>
          {focus === 'Earth–Moon system' && <p>Earth stays at the centre of this tracking view while the Moon follows its dated orbit. Press Play to advance time at one simulated day per second. Distances stay linear; enlarged distant disks are labelled below.</p>}
          {focus === 'Lunar sky' && (
            <p>
              Near-side lunar vantage, initially 43 km above the reference
              sphere. A narrow camera lens reveals Earth at its true angular
              size. Drag to look around.
            </p>
          )}
          {body && (
            <dl>
              <div>
                <dt>Mean radius</dt>
                <dd>{Math.round(body.radiusKm).toLocaleString()} km</dd>
              </div>
              {!!fromEarth && (
                <div>
                  <dt>From Earth</dt>
                  <dd>
                    {fromEarth < 1e6
                      ? `${Math.round(fromEarth).toLocaleString()} km`
                      : `${(fromEarth / AU_KM).toFixed(2)} AU`}
                  </dd>
                </div>
              )}
            </dl>
          )}
          <p>
            {focus === 'Lunar sky'
              ? 'Drag to look around · scroll to change the lens'
              : 'Drag freely to orbit · scroll or pinch to zoom'}
          </p>
          {focus === 'Solar system' && (
            <p>
              Sun, eight planets and 12 selected moons. Choose a body to
              approach it.
            </p>
          )}
          {body && (
            <a
              href={`https://science.nasa.gov/${body.name === 'Sun' ? 'sun' : body.name === 'Moon' ? 'moon' : body.parent === 'Sun' ? body.name.toLowerCase() : body.parent!.toLowerCase() + '/moons'}/`}
              target="_blank"
              rel="noreferrer"
            >
              Explore NASA’s science ↗
            </a>
          )}
        </div>
      )}
      <div className="space-provenance">
        JPL / NAIF geometry ·{' '}
        {options.deepSky ? 'bright star field' : 'dim star field'}
        {options.enhanced ? ' · distant sizes enhanced' : ''}
      </div>
    </aside>
  )
}
