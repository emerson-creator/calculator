import { useEffect } from 'react'
import { optionId } from '../lib/domIds'
import { formatResult } from '../lib/formatResult'
import { groupHistory } from '../state/calculatorReducer'
import type { HistoryEntry } from '../types'
import styles from './HistoryList.module.css'
import { PinIcon } from './icons'

interface HistoryListProps {
  id: string
  history: HistoryEntry[]
  selectedId: string | null
  /** Called when an entry is clicked. */
  onPick: (id: string) => void
}

/** The left pane: saved calculations, pinned ones first. */
export function HistoryList({ id, history, selectedId, onPick }: HistoryListProps) {
  const { pinned, recent } = groupHistory(history)

  // Keep the highlighted row visible while moving with the arrow keys.
  useEffect(() => {
    if (selectedId === null) return
    document.getElementById(optionId(selectedId))?.scrollIntoView?.({ block: 'nearest' })
  }, [selectedId])

  const renderSection = (title: string, entries: HistoryEntry[]) =>
    entries.length > 0 && (
      <div role="group" aria-label={title} className={styles.section}>
        <div className={styles.heading} aria-hidden="true">
          {title}
        </div>
        {entries.map((entry) => (
          <div
            key={entry.id}
            id={optionId(entry.id)}
            role="option"
            aria-selected={entry.id === selectedId}
            className={styles.row}
            onClick={() => onPick(entry.id)}
          >
            <span className={styles.expression}>{entry.expression}</span>
            {entry.pinned && (
              <span className={styles.pin}>
                <PinIcon size={13} />
                <span className="sr-only">Pinned</span>
              </span>
            )}
            <span className={styles.result}>{formatResult(entry.result)}</span>
          </div>
        ))}
      </div>
    )

  return (
    <div id={id} role="listbox" aria-label="History" className={styles.list}>
      {history.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Your history lives here</p>
          <p className={styles.emptyBody}>Press Enter to save a calculation and reuse it later.</p>
        </div>
      ) : (
        <>
          {renderSection('Pinned', pinned)}
          {renderSection('Recent', recent)}
        </>
      )}
    </div>
  )
}
