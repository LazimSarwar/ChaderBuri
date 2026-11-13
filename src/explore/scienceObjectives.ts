/** Science questions, not detections. Route stations are visitor-selected training worksites. */
export const SCIENCE_OBJECTIVES = [
  { id: 'terrain', title: 'Survey a deployment site', question: 'How does the resolved terrain affect where equipment could be placed?', task: 'Record the DEM elevation and slope, photograph the view, and compare it with the landing point.', instrument: 'Terrain model and annotated simulated photograph', minutes: 5, output: 'A terrain observation with its resolution and unknown hazards.' },
  { id: 'power', title: 'Investigate a power worksite', question: 'Could nearby terrain obstruct sunlight at a proposed worksite?', task: 'Inspect the local Sun obstruction estimate at arrival and after the planned work. Compare it with the lander’s full mission power model.', instrument: 'LOLA terrain, JPL Sun directions and the panel experiment', minutes: 8, output: 'A lighting observation; no independent battery or temperature measurement.' },
  { id: 'shadow', title: 'Plan shadow reconnaissance', question: 'What limits access to a shadowed worksite and the return journey?', task: 'Choose a worksite, inspect predicted local obstruction and return time, and document the evidence still needed for an ice investigation.', instrument: 'Terrain and lighting estimates; spectrometer or sampling equipment would need separate mission planning', minutes: 10, output: 'An access study. Darkness alone establishes neither permanent shadow nor water ice.' },
] as const
export type ScienceObjectiveId = typeof SCIENCE_OBJECTIVES[number]['id']
export const SCIENCE_SOURCES = [
  { title: 'NASA landing-region science and engineering considerations (2024)', url: 'https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/' },
  { title: 'NASA lunar water and ice evidence', url: 'https://science.nasa.gov/moon/moon-water-and-ices/' },
  { title: 'NASA enhanced regional topography products', url: 'https://pgda.gsfc.nasa.gov/products/104' },
]
