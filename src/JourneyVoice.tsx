import lines from './journey-lines.json'

// Chader Buri's tour lines. She speaks in text only; there is no narration audio.
export type JourneyLine = keyof typeof lines
export { lines }
