import { useEffect } from 'react'
import { cleanDigestItems, type ScreenDigest, type ScreenDigestItem } from './contracts.ts'

// Each screen publishes the readouts it is showing. When the visitor asks Chader Buri a
// question, the open screen's digest travels with it, so "why is this number red?" can be
// matched to the actual readout. Module-level store: no re-renders, read on demand.
const screens = new Map<string, ScreenDigestItem[]>()
export function publishScreen(screen: string, items: ScreenDigestItem[]) { screens.set(screen, cleanDigestItems(items)) }
export function clearScreen(screen: string) { screens.delete(screen) }
export function readScreen(screen: string): ScreenDigest | null {
  const items = screens.get(screen)
  return items && items.length ? { screen, items } : null
}

/** Publish while mounted. `signature` should change only when the visible values change. */
export function useScreenDigest(screen: string, items: ScreenDigestItem[] | null, signature: string) {
  useEffect(() => {
    if (!items) { clearScreen(screen); return }
    publishScreen(screen, items)
  }, [screen, signature])
  useEffect(() => () => clearScreen(screen), [screen])
}
