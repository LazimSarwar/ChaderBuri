import { defineConfig,loadEnv,type Connect } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { horizonsResponse } from './server/horizons-policy'
import { companionHTTP } from './server/companion-http'
import { spaceWeatherHTTP } from './server/space-weather'

export default defineConfig(({mode})=>{
 const attachCompanion=(middlewares:Connect.Server)=>middlewares.use('/api/companion',(req,res)=>{const env=loadEnv(mode,process.cwd(),'');void companionHTTP(req,res,{apiKey:env.GEMINI_API_KEY||process.env.GEMINI_API_KEY,model:env.GEMINI_MODEL||process.env.GEMINI_MODEL}).catch(()=>{if(!res.headersSent)res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:'Chader Buri is temporarily unavailable.'}))})})
 const attachWeather=(middlewares:Connect.Server)=>middlewares.use('/api/space-weather',(req,res)=>{const env=loadEnv(mode,process.cwd(),'');void spaceWeatherHTTP(req,res,{apiKey:env.NASA_API_KEY||process.env.NASA_API_KEY}).catch(()=>{if(!res.headersSent)res.writeHead(503,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error:'NASA space-weather reports are temporarily unavailable.'}))})})
 return {
  plugins: [react(), tailwindcss(), {
    name: 'landsight-horizons',
    configureServer(server) {
      attachCompanion(server.middlewares)
      attachWeather(server.middlewares)
      server.middlewares.use('/api/horizons', async (req, res) => {
        const response = await horizonsResponse((req as { url?: string }).url ?? '', (req as { method?: string }).method)
        res.writeHead(response.status, response.headers)
        res.end(response.body)
      })
    },
    configurePreviewServer(server){attachCompanion(server.middlewares);attachWeather(server.middlewares)},
  }],
  build: {
    // three.js is ~1.1 MB on its own and sits in an isolated, lazily-loaded
    // vendor chunk; the eager entry stays small. This limit reflects that.
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Keep three.js and its React bindings in one vendor chunk: splitting
        // them risks duplicate three instances, and it pulls the largest
        // dependency out of the lazy scene chunk.
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('@react-three')) return 'three-vendor'
        },
      },
    },
  },
 }})
