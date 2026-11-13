// Verified images from the NASA Image and Video Library (images.nasa.gov, no key needed).
// Each ID was checked against the library's own metadata. Regional images are labelled as
// such: they are not views from the exact landing coordinate.
export type NasaImage = {
  id: string
  title: string
  date: string
  center: string
  caption: string
  scope: 'site' | 'vehicle' | 'region'
}
export const NASA_IMAGES: Record<string, NasaImage> = {
  PIA12953: { id: 'PIA12953', title: 'Near the Summit of Malapert Mountain', date: '2010-02-22', center: 'NASA/JPL', caption: 'Lunar Reconnaissance Orbiter view of regolith creep patterns near Malapert’s summit.', scope: 'site' },
  IM_00309: { id: 'IM_00309', title: 'Intuitive Machines’ Nova-C lunar lander', date: '2024-02-07', center: 'NASA/MSFC', caption: 'The Nova-C vehicle flown on IM-1 (Odysseus), before launch.', scope: 'vehicle' },
  PIA13523: { id: 'PIA13523', title: 'The Lunar South Pole', date: '2010-09-27', center: 'NASA/JPL', caption: 'The south polar region where every site in this explorer lies.', scope: 'region' },
  PIA00001: { id: 'PIA00001', title: 'South Pole Region of the Moon as Seen by Clementine', date: '1996-06-03', center: 'NASA/JPL', caption: 'Mosaic of about 1,500 Clementine images, orthographic and centred on the pole.', scope: 'region' },
}
const BY_SITE: Record<string, string[]> = {
  'malapert-massif': ['PIA12953'],
  'im-1-odysseus-site': ['IM_00309'],
}
const REGION = ['PIA13523', 'PIA00001']

/** Up to two images for a site: site-specific first, then regional context. */
export function imageryFor(slug: string): NasaImage[] {
  return [...(BY_SITE[slug] ?? []), ...REGION].slice(0, 2).map(id => NASA_IMAGES[id])
}
export const imageUrl = (id: string) => `https://images-assets.nasa.gov/image/${id}/${id}~small.jpg`
export const imagePage = (id: string) => `https://images.nasa.gov/details/${id}`
export const SCOPE_NOTE: Record<NasaImage['scope'], string> = {
  site: 'Archive image of this area', vehicle: 'Archive image of the mission vehicle', region: 'Regional archive image, not a view from this exact spot',
}
