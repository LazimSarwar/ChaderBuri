import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import './opening-scene.css'

/** A short, silent welcome before entering the solar-system workspace. */
export function OpeningScene({ onStart, onExample, onPrepare, leaving }: { onStart: () => void; onExample?: () => void; onPrepare: () => Promise<unknown>; leaving: boolean }) {
  const [arrived, setArrived] = useState(false)
  const [portraitReady, setPortraitReady] = useState(false)

  useEffect(() => {
    if (!portraitReady) return
    const timer = window.setTimeout(() => setArrived(true), 650)
    return () => clearTimeout(timer)
  }, [portraitReady])

  useEffect(() => {
    if (arrived) void onPrepare().catch(() => {})
  }, [arrived, onPrepare])

  return <main className="moon-opening" data-leaving={leaving} inert={leaving} data-arrived={arrived} aria-label="Welcome from Chader Buri">
    <div className="moon-opening-scene">
      <img width="1024" height="1536" fetchPriority="high" className="moon-opening-figure" src="/chader-buri-guide.webp" alt="Chader Buri in her embroidered white saree, leaning on her cane" onLoad={() => setPortraitReady(true)} onError={() => setPortraitReady(true)} />
      <div className="moon-opening-caption" aria-live="polite">{arrived && <>
        <h1>Hi, welcome!</h1>
        <p className="moon-opening-intro">I’m Chader Buri. I help you choose where and when to land at the Moon’s south pole, and show why sunlight and contact with Earth change.</p>
        <p className="moon-opening-ready">Same site, same lander, one week apart: the battery result can flip.</p>
      </>}</div>
      <div className="moon-opening-action">{arrived && <>
        {onExample && <button className="moon-opening-start" onClick={onExample}>See how one week changes a mission<ArrowRight size={17} aria-hidden="true" /></button>}
        <button className="moon-opening-start" onClick={onStart}>{onExample ? 'Explore the Moon' : 'Start'}<ArrowRight size={17} aria-hidden="true" /></button>
      </>}</div>
    </div>
  </main>
}
