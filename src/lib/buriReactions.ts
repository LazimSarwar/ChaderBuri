// Chader Buri notices what the visitor does on the surface. Pure event detection,
// so the lines and their once-only rules are testable without a browser.
// Every remark is either about the visitor's own action or a calculated scene
// state (Sun disc vs terrain skyline, Earth centre vs skyline); none is a forecast.
// An offer is her own suggestion: it changes nothing until the visitor presses it.
import type { GuideAction } from './guideAction.ts'

export type ReactionScene = {
  landed: boolean
  siteSlug: string
  siteName: string
  airborne: boolean
  trailSteps: number
  trailDistanceM: number
  photos: number
  flags: number
  earthUp: boolean
  sunState: 'lit' | 'grazing' | 'shadowed'
  /** Hours until Earth / the Sun next clears the skyline at the target, if within the cache. */
  nextEarthriseH?: number | null
  nextSunriseH?: number | null
}
export type ReactionOffer = { label: string; action: GuideAction }
export type Reaction = { key: string; text: string; priority: number; offer?: ReactionOffer }

/** Skip-ahead offers stay within the guide's seven-day advance limit. */
export function skipOffer(hours: number | null | undefined, what: string): ReactionOffer | undefined {
  if (hours == null || !Number.isFinite(hours) || hours < .5) return undefined
  const whole = Math.ceil(hours)
  if (whole > 168) return undefined
  return { label: `Skip ${whole} h to ${what}`, action: { kind: 'advance', value: String(whole) } }
}

const WALK_MILESTONES = [[60, 'walk-60'], [250, 'walk-250']] as const

export const REACTION_LINES = {
  arrive: (site: string) => `So this is ${site}. Stand still a moment and look at that skyline.`,
  jump: 'Ha! Did you feel that? Up here you weigh about a sixth of what you do on Earth.',
  prints: 'Look behind you, shona. With no wind or rain, bootprints like yours can last for millions of years.',
  'walk-60': 'Sixty metres already! The Sun sits so low at the pole that even small rocks cast long shadows.',
  'walk-250': 'What an explorer. There’s no air to scatter light here, so the sky stays black even in daylight.',
  photo: 'Lovely picture. See how far hills look as sharp as near ones? With no haze, distances fool the eye.',
  flag: 'A survey flag! Real crews mark spots like this so they can find a sample site again.',
  earthRise: 'Earth is above the measured skyline at this time. A radio link still needs equipment and ground-station checks.',
  earthSet: 'Earth is behind the measured skyline at this time. Direct line of sight is blocked; relays aren’t checked here.',
  sunSet: 'The Sun is behind the ridge at this time. Solar power drops; surface temperature is not measured in this view.',
  sunRise: 'Here comes the Sun again! Light means power for a lander’s solar panels.',
  idle: 'Not sure where to go next? Tap me and ask. I can explain the terrain and predictions shown here.',
} as const

/** The most important new event between two scene states, if any has not been said yet. */
export function detectReaction(prev: ReactionScene | null, next: ReactionScene, said: ReadonlySet<string>, firstSite: string | null): Reaction | null {
  if (!next.landed) return null
  const found: Reaction[] = []
  const add = (key: string, text: string, priority: number, offer?: ReactionOffer) => { if (!said.has(key)) found.push({ key, text, priority, ...(offer ? { offer } : {}) }) }
  if (!prev || !prev.landed || prev.siteSlug !== next.siteSlug) {
    // The guided tour already welcomes the first landing.
    if (firstSite && next.siteSlug !== firstSite) add('arrive:' + next.siteSlug, REACTION_LINES.arrive(next.siteName), 3)
    return found[0] ?? null
  }
  if (!prev.airborne && next.airborne) add('jump', REACTION_LINES.jump, 5)
  if (next.photos > prev.photos) add('photo', REACTION_LINES.photo, 4)
  if (next.flags > prev.flags) add('flag', REACTION_LINES.flag, 4)
  if (prev.earthUp !== next.earthUp) add(next.earthUp ? 'earthRise' : 'earthSet', next.earthUp ? REACTION_LINES.earthRise : REACTION_LINES.earthSet, 6, next.earthUp ? undefined : skipOffer(next.nextEarthriseH, 'Earthrise'))
  if (prev.sunState !== 'shadowed' && next.sunState === 'shadowed') add('sunSet', REACTION_LINES.sunSet, 6, skipOffer(next.nextSunriseH, 'sunrise'))
  if (prev.sunState === 'shadowed' && next.sunState !== 'shadowed') add('sunRise', REACTION_LINES.sunRise, 6)
  if (prev.trailSteps < 6 && next.trailSteps >= 6) add('prints', REACTION_LINES.prints, 2)
  for (const [metres, key] of WALK_MILESTONES) if (prev.trailDistanceM < metres && next.trailDistanceM >= metres) add(key, REACTION_LINES[key], 1)
  return found.sort((a, b) => b.priority - a.priority)[0] ?? null
}
