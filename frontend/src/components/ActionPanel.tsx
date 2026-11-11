import { type KeyboardEvent, type ReactNode, useEffect, useRef } from 'react'
import styles from './ActionPanel.module.css'
import { Kbd } from './Kbd'

/** One entry of the menu. It is plain data: the parent decides what an id does. */
export interface ActionItem<Id extends string = string> {
  id: Id
  label: string
  icon: ReactNode
  /** Keys of the shortcut, shown as hints. */
  shortcut?: string[]
  danger?: boolean
}

interface ActionPanelProps<Id extends string> {
  actions: ActionItem<Id>[]
  /** Called with the id of the chosen action, after the panel has closed. */
  onRun: (id: Id) => void
  onClose: () => void
}

/** Floating menu with everything that can be done with the current item. */
export function ActionPanel<Id extends string>({ actions, onRun, onClose }: ActionPanelProps<Id>) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Move the focus into the menu when it opens.
  useEffect(() => {
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    ;(first ?? menuRef.current)?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const current = items.indexOf(document.activeElement as HTMLElement)

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        event.stopPropagation()
        items[(current + 1) % items.length]?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        event.stopPropagation()
        items[(current - 1 + items.length) % items.length]?.focus()
        break
      case 'Home':
        event.preventDefault()
        items[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        items[items.length - 1]?.focus()
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        onClose()
        break
      case 'Tab':
        // The menu is modal while open; Tab closes it instead of leaving it behind.
        event.preventDefault()
        onClose()
        break
      case 'Enter':
      case ' ':
        // Let the focused button handle it, but keep it away from the
        // window-level shortcuts (Enter would also save the calculation).
        event.stopPropagation()
        break
    }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div
        ref={menuRef}
        className={styles.panel}
        role="menu"
        aria-label="Actions"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {actions.length === 0 && <p className={styles.empty}>Type an expression to see actions.</p>}
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            role="menuitem"
            className={styles.item}
            data-danger={action.danger || undefined}
            onClick={() => {
              onClose()
              onRun(action.id)
            }}
          >
            <span className={styles.icon}>{action.icon}</span>
            <span className={styles.label}>{action.label}</span>
            {action.shortcut && (
              <span className={styles.shortcut} aria-hidden="true">
                {action.shortcut.map((key) => (
                  <Kbd key={key}>{key}</Kbd>
                ))}
              </span>
            )}
          </button>
        ))}
      </div>
    </>
  )
}
