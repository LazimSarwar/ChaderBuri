export type RequestOptions = { signal?:AbortSignal; timeoutMs?:number; expectedSha256?:string }
/** Includes response streaming and decompression in the deadline, not only the headers. */
export async function request<T>(url:string,read:(response:Response)=>Promise<T>,options:RequestOptions={}):Promise<T> {
  const controller=new AbortController()
  let timer:ReturnType<typeof setTimeout>|undefined
  let abort:(()=>void)|undefined
  const stopped=new Promise<never>((_,reject)=>{
    timer=setTimeout(()=>{controller.abort();reject(new Error(`Request timed out: ${url}`))},options.timeoutMs??12000)
    abort=()=>{controller.abort();reject(new DOMException('Request cancelled','AbortError'))}
    if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true})
  })
  try{return await Promise.race([stopped,fetch(url,{signal:controller.signal}).then(read)])}
  finally{clearTimeout(timer);if(abort)options.signal?.removeEventListener('abort',abort)}
}
export async function jsonBody(response:Response,expectedSha256?:string):Promise<unknown> {
  if(!response.ok)throw new Error(`Data request returned ${response.status}`)
  const raw=await response.text()
  if(expectedSha256){
    if(!globalThis.crypto?.subtle)throw new Error('Dataset verification requires HTTPS or localhost')
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))
    const hex=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
    if(hex!==expectedSha256)throw new Error('Dataset fingerprint mismatch; reload to fetch a consistent snapshot')
  }
  return JSON.parse(raw)
}
export const requestJson=(url:string,options:RequestOptions={})=>request(url,r=>jsonBody(r,options.expectedSha256),options)
