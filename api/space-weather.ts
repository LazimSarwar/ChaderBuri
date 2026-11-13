import type { IncomingMessage, ServerResponse } from 'node:http'
import { spaceWeatherHTTP } from '../server/space-weather.ts'
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await spaceWeatherHTTP(req, res, { apiKey: process.env.NASA_API_KEY })
}
