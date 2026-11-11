import { useEffect, useMemo, useReducer } from 'react'
import { evaluate, isAbortError, toCalcError } from '../api/calculatorClient'
import { loadHistory, saveHistory } from '../lib/historyStorage'
import { newId } from '../lib/platform'
import { type State, calculatorReducer, initialState } from '../state/calculatorReducer'

export interface CalculatorActions {
  /** Replaces the text of the command bar. */
  setInput: (value: string) => void
  /** Empties the command bar. */
  clearInput: () => void
  /** Saves the current expression and its result to the history. */
  commit: () => void
  /** Puts a history entry back into the command bar. */
  load: (id: string) => void
  /** Highlights a history entry, or none. */
  select: (id: string | null) => void
  /** Moves the highlight through the history list. */
  move: (direction: 'up' | 'down') => void
  togglePin: (id: string) => void
  remove: (id: string) => void
  /** Removes every entry that is not pinned. */
  clearHistory: () => void
  /** Opens or closes the action panel; toggles when `open` is omitted. */
  toggleActions: (open?: boolean) => void
}

export interface UseCalculatorOptions {
  /** How long the input must rest before it is sent to the backend. */
  debounceMs?: number
}

/**
 * Connects the pure reducer to the outside world: it asks the backend for the
 * value of the expression as the user types, and persists the history.
 */
export function useCalculator({ debounceMs = 150 }: UseCalculatorOptions = {}): {
  state: State
  actions: CalculatorActions
} {
  const [state, dispatch] = useReducer(calculatorReducer, undefined, () => initialState(loadHistory()))

  const expression = state.input.trim()
  const { evaluating } = state

  useEffect(() => {
    if (!evaluating) return

    const controller = new AbortController()
    // Set by the cleanup. An answer can already be on its way back when the
    // request is aborted; this makes sure a superseded request changes nothing.
    let superseded = false

    const timer = setTimeout(() => {
      evaluate(expression, controller.signal).then(
        (result) => {
          if (superseded) return
          dispatch({ type: 'evaluation/succeeded', expression, result })
        },
        (err: unknown) => {
          if (superseded || isAbortError(err)) return
          dispatch({ type: 'evaluation/failed', expression, error: toCalcError(err) })
        },
      )
    }, debounceMs)

    // Typing again cancels both the pending timer and the request in flight,
    // so an old answer can never overwrite a newer one.
    return () => {
      superseded = true
      clearTimeout(timer)
      controller.abort()
    }
  }, [expression, evaluating, debounceMs])

  useEffect(() => {
    saveHistory(state.history)
  }, [state.history])

  const actions = useMemo<CalculatorActions>(
    () => ({
      setInput: (value) => dispatch({ type: 'input/changed', value }),
      clearInput: () => dispatch({ type: 'input/cleared' }),
      // If the answer is still on its way, the reducer keeps the request and
      // carries it out when the answer arrives.
      commit: () => dispatch({ type: 'history/committed', id: newId(), now: Date.now() }),
      load: (id) => dispatch({ type: 'history/loaded', id }),
      select: (id) => dispatch({ type: 'history/selected', id }),
      move: (direction) => dispatch({ type: 'history/moved', direction }),
      togglePin: (id) => dispatch({ type: 'history/pinToggled', id }),
      remove: (id) => dispatch({ type: 'history/removed', id }),
      clearHistory: () => dispatch({ type: 'history/cleared' }),
      toggleActions: (open) => dispatch({ type: 'actions/toggled', open }),
    }),
    [],
  )

  return { state, actions }
}
