import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import type { ConsoleGlance } from './consoleGlanceStore'

/** Experimental head-relative readout. Physical comfort, controller targeting and optics require a headset. */
export function VRGlance({ value, objective, mode, panelRef }: { value: ConsoleGlance; objective: string; mode: number; panelRef: React.RefObject<T.Mesh | null> }) {
  const { camera } = useThree(), group = useRef<T.Group>(null)
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 768
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = 'rgba(5,10,15,.94)'; ctx.fillRect(0, 0, 1024, 768)
    ctx.strokeStyle = '#80dcf6'; ctx.lineWidth = 4; ctx.strokeRect(4, 4, 1016, 760)
    ctx.fillStyle = '#80dcf6'; ctx.font = '32px sans-serif'; ctx.fillText(value.siteName || 'Mission readout loading',32,54)
    ctx.font='22px sans-serif';ctx.fillText(`Mission arrival: ${value.arrivalUTC || 'not loaded'}`,32,98);ctx.fillText(`Scene time: ${value.sceneUTC || 'not loaded'}`,32,130)
    ctx.fillText(mode===1?'Timeline':mode===2?'Ranking':'Glance',850,98)
    const lines = mode === 1 ? value.timeline : mode === 2 ? value.ranking : [value.verdict, value.next, value.link, value.battery, `Objective: ${objective}`]
    let y = 182; ctx.fillStyle = '#f4f3ee'; ctx.font = '28px sans-serif'
    for (const text of lines.slice(0, 8)) {
      const words = text.split(' '); let line = ''
      for (const word of words) { if (ctx.measureText(line + word).width > 950) { ctx.fillText(line, 32, y); y += 36; line = '' } line += word + ' ' }
      ctx.fillText(line, 32, y); y += 52
      if (y > 625) break
    }
    ctx.fillStyle = '#bac5cb'; ctx.font = '23px sans-serif'; ctx.fillText('Predictions · not live telemetry · hardware validation pending', 32, 704)
    ctx.fillText('Select panel: glance / timeline / ranking', 32, 742)
    const t = new T.CanvasTexture(canvas); t.colorSpace = T.SRGBColorSpace; return t
  }, [value, objective, mode])
  useEffect(() => () => texture.dispose(), [texture])
  const rotation = useMemo(() => new T.Quaternion(), [])
  useFrame(() => { if (!group.current) return; camera.getWorldPosition(group.current.position); camera.getWorldQuaternion(rotation); group.current.quaternion.copy(rotation) })
  return <group ref={group}><mesh ref={panelRef} position={[0, -.25, mode ? -1.7 : -2.1]} scale={mode ? 1.15 : 1}><planeGeometry args={[1.25, .9375]} /><meshBasicMaterial map={texture} transparent depthTest={false} toneMapped={false} /></mesh></group>
}
