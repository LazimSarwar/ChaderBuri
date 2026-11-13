import { WORKSPACE_TOOLS } from './workspace.ts'

/** Operations Chader Buri may request. The app performs and reports each one; the model never claims success. */
export const SURFACE_ACTIONS = ['photo', 'jump', 'flag'] as const
/**
 * Mission-plan operations. highlight points at evidence (changes nothing); compareDates/compareSites open the
 * fair comparison; setLanding/setSite/setEquipment change the selected mission, are recalculated by the app
 * and can be undone; undo reverts the last such change.
 */
export const MISSION_ACTIONS = ['highlight', 'compareDates', 'compareSites', 'setLanding', 'setSite', 'setEquipment', 'undo'] as const
export const HIGHLIGHT_TARGETS = ['verdict', 'battery', 'reserve', 'dark', 'gap', 'lit', 'link', 'thermal'] as const
/** Equipment and duration Chader Buri may change, with the same bounds as the mission settings. */
export const EQUIPMENT_LIMITS: Record<string, [number, number]> = { capacityWh: [100, 200000], loadW: [0, 10000], panelAreaM2: [0.1, 100], reservePct: [0, 90], missionDays: [3, 30] }
export const guideDestinations = ['energy','calendar','compareWindows','surface', 'sun', 'earth', 'skyline', 'tour', 'orbit', 'advance', 'play', 'pause', 'close', 'explain', ...SURFACE_ACTIONS, 'searchSites', 'searchMissions', 'visit', ...MISSION_ACTIONS, ...WORKSPACE_TOOLS.map(([key]) => key)] as const
export type GuideAction = { kind: typeof guideDestinations[number]; value: string }

const HIGHLIGHT_NAME: Record<string, string> = { verdict: 'the result', battery: 'the lowest battery point', reserve: 'where the battery reaches your reserve', dark: 'the longest darkness', gap: 'the longest time without Earth', lit: 'the sunlight check', link: 'the Earth-in-view check', thermal: 'the night-survival check' }
const EQUIPMENT_NAME: Record<string, [string, string]> = { capacityWh: ['battery capacity', ' Wh'], loadW: ['electrical load', ' W'], panelAreaM2: ['panel area', ' m²'], reservePct: ['battery reserve', '%'], missionDays: ['mission length', ' days'] }
const FIXED_LABEL: Record<string, string> = { surface: 'Go to the surface', tour: 'Start the Moon walk', orbit: 'Return to orbit', sun: 'Turn toward the Sun', earth: 'Turn toward Earth', skyline: 'Look at the highest skyline', play: 'Play time', pause: 'Pause time', close: 'Close this page', energy: 'Open the energy instruments', calendar: 'Open the landing calendar', compareWindows: 'Compare landing windows', photo: 'Take a photo', jump: 'Jump', flag: 'Plant a survey flag', undo: 'Undo Chader Buri’s last change' }
/** What an action will do, in words for a button: every offer says exactly where it goes or what it changes. */
export function actionLabel(a: GuideAction, name: (slug: string) => string = s => s): string {
  const n = Number(a.value), days = `${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'} ${n > 0 ? 'later' : 'earlier'}`
  switch (a.kind) {
    case 'highlight': return `Show ${HIGHLIGHT_NAME[a.value] ?? a.value} on the mission plan`
    case 'compareDates': return `Compare with a landing ${days}`
    case 'compareSites': return a.value ? `Compare with ${name(a.value)}` : 'Compare with another site'
    case 'setLanding': return `Move my landing ${days}`
    case 'setSite': return `Switch my mission to ${name(a.value)}`
    case 'setEquipment': { const [key, v] = a.value.split('='), e = EQUIPMENT_NAME[key]; return e ? `Set the ${e[0]} to ${v}${e[1]}` : `Set ${a.value}` }
    case 'visit': return `Visit ${name(a.value)} in 3D`
    case 'advance': return `Move the scene clock ${Math.abs(n)} h ${n > 0 ? 'forward' : 'back'}`
    case 'explain': return a.value === 'off' ? 'Turn plain-language mode off' : 'Turn plain-language mode on'
    case 'searchSites': return a.value ? `Search sites for “${a.value}”` : 'Show all sites'
    case 'searchMissions': return a.value ? `Search missions for “${a.value}”` : 'Show all missions'
  }
  return FIXED_LABEL[a.kind] ?? `Open ${WORKSPACE_TOOLS.find(([key]) => key === a.kind)?.[1] ?? a.kind}`
}
export type GuideView = { screen: string; search: string }
const SLUG = /^[a-z0-9-]{1,80}$/
const days = (v: string, max: number) => /^[+-]?\d{1,3}$/.test(v) && Number(v) !== 0 && Math.abs(Number(v)) <= max
export function readGuideAction(raw: unknown): GuideAction | null {
  if (raw == null) return null
  const action = raw as GuideAction
  if (!guideDestinations.includes(action.kind) || typeof action.value !== 'string' || action.value.length > 100)
    throw new Error('Unknown guide action')
  const v = action.value
  if ((action.kind === 'visit' || action.kind === 'setSite') && !SLUG.test(v)) throw new Error('Invalid site')
  if (action.kind === 'compareSites' && v !== '' && !SLUG.test(v)) throw new Error('Invalid site')
  if (action.kind === 'advance' && (!/^-?\d{1,3}$/.test(v) || Math.abs(Number(v)) > 168)) throw new Error('Choose up to seven days')
  if (action.kind === 'explain' && !['on', 'off', ''].includes(v)) throw new Error('Explain mode is on or off')
  if (action.kind === 'highlight' && !(HIGHLIGHT_TARGETS as readonly string[]).includes(v)) throw new Error('Unknown evidence to highlight')
  if (action.kind === 'compareDates' && !days(v, 30)) throw new Error('Compare a date up to 30 days away')
  if (action.kind === 'setLanding' && !days(v, 60)) throw new Error('Move the landing by up to 60 days')
  if (action.kind === 'setEquipment') {
    const m = /^([A-Za-z][A-Za-z0-9]{0,20})=(\d{1,6}(?:\.\d{1,2})?)$/.exec(v), lim = m && EQUIPMENT_LIMITS[m[1]]
    if (!m || !lim || Number(m[2]) < lim[0] || Number(m[2]) > lim[1] || (m[1] === 'missionDays' && !Number.isInteger(Number(m[2])))) throw new Error('Unsupported equipment change')
  }
  if (action.kind === 'undo' && v !== '') throw new Error('Undo takes no value')
  return { kind: action.kind, value: v }
}
