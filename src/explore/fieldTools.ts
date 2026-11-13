// Which field tools sit on the strip and which go in the labelled "More" sheet on narrow screens.
/** At or below this width the strip shows the most-used tools plus "More"; wider screens fit every tool (checked down to 600 px). */
export const NARROW_TOOLS_MAX_WIDTH = 640
/** The most-used tools on a phone, in strip order. Everything else is one tap away under "More". */
export const PHONE_PRIMARY_TOOLS = ['map', 'sky', 'time', 'ask'] as const

export function groupTools<T extends { id: string }>(tools: T[], narrow: boolean): { primary: T[]; more: T[] } {
  if (!narrow) return { primary: tools, more: [] }
  const primary = tools.filter(t => (PHONE_PRIMARY_TOOLS as readonly string[]).includes(t.id))
  return { primary, more: tools.filter(t => !primary.includes(t)) }
}
