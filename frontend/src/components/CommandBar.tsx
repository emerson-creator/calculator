import type { Ref } from 'react'
import { MAX_EXPRESSION_LENGTH } from '../state/calculatorReducer'
import styles from './CommandBar.module.css'
import { CalculatorIcon, CloseIcon } from './icons'

interface CommandBarProps {
  value: string
  evaluating: boolean
  /** Id of the highlighted history option, for assistive technology. */
  activeOptionId?: string
  /** Id of the history list this input controls. */
  listId: string
  inputRef: Ref<HTMLInputElement>
  onChange: (value: string) => void
  onClear: () => void
}

/** The top bar: a single text input where the expression is typed. */
export function CommandBar({
  value,
  evaluating,
  activeOptionId,
  listId,
  inputRef,
  onChange,
  onClear,
}: CommandBarProps) {
  return (
    <div className={styles.bar}>
      <span className={styles.icon}>
        <CalculatorIcon size={20} />
      </span>
      <input
        ref={inputRef}
        className={styles.input}
        type="text"
        role="combobox"
        aria-label="Expression"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="none"
        aria-activedescendant={activeOptionId}
        placeholder="Type an expression, like 2 * (3 + 4) ^ 2"
        value={value}
        maxLength={MAX_EXPRESSION_LENGTH}
        autoFocus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
      />
      {evaluating && <span className={styles.spinner} role="status" aria-label="Calculating" />}
      {value !== '' && (
        <button type="button" className={styles.clear} aria-label="Clear expression" onClick={onClear}>
          <CloseIcon size={14} />
        </button>
      )}
    </div>
  )
}
