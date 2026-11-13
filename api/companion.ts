import { companionHTTP } from '../server/companion-http.ts'
import type { IncomingMessage,ServerResponse } from 'node:http'
export default async function handler(req:IncomingMessage&{body?:unknown},res:ServerResponse){
 await companionHTTP(req,res,{apiKey:process.env.GEMINI_API_KEY,model:process.env.GEMINI_MODEL})
}
