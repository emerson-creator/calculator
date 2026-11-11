import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useCalculator } from '../hooks/useCalculator'
import { HISTORY_LIST_ID, optionId } from '../lib/domIds'
import { plainResult } from '../lib/formatResult'
import { altKey, modKey } from '../lib/platform'
import { ActionPanel, type ActionItem } from './ActionPanel'
import styles from './Calculator.module.css'
import { CommandBar } from './CommandBar'
import { HistoryList } from './HistoryList'
import { Kbd } from './Kbd'
import { Keypad, type KeyAction } from './Keypad'
import { ResultPane, type ResultView } from './ResultPane'
import {
  ArrowUpLeftIcon,
  BookmarkIcon,
  CloseIcon,
  CopyIcon,
  PinIcon,
  TrashIcon,
} from './icons'

/** How long a confirmation such as "Copied result" stays in the footer. */
const TOAST_MS = 1800

type ActionId =
  | 'use'
  | 'save'
  | 'copy-result'
  | 'copy-expression'
  | 'pin'
  | 'remove'
  | 'clear-input'
  | 'clear-history'

interface CalculatorProps {
  /** Delay before the expression is sent to the backend. Tests set it to 0. */
  debounceMs?: number
}

/**
 * The calculator window: a command bar on top, the history on the left, the
 * result and keypad on the right, and a footer with the available shortcuts.
 * All arithmetic happens in the backend; this component only orchestrates.
 */
export function Calculator({ debounceMs }: CalculatorProps) {
  const { state, actions } = useCalculator({ debounceMs })
  const { input, preview, evaluating, history, selectedId, actionsOpen } = state

  const inputRef = useRef<HTMLInputElement>(null)
  // Where to put the caret after the keypad edits the input.
  const pendingCaret = useRef<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const expression = input.trim()
  const selectedEntry = history.find((entry) => entry.id === selectedId) ?? null
  /** True when Enter would bring the highlighted entry back into the input. */
  const canUseSelected = selectedEntry !== null && selectedEntry.expression !== expression

  let view: ResultView = { kind: 'idle' }
  if (selectedEntry) {
    view = { kind: 'result', expression: selectedEntry.expression, result: selectedEntry.result }
  } else if (preview.status === 'success') {
    view = { kind: 'result', expression: preview.expression, result: preview.result }
  } else if (preview.status === 'error') {
    view = { kind: 'error', expression: preview.expression, error: preview.error }
  }
  const shown = view.kind === 'result' ? view : null

  useLayoutEffect(() => {
    if (pendingCaret.current === null) return
    inputRef.current?.setSelectionRange(pendingCaret.current, pendingCaret.current)
    pendingCaret.current = null
  }, [input])

  useEffect(() => {
    if (toast === null) return
    const timer = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(timer)
  }, [toast])

  const focusInput = () => inputRef.current?.focus()

  const copy = (text: string, what: string) => {
    const done = () => setToast(`Copied ${what}`)
    const failed = () => setToast(`Couldn't copy the ${what}`)
    if (!navigator.clipboard) {
      failed()
      return
    }
    navigator.clipboard.writeText(text).then(done, failed)
  }

  const copyResult = () => {
    if (shown) copy(plainResult(shown.result), 'result')
  }

  /** Enter: reuse the highlighted entry, or save the current calculation. */
  const submit = () => {
    if (selectedEntry) {
      if (canUseSelected) actions.load(selectedEntry.id)
    } else {
      actions.commit()
    }
    focusInput()
  }

  const closeActions = () => {
    actions.toggleActions(false)
    focusInput()
  }

  /** Applies a keypad key at the caret, like typing it. */
  const handleKey = (key: KeyAction) => {
    if (key.type === 'submit') {
      submit()
      return
    }
    if (key.type === 'clear') {
      actions.clearInput()
      focusInput()
      return
    }

    const el = inputRef.current
    const start = el?.selectionStart ?? input.length
    const end = el?.selectionEnd ?? input.length
    let next: string
    let caret: number

    if (key.type === 'insert') {
      next = input.slice(0, start) + key.text + input.slice(end)
      caret = start + key.text.length
    } else if (start !== end) {
      next = input.slice(0, start) + input.slice(end)
      caret = start
    } else {
      next = input.slice(0, Math.max(start - 1, 0)) + input.slice(end)
      caret = Math.max(start - 1, 0)
    }

    pendingCaret.current = caret
    actions.setInput(next)
    focusInput()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const mod = event.metaKey || event.ctrlKey

    if (mod && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      if (actionsOpen) closeActions()
      else actions.toggleActions(true)
      return
    }
    // While the action panel is open it owns the keyboard.
    if (actionsOpen) return

    if (event.altKey && !mod) {
      // event.code, because Option on macOS changes event.key ("ç" for C).
      if (event.code === 'KeyC' && shown) {
        event.preventDefault()
        copyResult()
      } else if (event.code === 'KeyP' && selectedEntry) {
        event.preventDefault()
        actions.togglePin(selectedEntry.id)
      } else if (event.key === 'Backspace' && selectedEntry) {
        event.preventDefault()
        actions.remove(selectedEntry.id)
      }
      return
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        actions.move('down')
        break
      case 'ArrowUp':
        event.preventDefault()
        actions.move('up')
        break
      case 'Enter':
        // On a focused button, Enter must press that button.
        if (event.target instanceof HTMLButtonElement) return
        event.preventDefault()
        submit()
        break
      case 'Escape':
        event.preventDefault()
        if (selectedEntry) actions.select(null)
        else actions.clearInput()
        break
    }
  }

  const actionItems: ActionItem<ActionId>[] = []
  if (canUseSelected) {
    actionItems.push({ id: 'use', label: 'Use expression', icon: <ArrowUpLeftIcon />, shortcut: ['\u21B5'] })
  }
  if (!selectedEntry && shown && !evaluating) {
    actionItems.push({ id: 'save', label: 'Save to history', icon: <BookmarkIcon />, shortcut: ['\u21B5'] })
  }
  if (shown) {
    actionItems.push(
      { id: 'copy-result', label: 'Copy result', icon: <CopyIcon />, shortcut: [altKey, 'C'] },
      { id: 'copy-expression', label: 'Copy expression', icon: <CopyIcon /> },
    )
  }
  if (selectedEntry) {
    actionItems.push(
      { id: 'pin', label: selectedEntry.pinned ? 'Unpin' : 'Pin', icon: <PinIcon />, shortcut: [altKey, 'P'] },
      {
        id: 'remove',
        label: 'Remove from history',
        icon: <TrashIcon />,
        shortcut: [altKey, '\u232B'],
        danger: true,
      },
    )
  }
  if (input !== '') {
    actionItems.push({ id: 'clear-input', label: 'Clear expression', icon: <CloseIcon />, shortcut: ['Esc'] })
  }
  if (history.some((entry) => !entry.pinned)) {
    actionItems.push({ id: 'clear-history', label: 'Clear history', icon: <TrashIcon />, danger: true })
  }

  const runAction = (id: ActionId) => {
    switch (id) {
      case 'use':
      case 'save':
        submit()
        break
      case 'copy-result':
        copyResult()
        break
      case 'copy-expression':
        if (shown) copy(shown.expression, 'expression')
        break
      case 'pin':
        if (selectedEntry) actions.togglePin(selectedEntry.id)
        break
      case 'remove':
        if (selectedEntry) actions.remove(selectedEntry.id)
        break
      case 'clear-input':
        actions.clearInput()
        break
      case 'clear-history':
        actions.clearHistory()
        break
    }
  }

  // The footer advertises what Enter does right now, if anything.
  let primaryLabel: string | null = null
  if (canUseSelected) primaryLabel = 'Use expression'
  else if (!selectedEntry && expression !== '' && preview.status !== 'error') primaryLabel = 'Save'


  return (
    <section className={styles.window} aria-label="Calculator" onKeyDown={handleKeyDown}>
      <CommandBar
        value={input}
        evaluating={evaluating}
        activeOptionId={selectedEntry ? optionId(selectedEntry.id) : undefined}
        listId={HISTORY_LIST_ID}
        inputRef={inputRef}
        onChange={actions.setInput}
        onClear={() => {
          actions.clearInput()
          focusInput()
        }}
      />

      <div className={styles.body}>
        <aside className={styles.history}>
          <div className={styles.historyScroll}>
            <HistoryList
              id={HISTORY_LIST_ID}
              history={history}
              selectedId={selectedId}
              onPick={(id) => {
                actions.load(id)
                focusInput()
              }}
            />
          </div>
        </aside>

        <div className={styles.detail}>
          <ResultPane
            view={view}
            stale={evaluating && !selectedEntry}
            onCopy={copyResult}
            onExample={(example) => {
              actions.setInput(example)
              focusInput()
            }}
          />
          <Keypad onKey={handleKey} />
        </div>
      </div>

      <footer className={styles.footer}>
        <div className={styles.status} role="status">
          {toast ?? (
            <span className={styles.brand}>
              <span className={styles.brandDot} aria-hidden="true" />
              Calculator
            </span>
          )}
        </div>

        {primaryLabel && (
          <>
            <button type="button" className={styles.footerButton} onClick={submit}>
              {primaryLabel}
              <Kbd>{'↵'}</Kbd>
            </button>
            <span className={styles.divider} aria-hidden="true" />
          </>
        )}
        <button
          type="button"
          className={styles.footerButton}
          aria-haspopup="menu"
          aria-expanded={actionsOpen}
          onClick={() => (actionsOpen ? closeActions() : actions.toggleActions(true))}
        >
          Actions
          <span className={styles.keys} aria-hidden="true">
            <Kbd>{modKey}</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      </footer>

      {actionsOpen && <ActionPanel actions={actionItems} onRun={runAction} onClose={closeActions} />}
    </section>
  )
}
