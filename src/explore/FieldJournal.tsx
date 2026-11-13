import { useEffect, useState } from 'react'
import { Camera, Compass, Download, Flag, Footprints, LayoutDashboard, MapPin, NotebookPen, Trash2 } from 'lucide-react'
import type { JournalPhoto } from '../lib/expedition'
import type { FieldReading } from '../lib/fieldwork'
import { formatLatLon, MAX_NOTE_CHARS, type FieldNote } from './fieldNotes'
import { distanceText, formatSimUTC } from './fieldMath'

type Tab = 'photos' | 'notes' | 'markers'
type Props = {
  siteName: string
  siteSlug: string
  photos: JournalPhoto[]
  maxPhotos: number
  notes: FieldNote[]
  notesSaved: boolean
  flags: FieldReading[]
  lastInspection: FieldReading | null
  archiveStatus: string
  visitor: { eastM: number; northM: number }
  flagPositions: Record<string, { eastM: number; northM: number }>
  onPhotoNote: (id: string, note: string) => void
  onRemovePhoto: (id: string) => void
  onAddNote: (text: string) => void
  onUpdateNote: (id: string, text: string) => void
  onRemoveNote: (id: string) => void
  onWalkTo: (target: { eastM: number; northM: number; label: string; standoffM: number }) => void
  onExport: () => void
  initialTab?: Tab
  /** Turn to face a saved place from where you stand. */
  onFace: (target: { eastM: number; northM: number }) => void
  /** Open the dashboard's site conditions for this site at the time the observation was made. */
  onOpenPlanning: (sceneUTC: string) => void
  /** An observation chosen in the 3D view (its marker): shown first and outlined. */
  focus?: { id: string; n: number } | null
}
const utc = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? formatSimUTC(d) : iso }

/** Photos, notes and markers from this visit. Photos come from the expedition archive; notes are kept on this device. */
export function FieldJournal(p: Props) {
  const [tab, setTab] = useState<Tab>(p.initialTab ?? 'photos')
  // A marker picked in the scene opens its entry.
  useEffect(() => {
    if (!p.focus) return
    const id = p.focus.id
    if (p.photos.some(ph => ph.id === id)) setTab('photos')
    else if (p.notes.some(n => n.id === id && n.kind === 'note')) setTab('notes')
    else setTab('markers')
    requestAnimationFrame(() => document.getElementById('journal-item-' + id)?.scrollIntoView({ block: 'nearest' }))
  }, [p.focus?.n])
  const revisit = (at: { eastM: number; northM: number }, label: string, sceneUTC: string) => <div className="field-row field-revisit">
    <button className="field-button" disabled={Math.hypot(at.eastM - p.visitor.eastM, at.northM - p.visitor.northM) < 1.5} onClick={() => p.onWalkTo({ ...at, label, standoffM: 0 })}><Footprints size={14} aria-hidden="true" />Walk here</button>
    <button className="field-button" disabled={Math.hypot(at.eastM - p.visitor.eastM, at.northM - p.visitor.northM) < 1.5} onClick={() => p.onFace(at)}><Compass size={14} aria-hidden="true" />Face it</button>
    <button className="field-button" title="Site conditions for this site at the time of this observation. Your mission plan is not changed." onClick={() => p.onOpenPlanning(sceneUTC)}><LayoutDashboard size={14} aria-hidden="true" />Open in planning</button>
  </div>
  const focused = (id: string) => p.focus?.id === id || undefined
  const [draft, setDraft] = useState('')
  const notes = p.notes.filter(n => n.siteSlug === p.siteSlug)
  const written = notes.filter(n => n.kind === 'note'), markers = notes.filter(n => n.kind === 'marker')
  const tabs: [Tab, string, number][] = [['photos', 'Photos', p.photos.length], ['notes', 'Notes', written.length], ['markers', 'Markers', markers.length + p.flags.length]]
  const away = (e: number, n: number) => distanceText(Math.hypot(e - p.visitor.eastM, n - p.visitor.northM))
  return <div className="field-journal">
    <div className="field-tabs" role="tablist" aria-label="Journal sections">
      {tabs.map(([id, label, count]) => <button key={id} role="tab" id={`journal-tab-${id}`} aria-selected={tab === id} aria-controls={`journal-${id}`} onClick={() => setTab(id)}>{label}<span>{count}</span></button>)}
    </div>
    {tab === 'photos' && <div role="tabpanel" id="journal-photos" aria-labelledby="journal-tab-photos">
      {p.photos.length === 0 ? <p className="field-empty"><Camera size={18} aria-hidden="true" />No photos at {p.siteName} yet. Press P or use Photo to take one.</p> :
        <ul className="field-photo-list">{[...p.photos].reverse().map(photo => <li key={photo.id} id={'journal-item-' + photo.id} data-focus={focused(photo.id)}>
          <img src={photo.imageUrl} alt={`Rendered view at ${photo.siteName}, ${utc(photo.sceneUTC)}`} width={photo.width} height={photo.height} />
          <dl className="field-facts">
            <div><dt>Site</dt><dd>{photo.siteName}</dd></div>
            <div><dt>Coordinates</dt><dd>{formatLatLon(photo.pose.lat, photo.pose.lonEast)}</dd></div>
            <div><dt>Simulation time</dt><dd>{utc(photo.sceneUTC)}</dd></div>
            <div><dt>Captured</dt><dd>{utc(photo.capturedUTC)}</dd></div>
          </dl>
          <label className="field-label" htmlFor={`photo-note-${photo.id}`}>Note</label>
          <textarea id={`photo-note-${photo.id}`} maxLength={280} rows={2} value={photo.note} placeholder="What were you looking at?" onChange={e => p.onPhotoNote(photo.id, e.target.value)} />
          {photo.pose.eastM !== undefined && photo.pose.northM !== undefined ? revisit({ eastM: photo.pose.eastM, northM: photo.pose.northM }, 'the photo spot', photo.sceneUTC)
            : <div className="field-row"><button className="field-button" onClick={() => p.onOpenPlanning(photo.sceneUTC)}><LayoutDashboard size={14} aria-hidden="true" />Open in planning</button></div>}
          <div className="field-row"><button className="field-button is-quiet" onClick={() => p.onRemovePhoto(photo.id)}><Trash2 size={14} aria-hidden="true" />Remove</button></div>
        </li>)}</ul>}
      <p className="field-source">{p.photos.length} of {p.maxPhotos} photos kept. Rendered simulation views: LOLA relief with illustrative soil, lighting and equipment, not lunar photography. {p.archiveStatus}</p>
    </div>}
    {tab === 'notes' && <div role="tabpanel" id="journal-notes" aria-labelledby="journal-tab-notes">
      <form className="field-note-form" onSubmit={e => { e.preventDefault(); const t = draft.trim(); if (t) { p.onAddNote(t); setDraft('') } }}>
        <label className="field-label" htmlFor="field-note-new">New note · saved with your position and the simulation time</label>
        <textarea id="field-note-new" rows={3} maxLength={MAX_NOTE_CHARS} value={draft} onChange={e => setDraft(e.target.value)} placeholder="Shadows reach the lander at…" />
        <button className="field-button" type="submit" disabled={!draft.trim()}><NotebookPen size={14} aria-hidden="true" />Add note</button>
      </form>
      {written.length === 0 ? <p className="field-empty">No notes yet.</p> : <ul className="field-note-list">{[...written].reverse().map(note => <li key={note.id} id={'journal-item-' + note.id} data-focus={focused(note.id)}>
        <p className="field-note-meta">{note.siteName} · {formatLatLon(note.lat, note.lonEast)} · Simulation time <time dateTime={note.sceneUTC}>{utc(note.sceneUTC)}</time></p>
        <p className="field-source">Saved <time dateTime={note.createdUTC}>{utc(note.createdUTC)}</time> · device time</p>
        <textarea aria-label={`Note written at ${utc(note.sceneUTC)}`} rows={2} maxLength={MAX_NOTE_CHARS} value={note.text} onChange={e => p.onUpdateNote(note.id, e.target.value)} />
        {revisit(note, 'the note spot', note.sceneUTC)}
        <div className="field-row"><button className="field-button is-quiet" onClick={() => p.onRemoveNote(note.id)}><Trash2 size={14} aria-hidden="true" />Delete note</button></div>
      </li>)}</ul>}
      {!p.notesSaved && <p className="field-source" role="status">This browser is not saving notes; they last until you close the page.</p>}
    </div>}
    {tab === 'markers' && <div role="tabpanel" id="journal-markers" aria-labelledby="journal-tab-markers">
      {markers.length + p.flags.length === 0 && <p className="field-empty"><MapPin size={18} aria-hidden="true" />No markers yet. Add one from the map, or plant a survey flag with F.</p>}
      <ul className="field-note-list">
        {[...markers].reverse().map(m => <li key={m.id} id={'journal-item-' + m.id} data-focus={focused(m.id)}>
          <p className="field-note-meta"><MapPin size={13} aria-hidden="true" /> Observation marker · {away(m.eastM, m.northM)} away · {utc(m.sceneUTC)}</p>
          <textarea aria-label="Marker label" rows={1} maxLength={MAX_NOTE_CHARS} value={m.text} onChange={e => p.onUpdateNote(m.id, e.target.value)} />
          {revisit(m, m.text || 'the marker', m.sceneUTC)}
          <div className="field-row"><button className="field-button is-quiet" onClick={() => p.onRemoveNote(m.id)}><Trash2 size={14} aria-hidden="true" />Remove</button></div>
        </li>)}
        {p.flags.map((f, i) => { const pos = p.flagPositions[f.id]; return <li key={f.id} id={'journal-item-' + f.id} data-focus={focused(f.id)}>
          <p className="field-note-meta"><Flag size={13} aria-hidden="true" /> Survey flag {i + 1}{pos ? ` · ${away(pos.eastM, pos.northM)} away` : ''}</p>
          <p>{formatLatLon(f.lat, f.lonEast)} · DEM elevation {f.elevationM.toFixed(1)} m · rendered facet slope {f.slopeDeg.toFixed(1)}°</p>
          {pos && <div className="field-row field-revisit"><button className="field-button" onClick={() => p.onWalkTo({ eastM: pos.eastM, northM: pos.northM, label: `survey flag ${i + 1}`, standoffM: 1 })}><Footprints size={14} aria-hidden="true" />Walk here</button><button className="field-button" onClick={() => p.onFace(pos)}><Compass size={14} aria-hidden="true" />Face it</button></div>}
        </li> })}
        {p.lastInspection && <li><p className="field-note-meta">Last ground inspection</p><p>{formatLatLon(p.lastInspection.lat, p.lastInspection.lonEast)} · rendered DEM facet slope {p.lastInspection.slopeDeg.toFixed(1)}° · {p.lastInspection.resolutionM} m DEM pixels</p></li>}
      </ul>
    </div>}
    <div className="field-row field-journal-foot"><button className="field-button" onClick={p.onExport}><Download size={14} aria-hidden="true" />Export journal (JSON)</button></div>
  </div>
}
