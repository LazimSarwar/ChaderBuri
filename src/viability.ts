import * as THREE from 'three'
import { evaluate, windowStats, type Constraints, type SiteSeries } from './architect/solver'

/** Equirectangular viability overlay for the Moon globe.
 *
 *  A 1024×512 canvas texture; only the south-cap band (84°S–90°S) is painted,
 *  via distance-weighted interpolation between the LOLA-masked site
 *  probes — the same disclosure as the map. The texture is applied to a
 *  shell sphere one notch above the Moon mesh, so the field drapes over the
 *  real globe and orbits exactly like it.
 *
 *  Texel alignment with sitePosition() (three.js SphereGeometry convention):
 *    lat(j) = 90 − 180·j/H,   lon(i) = 180 − 360·i/W.
 */

const W = 1024
const H = 512

export type ViabilityTexture = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  texture: THREE.CanvasTexture
}

export function createViabilityTexture(): ViabilityTexture {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, W, H)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return { canvas, ctx, texture }
}

export type PaintOpts = {
  sites: { slug: string; lat: number; lonEast: number; name: string }[]
  seriesBySlug: Map<string, SiteSeries>
  constraints: Constraints
  landingRow: number
  mode: 'sun' | 'earth' | 'both'
}

const colToLon = (i: number) => 180 - (i * 360) / W
const rowToLat = (j: number) => 90 - (j * 180) / H
const lonToCol = (lon: number) => ((180 - lon) / 360) * W
const latToRow = (lat: number) => ((90 - lat) / 180) * H

/** Repaint the south-cap band for the current landing epoch + constraints. */
export function paintViability(vt: ViabilityTexture, o: PaintOpts) {
  const { ctx } = vt
  ctx.clearRect(0, 0, W, H)

  const missionHours = Math.round(o.constraints.missionDays * 24)
  const probes = o.sites.map((s) => {
    const se: SiteSeries | undefined = o.seriesBySlug.get(s.slug)
    if (!se) return null
    const row = Math.min(Math.floor(o.landingRow), se.hours - missionHours)
    const ev = evaluate(windowStats(se, row, row + missionHours), o.constraints)
    const pass =
      o.mode === 'sun' ? ev.ok.lit && ev.ok.dark
      : o.mode === 'earth' ? ev.ok.link && ev.ok.gap
      : ev.pass
    return {
      lat: s.lat,
      lon: ((s.lonEast % 360) + 360) % 360,
      col: lonToCol(((s.lonEast % 360) + 360) % 360),
      row: latToRow(s.lat),
      pass,
      near: ev.margin >= -0.1,
      litPct: ev.litPct,
      linkPct: ev.linkPct,
    }
  })
  const valid = probes.filter((p): p is NonNullable<typeof p> => p !== null)

  // paint the band bottom-up: rows for -84°S..-90°S
  const j0 = Math.floor(latToRow(-84))
  const img = ctx.getImageData(0, j0, W, H - j0)
  for (let j = j0; j < H; j++) {
    const lat = rowToLat(j)
    for (let i = 0; i < W; i++) {
      const lon = colToLon(i)
      let wSum = 0
      let vSum = 0
      for (const p of valid) {
        const dLat = (p.lat - lat) * 111
        const dLon =
          Math.min(Math.abs(lon - p.lon), 360 - Math.abs(lon - p.lon)) *
          111 *
          Math.cos(lat * (Math.PI / 180))
        const d = Math.hypot(dLat, dLon)
        const w = 1 / (d * d + 30)
        wSum += w
        vSum += w * (p.pass ? 1 : p.near ? 0.5 : 0)
      }
      const score = vSum / wSum
      let col: [number, number, number]
      if (score > 0.72) col = [61, 220, 151]
      else if (score > 0.45) col = [64, 158, 116]
      else if (score > 0.28) col = [96, 118, 156]
      else col = [42, 56, 88]
      const k = ((j - j0) * W + i) * 4
      img.data[k] = col[0]
      img.data[k + 1] = col[1]
      img.data[k + 2] = col[2]
      img.data[k + 3] = 190
    }
  }
  // only the band rows changed; write them back
  ctx.putImageData(img, 0, j0)
  vt.texture.needsUpdate = true
}
