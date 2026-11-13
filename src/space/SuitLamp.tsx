import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as T from 'three'
import type { Runtime } from './SpaceScene'
import { LUNAR_RADIUS_M } from './terrain'

/**
 * Optional, clearly illustrative helmet lamp for dark or shadowed ground (off by default). A soft spot cone from
 * just above the eye lights the hardware, rocks and gloves; the regolith shader adds the same cone itself.
 * Display only: it adds no solar generation and never changes a measured value. It casts no shadows.
 */
export function SuitLamp({ runtime, enabled }: { runtime: Runtime; enabled: boolean }) {
  const light = useRef<T.SpotLight>(null), target = useMemo(() => new T.Object3D(), []), { invalidate } = useThree()
  useEffect(() => { invalidate() }, [enabled, invalidate])
  const forward = useMemo(() => new T.Vector3(), []), up = useMemo(() => new T.Vector3(), [])
  useFrame(({ camera }) => {
    const l = light.current
    if (!l) return
    l.visible = enabled && runtime.visit
    if (!l.visible) return
    camera.getWorldDirection(forward)
    up.copy(camera.up).normalize()
    l.position.copy(camera.position).addScaledVector(up, .12 / LUNAR_RADIUS_M)
    target.position.copy(l.position).addScaledVector(forward, 10 / LUNAR_RADIUS_M)
    l.target = target
  })
  if (!enabled) return null
  return <>
    <primitive object={target} />
    <spotLight ref={light} color="#fff1dc" intensity={1.8} angle={.5} penumbra={.75} decay={0} distance={28 / LUNAR_RADIUS_M} castShadow={false} />
  </>
}
