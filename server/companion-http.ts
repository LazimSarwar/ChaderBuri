import type { IncomingMessage,ServerResponse } from 'node:http'
import { companionResponse,type CompanionConfig } from './companion-policy.ts'
const buckets=new Map<string,{at:number;count:number}>()
let total={at:0,count:0}
export async function companionHTTP(req:IncomingMessage&{body?:unknown},res:ServerResponse,config:CompanionConfig){
 const reject=(status:number,error:string)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({error}))}
 const origin=req.headers.origin
 try{if(origin&&new URL(origin).host!==req.headers.host)return reject(403,'Open the guide in the Chader Buri app.')}catch{return reject(403,'Unsupported origin')}
 if(req.method==='POST'){
  const now=Date.now(),id=req.socket.remoteAddress??'local'
  if(now-total.at>60000){total={at:now,count:0};buckets.clear()}
  const b=buckets.get(id)??{at:now,count:0};if(now-b.at>60000){b.at=now;b.count=0}
  if(b.count>=10||total.count>=60)return reject(429,'The guide has reached this minute’s conversation limit. Try again shortly.')
  b.count++;total.count++;buckets.set(id,b)
 }
 let body=req.body
 if(req.method==='POST'){
  if(!req.headers['content-type']?.startsWith('application/json'))return reject(415,'Use a JSON request')
  try{
   if(body===undefined){const chunks:Buffer[]=[];let length=0;for await(const chunk of req){const b=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);length+=b.length;if(length>18000)return reject(413,'This conversation is too long');chunks.push(b)}body=JSON.parse(Buffer.concat(chunks).toString('utf8'))}
   else if(Buffer.byteLength(typeof body==='string'?body:JSON.stringify(body))>18000)return reject(413,'This conversation is too long')
   if(typeof body==='string')body=JSON.parse(body)
  }catch{return reject(400,'Invalid conversation request')}
 }
 const response=await companionResponse(req.method??'GET',body,config)
 res.writeHead(response.status,response.headers);res.end(response.body)
}
