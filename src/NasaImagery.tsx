import { useState } from 'react'
import { imageryFor, imagePage, imageUrl, SCOPE_NOTE } from './lib/nasaImagery'

/** Real NASA archive images for the site, with credit and a link; text only if they can't load. */
export function NasaImagery({ slug }: { slug: string }) {
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  return <section className="nasa-imagery" aria-label="From NASA’s image library">
    <h3>From NASA’s image library</h3>
    {imageryFor(slug).map(img => <figure key={img.id}>
      {!failed[img.id] && <img src={imageUrl(img.id)} alt={img.title} decoding="async" onError={() => setFailed(f => ({ ...f, [img.id]: true }))} />}
      <figcaption>
        <strong>{img.title}</strong>
        <span>{img.caption}</span>
        <small>{SCOPE_NOTE[img.scope]} · {img.center} · {img.date} · {img.id}</small>
        <a href={imagePage(img.id)} target="_blank" rel="noreferrer">View at images.nasa.gov ↗</a>
      </figcaption>
    </figure>)}
  </section>
}
