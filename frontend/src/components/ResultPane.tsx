import { formatResult } from '../lib/formatResult'
import type { CalcError } from '../types'
import styles from './ResultPane.module.css'
import { AlertIcon, CopyIcon } from './icons'

/** What the pane is showing. */
export type ResultView =
  | { kind: 'idle' }
  | { kind: 'result'; expression: string; result: number }
  | { kind: 'error'; expression: string; error: CalcError }

const EXAMPLES = ['2 * (3 + 4) ^ 2', 'sqrt(16) + 10%', '(1 + 2) / 3']

interface ResultPaneProps {
  view: ResultView
  /** True while a newer answer is on its way; the current one is dimmed. */
  stale: boolean
  onCopy: () => void
  onExample: (expression: string) => void
}

/** The detail pane: the big result, the error, or a short guide when idle. */
export function ResultPane({ view, stale, onCopy, onExample }: ResultPaneProps) {
  return (
    <div className={styles.pane} aria-live="polite" data-stale={stale || undefined}>
      {view.kind === 'idle' && (
        <div className={styles.idle}>
          <p className={styles.idleTitle}>What do you want to calculate?</p>
          <p className={styles.idleBody}>
            Use + − × ÷ ^ %, parentheses, and sqrt( ). Results appear as you type.
          </p>
          <div className={styles.examples}>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className={styles.example} onClick={() => onExample(example)}>
                {example}
              </button>
            ))}
          </div>
        </div>
      )}

      {view.kind === 'result' && <Result expression={view.expression} result={view.result} onCopy={onCopy} />}

      {view.kind === 'error' && <ErrorView expression={view.expression} error={view.error} />}
    </div>
  )
}

function Result({ expression, result, onCopy }: { expression: string; result: number; onCopy: () => void }) {
  const text = formatResult(result)
  return (
    <div className={styles.result}>
      <p className={styles.expression}>{expression}</p>
      <div className={styles.valueRow}>
        <span className={styles.equals} aria-hidden="true">
          =
        </span>
        <output className={styles.value} data-size={sizeFor(text)} aria-label={`Result: ${text}`}>
          {text}
        </output>
        <button type="button" className={styles.copy} aria-label="Copy result" onClick={onCopy}>
          <CopyIcon size={16} />
        </button>
      </div>
    </div>
  )
}

/** Shrinks long numbers so they always fit on one line. */
function sizeFor(text: string): 'xl' | 'lg' | 'md' | 'sm' {
  if (text.length <= 8) return 'xl'
  if (text.length <= 12) return 'lg'
  if (text.length <= 17) return 'md'
  return 'sm'
}

function ErrorView({ expression, error }: { expression: string; error: CalcError }) {
  const chars = Array.from(expression)
  const position = error.position
  const hasPosition = position !== undefined && position >= 0 && position <= chars.length

  // A syntax error at the very end means the expression is simply unfinished
  // ("2 +"). That is normal while typing, so it is shown as a calm hint
  // instead of an alarming error.
  const incomplete = error.code === 'SYNTAX_ERROR' && position === chars.length

  return (
    <div className={styles.error} data-tone={incomplete ? 'hint' : 'error'}>
      <p className={styles.expression}>
        {hasPosition ? (
          <>
            {chars.slice(0, position).join('')}
            <mark className={styles.mark} data-end={position === chars.length || undefined}>
              {chars[position] ?? ''}
            </mark>
            {chars.slice(position + 1).join('')}
          </>
        ) : (
          expression
        )}
      </p>
      <p className={styles.message}>
        {!incomplete && <AlertIcon size={16} />}
        <span>{incomplete ? 'Keep typing: ' + error.message : capitalize(error.message)}</span>
      </p>
    </div>
  )
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
