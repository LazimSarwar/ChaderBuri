import { readScreen } from '../lib/screenDigest.ts'
import { MAX_DIGEST_ITEMS, type ScreenDigest } from '../lib/contracts.ts'
import { MISSION_DECISION_SCREEN, EXCURSION_SCREEN } from './missionDecisionDigest.ts'

/** The field interface publishes its readouts under this screen name; the Mission Visor keeps 'surface'. */
export const FIELD_SCREEN = 'surface-field'

/**
 * What Chader Buri reads on the surface: the field readouts first (site, time, tool, selection,
 * distance, heights), then the Mission Visor's instruments when the visor is on. Both stores stay
 * independent, so neither overwrites the other; the combined list is reported as screen 'surface'.
 */
export function readSurfaceScreen(): ScreenDigest | null {
  const field = readScreen(FIELD_SCREEN)?.items ?? [], visor = readScreen('surface')?.items ?? []
  const proposal = readScreen(MISSION_DECISION_SCREEN)?.items ?? [], excursion = readScreen(EXCURSION_SCREEN)?.items ?? []
  const consoleItems = readScreen('surface-console')?.items ?? []
  const pair = readScreen('surface-site-comparison')?.items ?? []
  const weather=readScreen('weather')?.items??[]
  const items = [...weather, ...pair, ...proposal, ...consoleItems, ...excursion, ...field, ...visor].slice(0, MAX_DIGEST_ITEMS)
  return items.length ? { screen: 'surface', items } : null
}
