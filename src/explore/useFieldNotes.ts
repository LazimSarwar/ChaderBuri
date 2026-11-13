import { useCallback, useEffect, useState } from 'react'
import { addFieldNote, FIELD_NOTES_KEY, parseFieldNotes, removeFieldNote, updateFieldNote, type FieldNote } from './fieldNotes'

const read = () => { try { return parseFieldNotes(localStorage.getItem(FIELD_NOTES_KEY)) } catch { return [] } }

/** Field notes and observation markers, saved on this device. Storage failures leave an in-memory journal. */
export function useFieldNotes() {
  const [notes, setNotes] = useState<FieldNote[]>(read)
  const [saved, setSaved] = useState(true)
  useEffect(() => {
    try { localStorage.setItem(FIELD_NOTES_KEY, JSON.stringify(notes)); setSaved(true) } catch { setSaved(false) }
  }, [notes])
  return {
    notes, saved,
    add: useCallback((note: FieldNote) => setNotes(list => addFieldNote(list, note)), []),
    update: useCallback((id: string, text: string) => setNotes(list => updateFieldNote(list, id, text)), []),
    remove: useCallback((id: string) => setNotes(list => removeFieldNote(list, id)), []),
  }
}
export type FieldNotesStore = ReturnType<typeof useFieldNotes>
