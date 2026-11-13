import { horizonsResponse } from '../server/horizons-policy'

export default async function handler(req: { url?: string; method?: string }, res: {
  setHeader: (k: string, v: string) => void
  status: (n: number) => { end: (body: string) => void }
}) {
  const response = await horizonsResponse(req.url ?? '', req.method)
  for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value)
  res.status(response.status).end(response.body)
}
