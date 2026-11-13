import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { GLOSSARY, glossaryTerm } from './lib/glossary'

/**
 * Beginner layer. `explain` turns on plain-language captions under the
 * decision numbers; `define(id)` opens the glossary at a term. Terms are
 * always clickable, so the layer costs an expert nothing when it is off.
 */
export const ExplainContext = createContext<{ explain: boolean; define: (id?: string) => void }>({
  explain: false,
  define: () => {},
})
export const useExplain = () => useContext(ExplainContext)

/** A clickable term: dotted underline, native tooltip, opens the glossary. */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const { define } = useExplain()
  const t = glossaryTerm(id)
  return (
    <button
      type="button"
      className="term"
      title={t ? `${t.term}: ${t.short}` : undefined}
      aria-label={t ? `Define ${t.term}` : undefined}
      onClick={(e) => {
        e.stopPropagation()
        define(id)
      }}
    >
      {children ?? t?.term ?? id}
    </button>
  )
}

/** A caption rendered only while Explain mode is on. */
export function Explain({ children, className = '' }: { children: ReactNode; className?: string }) {
  const { explain } = useExplain()
  if (!explain) return null
  return <p className={'explain-note ' + className}>{children}</p>
}

export function Glossary({ focus, onClose }: { focus: string | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  useEffect(() => {
    if (focus && focus !== 'all') document.getElementById('term-' + focus)?.scrollIntoView({ block: 'center' })
  }, [focus])
  return (
    <div className="workspace-modal glossary" role="dialog" aria-label="Glossary">
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">Plain-language glossary</p>
          <h2>What the words mean</h2>
        </div>
        <button data-panel-close className="tool-button" onClick={onClose}>
          <X size={14} /> Close glossary
        </button>
      </div>
      <div className="glossary-list">
        {GLOSSARY.map((t) => (
          <section key={t.id} id={'term-' + t.id} className={'glossary-item' + (focus === t.id ? ' is-focus' : '')}>
            <h3>{t.term}</h3>
            <p>{t.short}</p>
            {t.earth && (
              <p className="glossary-earth">
                <span>Earth intuition</span> {t.earth}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
