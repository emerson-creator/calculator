import type { ReactNode } from 'react'
import styles from './Keypad.module.css'
import { BackspaceIcon } from './icons'

/** What pressing a key does. */
export type KeyAction =
  | { type: 'insert'; text: string }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'submit' }

interface KeyDef {
  /** What the key shows. */
  label: ReactNode
  /** Accessible name; needed when the label is a symbol or an icon. */
  name: string
  action: KeyAction
  variant?: 'digit' | 'operator' | 'utility' | 'submit'
}

const insert = (text: string): KeyAction => ({ type: 'insert', text })
const digit = (d: string): KeyDef => ({ label: d, name: d, action: insert(d) })

/**
 * Keys in visual order, four per row. Labels use typographic symbols; what
 * gets inserted is the plain syntax the backend understands.
 */
const KEYS: KeyDef[] = [
  { label: 'C', name: 'Clear', action: { type: 'clear' }, variant: 'utility' },
  { label: '(', name: 'Open parenthesis', action: insert('('), variant: 'utility' },
  { label: ')', name: 'Close parenthesis', action: insert(')'), variant: 'utility' },
  { label: <BackspaceIcon size={18} />, name: 'Backspace', action: { type: 'backspace' }, variant: 'utility' },

  digit('7'),
  digit('8'),
  digit('9'),
  { label: '÷', name: 'Divide', action: insert('/'), variant: 'operator' },

  digit('4'),
  digit('5'),
  digit('6'),
  { label: '×', name: 'Multiply', action: insert('*'), variant: 'operator' },

  digit('1'),
  digit('2'),
  digit('3'),
  { label: '−', name: 'Subtract', action: insert('-'), variant: 'operator' },

  digit('0'),
  { label: '.', name: 'Decimal point', action: insert('.') },
  { label: '%', name: 'Percent', action: insert('%'), variant: 'operator' },
  { label: '+', name: 'Add', action: insert('+'), variant: 'operator' },

  { label: '√', name: 'Square root', action: insert('sqrt('), variant: 'operator' },
  {
    label: (
      <span>
        x<sup>y</sup>
      </span>
    ),
    name: 'Power',
    action: insert('^'),
    variant: 'operator',
  },
  { label: '=', name: 'Equals', action: { type: 'submit' }, variant: 'submit' },
]

/** On-screen keys, for touch devices and for anyone who prefers clicking. */
export function Keypad({ onKey }: { onKey: (action: KeyAction) => void }) {
  return (
    <div className={styles.keypad} role="group" aria-label="Keypad">
      {KEYS.map((key) => (
        <button
          key={key.name}
          type="button"
          className={styles.key}
          data-variant={key.variant ?? 'digit'}
          aria-label={key.name}
          // Keep the focus (and the caret) in the expression input.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onKey(key.action)}
        >
          {key.label}
        </button>
      ))}
    </div>
  )
}
