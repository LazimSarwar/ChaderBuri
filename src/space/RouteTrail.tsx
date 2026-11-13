import { useEffect, useMemo, useRef } from 'react'
import { useThree } from '@react-three/fiber'
import * as T from 'three'
import { useSurfaceFrame } from './useSurfaceFrame'
import { overlaySampler, usePreRender, type OverlaySampler } from './overlayShared'
import { LUNAR_RADIUS_M } from './terrain'
import type { Runtime, SimClock } from './SpaceScene'
import type { BodyData } from './ephemeris'

/** Instrument overlay on the loaded DEM, not a physical track or a certified traversable corridor. */
export function RouteTrail({ runtime, clock, moon, points }: { runtime: Runtime; clock: React.RefObject<SimClock>; moon: BodyData; points: { eastM: number; northM: number }[] }) {
  const root = useSurfaceFrame(runtime, clock, moon, 0, 0), invalidate = useThree(s => s.invalidate)
  const sampler = useRef<OverlaySampler | null>(null), key = useRef('')
  const geometry = useMemo(() => new T.BufferGeometry(), []), material = useMemo(() => new T.LineBasicMaterial({ color: '#80dcf6', transparent: true, opacity: .55, depthWrite: false, toneMapped: false }), [])
  useEffect(() => { key.current = ''; invalidate() }, [points, invalidate])
  useEffect(() => () => { geometry.dispose(); material.dispose() }, [geometry, material])
  usePreRender(() => {
    sampler.current = overlaySampler(runtime, sampler.current)
    const s = sampler.current
    if (!s || !root.current?.visible) return
    const next = s.key + '|' + points.map(p => `${p.eastM}/${p.northM}`).join(',')
    if (next === key.current) return
    key.current = next
    const origin = s.sample(0, 0)
    if (origin === null) return
    const vertices: number[] = []
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(Math.hypot(a.eastM - b.eastM, a.northM - b.northM) / 5))
      let previous: number[] | null = null
      for (let j = 0; j <= steps; j++) {
        const t = j / steps, east = a.eastM + (b.eastM - a.eastM) * t, north = a.northM + (b.northM - a.northM) * t, h = s.sample(east, north)
        if (h === null) { previous = null; continue }
        const point = [east, h - origin + .08, -north]
        if (previous) vertices.push(...previous, ...point)
        previous = point
      }
    }
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.computeBoundingSphere()
  })
  return <group ref={root} visible={false} scale={1 / LUNAR_RADIUS_M}><lineSegments geometry={geometry} material={material} userData={{ focusIgnore: true, decorative: true }} /></group>
}
