import type { CalcError, HistoryEntry } from '../types'

/** Same limit as the backend (expression.MaxLength), counted in characters. */
export const MAX_EXPRESSION_LENGTH = 256

/** Most entries kept in the history; the oldest unpinned one is dropped first. */
export const MAX_HISTORY = 50

/** What the detail pane shows for the expression currently in the input. */
export type Preview =
  | { status: 'idle' }
  | { status: 'success'; expression: string; result: number }
  | { status: 'error'; expression: string; error: CalcError }

export interface State {
  /** Raw text of the command bar. */
  input: string
  /** Last answer received from the backend. May lag behind `input` while typing. */
  preview: Preview
  /** True while `input` has changed and its answer has not arrived yet. */
  evaluating: boolean
  /** Saved calculations, newest first. */
  history: HistoryEntry[]
  /** History entry highlighted in the list, or null to show the live preview. */
  selectedId: string | null
  /** Whether the action panel is open. */
  actionsOpen: boolean
  /**
   * A save requested while the answer was still on its way (Enter pressed
   * right after typing). It is carried out when that answer arrives.
   */
  pendingCommit: { id: string; now: number } | null
}

export type Action =
  | { type: 'input/changed'; value: string }
  | { type: 'input/cleared' }
  | { type: 'evaluation/succeeded'; expression: string; result: number }
  | { type: 'evaluation/failed'; expression: string; error: CalcError }
  | { type: 'history/committed'; id: string; now: number }
  | { type: 'history/loaded'; id: string }
  | { type: 'history/selected'; id: string | null }
  | { type: 'history/moved'; direction: 'up' | 'down' }
  | { type: 'history/pinToggled'; id: string }
  | { type: 'history/removed'; id: string }
  | { type: 'history/cleared' }
  | { type: 'actions/toggled'; open?: boolean }

export function initialState(history: HistoryEntry[] = []): State {
  return {
    input: '',
    preview: { status: 'idle' },
    evaluating: false,
    history,
    selectedId: null,
    actionsOpen: false,
    pendingCommit: null,
  }
}

/**
 * Pure state machine of the calculator. It does no I/O: the hook that owns it
 * performs the requests and persistence, and reports back through actions.
 * Anything that would make it impure (ids, clock) arrives inside the action.
 */
export function calculatorReducer(state: State, action: Action): State {
  switch (action.type) {
    case 'input/changed': {
      const input = clamp(action.value)
      const expression = input.trim()
      const alreadyAnswered = state.preview.status !== 'idle' && state.preview.expression === expression

      return {
        ...state,
        input,
        selectedId: null,
        preview: expression === '' ? { status: 'idle' } : state.preview,
        evaluating: expression !== '' && !alreadyAnswered,
        pendingCommit: null,
      }
    }

    case 'input/cleared':
      return {
        ...state,
        input: '',
        preview: { status: 'idle' },
        evaluating: false,
        selectedId: null,
        pendingCommit: null,
      }

    case 'evaluation/succeeded': {
      if (isStale(state, action.expression)) return state
      const answered: State = {
        ...state,
        evaluating: false,
        pendingCommit: null,
        preview: { status: 'success', expression: action.expression, result: action.result },
      }
      const { pendingCommit } = state
      return pendingCommit ? saveToHistory(answered, pendingCommit.id, pendingCommit.now) : answered
    }

    case 'evaluation/failed':
      if (isStale(state, action.expression)) return state
      return {
        ...state,
        evaluating: false,
        pendingCommit: null,
        preview: { status: 'error', expression: action.expression, error: action.error },
      }

    case 'history/committed':
      // The answer is not here yet: remember the request instead of losing it.
      if (state.evaluating) return { ...state, pendingCommit: { id: action.id, now: action.now } }
      return saveToHistory(state, action.id, action.now)

    case 'history/loaded': {
      const entry = state.history.find((e) => e.id === action.id)
      if (!entry) return state
      return {
        ...state,
        input: entry.expression,
        preview: { status: 'success', expression: entry.expression, result: entry.result },
        evaluating: false,
        pendingCommit: null,
        selectedId: entry.id,
      }
    }

    case 'history/selected':
      return { ...state, selectedId: action.id }

    case 'history/moved': {
      const order = visibleOrder(state.history)
      if (order.length === 0) return state

      const current = state.selectedId === null ? -1 : order.indexOf(state.selectedId)
      let next: number
      if (action.direction === 'down') {
        next = current < 0 ? 0 : Math.min(current + 1, order.length - 1)
      } else {
        next = current < 0 ? order.length - 1 : Math.max(current - 1, 0)
      }
      return { ...state, selectedId: order[next] }
    }

    case 'history/pinToggled':
      return {
        ...state,
        history: state.history.map((e) => (e.id === action.id ? { ...e, pinned: !e.pinned } : e)),
      }

    case 'history/removed':
      return {
        ...state,
        history: state.history.filter((e) => e.id !== action.id),
        selectedId: state.selectedId === action.id ? null : state.selectedId,
      }

    case 'history/cleared': {
      const history = state.history.filter((e) => e.pinned)
      const selectedStillThere = history.some((e) => e.id === state.selectedId)
      return { ...state, history, selectedId: selectedStillThere ? state.selectedId : null }
    }

    case 'actions/toggled':
      return { ...state, actionsOpen: action.open ?? !state.actionsOpen }
  }
}

/**
 * Saves the answered expression at the top of the history and selects it.
 * Does nothing unless the preview is a success for exactly what is in the input.
 */
function saveToHistory(state: State, id: string, now: number): State {
  const { preview } = state
  if (preview.status !== 'success' || preview.expression !== state.input.trim()) return state

  const existing = state.history.find((entry) => entry.expression === preview.expression)
  const entry: HistoryEntry = existing
    ? { ...existing, result: preview.result, createdAt: now }
    : { id, expression: preview.expression, result: preview.result, pinned: false, createdAt: now }

  const history = capHistory([entry, ...state.history.filter((e) => e !== existing)])
  return { ...state, history, selectedId: entry.id }
}

/** Answers for an expression that is no longer in the input are discarded. */
function isStale(state: State, expression: string): boolean {
  return expression !== state.input.trim()
}

/** Truncates to MAX_EXPRESSION_LENGTH characters (not UTF-16 units). */
function clamp(value: string): string {
  if (value.length <= MAX_EXPRESSION_LENGTH) return value
  return Array.from(value).slice(0, MAX_EXPRESSION_LENGTH).join('')
}

/**
 * Drops the oldest unpinned entries beyond MAX_HISTORY. Pinned entries are
 * never dropped, and neither is the first one, which is the entry just saved.
 * So the list only exceeds the limit when the user has pinned that many.
 */
function capHistory(history: HistoryEntry[]): HistoryEntry[] {
  const result = [...history]
  while (result.length > MAX_HISTORY) {
    let oldestUnpinned = result.length - 1
    while (oldestUnpinned > 0 && result[oldestUnpinned].pinned) oldestUnpinned--
    if (oldestUnpinned <= 0) break
    result.splice(oldestUnpinned, 1)
  }
  return result
}

/** Splits the history into the two sections of the list, keeping the order. */
export function groupHistory(history: HistoryEntry[]): { pinned: HistoryEntry[]; recent: HistoryEntry[] } {
  return {
    pinned: history.filter((e) => e.pinned),
    recent: history.filter((e) => !e.pinned),
  }
}

/** Ids in the order the list shows them: pinned first, then recent. */
export function visibleOrder(history: HistoryEntry[]): string[] {
  const { pinned, recent } = groupHistory(history)
  return [...pinned, ...recent].map((e) => e.id)
}
