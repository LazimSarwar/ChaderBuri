import { localFrame, sitePosition } from '../data'
import { MOON_RADIUS_M } from '../lib/visit'
import type { TerrainStore } from './terrain'

export type TerrainSampler = (eastM: number, northM: number) => number | null

/**
 * DEM height (metres above the lunar reference sphere, the same value as `TerrainStore.bestHeight`)
 * at an east/north offset from the visit target.
 *
 * The offset is converted with the walking code's exponential map (`viewpointCoordinates` in
 * lib/surfaceExplorer.ts), written out here with the target's frame computed once, and the datasets are
 * tried finest first exactly as `bestHeight` does, with the order sorted once. Tiles are read live, so
 * later calls see tiles that have loaded since; it returns null where no tile is loaded.
 */
export function visitTerrainSampler(store: TerrainStore, site: { lat: number; lonEast: number }): TerrainSampler {
  const datasets = [...store.manifest.datasets].sort((a, b) => a.spacingM - b.spacingM)
  const up = sitePosition(site.lat, site.lonEast), frame = localFrame(up)
  const [u0, u1, u2] = up, [e0, e1, e2] = frame.east, [n0, n1, n2] = frame.north
  return (eastM, northM) => {
    if (!Number.isFinite(eastM) || !Number.isFinite(northM)) return null
    const distance = Math.hypot(eastM, northM), arc = distance / MOON_RADIUS_M, c = Math.cos(arc), s = Math.sin(arc)
    const v0 = u0 * c + (distance ? (e0 * eastM + n0 * northM) * s / distance : 0)
    const v1 = u1 * c + (distance ? (e1 * eastM + n1 * northM) * s / distance : 0)
    const v2 = u2 * c + (distance ? (e2 * eastM + n2 * northM) * s / distance : 0)
    const lat = Math.asin(Math.max(-1, Math.min(1, v1))) * 180 / Math.PI, lon = Math.atan2(-v2, v0) * 180 / Math.PI
    for (const dataset of datasets) {
      const height = store.height(dataset, lat, lon)
      if (height !== null) return height
    }
    return null
  }
}
