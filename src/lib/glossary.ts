/**
 * Plain-language glossary for educators and the public. Every `short` is one
 * or two sentences a newcomer can read in the UI; `earth` is the intuition
 * pump: the same idea on Earth, so the lunar extreme lands.
 */
export type GlossaryTerm = { id: string; term: string; short: string; earth?: string }

export const GLOSSARY: GlossaryTerm[] = [
  {
    id: 'lunar-day',
    term: 'Lunar day and night',
    short:
      'One lunar day lasts 29.5 Earth days: roughly 14.8 days of sunlight followed by 14.8 days of night at the equator. Near the poles the Sun does not rise and set so much as circle the horizon.',
    earth: 'A battery that must last one lunar night is sized for two weeks of darkness, not one evening.',
  },
  {
    id: 'sun-drift',
    term: 'Sun drift (° per hour)',
    short: 'How fast the Sun moves along the horizon. At the lunar pole it creeps about 0.5° per hour.',
    earth: 'On Earth the Sun moves 15° per hour. A lunar sunset behind a ridge takes hours, and shadows crawl across the ground.',
  },
  {
    id: 'psr',
    term: 'Permanently shadowed region (PSR)',
    short:
      'A crater floor or hollow near a lunar pole that sunlight never reaches, because the Sun never climbs more than about 1.5° above the horizon there. PSRs are where water ice can survive.',
    earth: 'Even in midwinter the Sun rises tens of degrees above the horizon on Earth. At the lunar pole a 2° ridge casts a shadow that never leaves.',
  },
  {
    id: 'horizon-mask',
    term: 'Horizon mask',
    short:
      'For each compass direction, the angle up to the highest terrain in that direction, measured from LOLA elevation data. The Sun or Earth is visible only when it sits above the mask.',
    earth: 'Like a city skyline: a tall building to the south hides the Sun from a window for part of the day.',
  },
  {
    id: 'dte',
    term: 'Direct-to-Earth (DTE)',
    short: 'A radio link straight from the lander to a dish on Earth with no relay satellite. It needs Earth above the local terrain horizon.',
    earth: 'From the Moon, Earth hangs almost still in the sky. At the pole it hovers near the horizon, so one ridge can hide it for days.',
  },
  { id: 'elevation', term: 'Elevation', short: 'The angle of the Sun or Earth above a perfectly flat horizon, in degrees. Negative means below it.' },
  { id: 'azimuth', term: 'Azimuth', short: 'Compass direction in degrees, clockwise from north: 90° is east, 180° south, 270° west.' },
  {
    id: 'illumination',
    term: 'Sun visible (%)',
    short: 'The share of mission hours in which the centre of the Sun is above the terrain horizon, so the solar array can charge.',
  },
  {
    id: 'longest-dark',
    term: 'Longest darkness',
    short: 'The longest unbroken run of hours with the Sun hidden behind terrain. The battery, and any heater, must bridge it alone.',
    earth: 'Earth\'s longest night at mid-latitudes is about 15 hours. Here the number is often several Earth days.',
  },
  {
    id: 'reserve',
    term: 'Battery reserve',
    short: 'The charge level the plan refuses to go below, kept for emergencies. The battery check fails if the simulated charge dips under it.',
  },
  {
    id: 'limiting',
    term: 'Limiting constraint',
    short:
      'The single requirement closest to failing, or the first to fail: sunlight, darkness, Earth visibility, Earth gap, battery or thermal. Fix this one first; the others have slack.',
  },
  {
    id: 'footprint',
    term: 'Touchdown footprint',
    short:
      'Nineteen nearby points around the planned site, because landers rarely touch down exactly where planned. Each point is re-run through the same checks to see whether the plan still holds.',
  },
  {
    id: 'ephemeris',
    term: 'Ephemeris',
    short: 'A table of where the Sun and Earth are in the local sky at each hour, computed by NASA/JPL Horizons for this exact site.',
  },
  {
    id: 'lola',
    term: 'LOLA',
    short: 'The Lunar Orbiter Laser Altimeter on NASA\'s Lunar Reconnaissance Orbiter. Its elevation maps provide the terrain horizons used here.',
  },
  {
    id: 'duty',
    term: 'Duty cycle',
    short: 'The percentage of hours the Sun (or Earth) is visible from a site over a long period, independent of any particular mission date.',
  },
  {
    id: 'dsn',
    term: 'Deep Space Network (DSN)',
    short: 'NASA\'s three ground-station complexes at Goldstone, Madrid and Canberra. Shown here as a diagnostic only, never part of the verdict.',
  },
]

export const glossaryTerm = (id: string) => GLOSSARY.find((t) => t.id === id)
