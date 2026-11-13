import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import './interface.css'
import { OpeningScene } from './OpeningScene'
import { StartupBoundary } from './StartupBoundary'

import './journey.css'

const loadApp = () => import('./App')
const App = lazy(loadApp)

function Launch() {
  const [started, setStarted] = useState(false)
  const [openingVisible,setOpeningVisible] = useState(true)
  useEffect(()=>{
    if(!started)return
    const timer=setTimeout(()=>setOpeningVisible(false),window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:650)
    return ()=>clearTimeout(timer)
  },[started])
  return <>
    {started&&<div className="h-full" inert={openingVisible}><StartupBoundary><Suspense fallback={<div role="status">Opening the solar system…</div>}><App/></Suspense></StartupBoundary></div>}
    {openingVisible&&<OpeningScene leaving={started} onPrepare={loadApp} onStart={()=>setStarted(true)}/>}
  </>
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Launch />
  </StrictMode>,
)
