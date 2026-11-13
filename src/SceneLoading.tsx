import { useEffect, useState } from 'react'
import { useProgress } from '@react-three/drei'
import './scene-loading.css'

/**
 * A small status over the 3D scene while its images (surface maps, relief) are still downloading, so a first
 * visit on a slow connection shows "Loading the Moon… 42%" instead of empty space. It appears only after a short
 * delay, so cached visits never see it, and it reads the same three.js loading manager the scene uses.
 */
export function SceneLoading({ label }: { label: string }) {
  const { active, progress } = useProgress()
  const [show, setShow] = useState(false)
  useEffect(() => {
    if (!active) { setShow(false); return }
    const timer = setTimeout(() => setShow(true), 700)
    return () => clearTimeout(timer)
  }, [active])
  if (!show) return null
  return <div className="moon-loading" role="status" aria-live="polite">
    <span className="moon-loading-spinner" aria-hidden="true" />
    {label} {Math.max(1, Math.min(99, Math.round(progress)))}%
  </div>
}
