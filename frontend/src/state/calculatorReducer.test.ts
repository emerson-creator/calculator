import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '../types'
import {
  type Action,
  MAX_EXPRESSION_LENGTH,
  MAX_HISTORY,
  type State,
  calculatorReducer,
  groupHistory,
  initialState,
  visibleOrder,
} from './calculatorReducer'

function reduce(state: State, ...actions: Action[]): State {
  return actions.reduce(calculatorReducer, state)
}

function entry(id: string, overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id, expression: `${id} + 0`, result: 0, pinned: false, createdAt: 0, ...overrides }
}

/** A state where `expression` was typed and the backend answered `result`. */
function answered(expression: string, result: number, history: HistoryEntry[] = []): State {
  return reduce(
    initialState(history),
    { type: 'input/changed', value: expression },
    { type: 'evaluation/succeeded', expression: expression.trim(), result },
  )
}

describe('initialState', () => {
  it('starts empty', () => {
    expect(initialState()).toEqual({
      input: '',
      preview: { status: 'idle' },
      evaluating: false,
      history: [],
      selectedId: null,
      actionsOpen: false,
      pendingCommit: null,
    })
  })

  it('starts with the history it is given', () => {
    const history = [entry('a')]
    expect(initialState(history).history).toBe(history)
  })
})

describe('input/changed', () => {
  it('stores the text and starts evaluating', () => {
    const state = reduce(initialState(), { type: 'input/changed', value: '2 + 3' })
    expect(state.input).toBe('2 + 3')
    expect(state.evaluating).toBe(true)
  })

  it('goes back to idle when the input becomes blank', () => {
    const state = reduce(answered('2 + 3', 5), { type: 'input/changed', value: '   ' })
    expect(state.preview).toEqual({ status: 'idle' })
    expect(state.evaluating).toBe(false)
  })

  it('keeps the previous answer while the new one is pending', () => {
    const state = reduce(answered('2 + 3', 5), { type: 'input/changed', value: '2 + 3 *' })
    expect(state.preview).toEqual({ status: 'success', expression: '2 + 3', result: 5 })
    expect(state.evaluating).toBe(true)
  })

  it('does not re-evaluate when only the whitespace around the text changed', () => {
    const state = reduce(answered('2 + 3', 5), { type: 'input/changed', value: '2 + 3  ' })
    expect(state.evaluating).toBe(false)
  })

  it('deselects the highlighted history entry', () => {
    const state = reduce(
      { ...initialState([entry('a')]), selectedId: 'a' },
      { type: 'input/changed', value: '1' },
    )
    expect(state.selectedId).toBeNull()
  })

  it('truncates to the maximum length', () => {
    const state = reduce(initialState(), {
      type: 'input/changed',
      value: '1'.repeat(MAX_EXPRESSION_LENGTH + 50),
    })
    expect(state.input).toHaveLength(MAX_EXPRESSION_LENGTH)
  })

  it('counts characters, not UTF-16 units, so it never splits a character', () => {
    const state = reduce(initialState(), {
      type: 'input/changed',
      value: '😀'.repeat(MAX_EXPRESSION_LENGTH + 5),
    })
    expect(Array.from(state.input)).toHaveLength(MAX_EXPRESSION_LENGTH)
    expect(state.input).not.toContain('�')
  })
})

describe('input/cleared', () => {
  it('resets the command bar but keeps the history', () => {
    const history = [entry('a')]
    const state = reduce(answered('1 + 1', 2, history), { type: 'input/cleared' })
    expect(state.input).toBe('')
    expect(state.preview).toEqual({ status: 'idle' })
    expect(state.evaluating).toBe(false)
    expect(state.selectedId).toBeNull()
    expect(state.history).toBe(history)
  })
})

describe('evaluation results', () => {
  it('stores a successful answer', () => {
    const typed = reduce(initialState(), { type: 'input/changed', value: ' 2 + 3 ' })
    const state = reduce(typed, { type: 'evaluation/succeeded', expression: '2 + 3', result: 5 })
    expect(state.preview).toEqual({ status: 'success', expression: '2 + 3', result: 5 })
    expect(state.evaluating).toBe(false)
  })

  it('stores a failure, keeping the position of syntax errors', () => {
    const error = { code: 'SYNTAX_ERROR', message: 'oops', position: 3 }
    const typed = reduce(initialState(), { type: 'input/changed', value: '2 + )' })
    const state = reduce(typed, { type: 'evaluation/failed', expression: '2 + )', error })
    expect(state.preview).toEqual({ status: 'error', expression: '2 + )', error })
    expect(state.evaluating).toBe(false)
  })

  it('ignores a success for an expression that is no longer in the input', () => {
    const typed = reduce(initialState(), { type: 'input/changed', value: '2 + 3 * 4' })
    const state = reduce(typed, { type: 'evaluation/succeeded', expression: '2 + 3', result: 5 })
    expect(state).toBe(typed)
  })

  it('ignores a failure for an expression that is no longer in the input', () => {
    const typed = reduce(initialState(), { type: 'input/changed', value: '2 + 3' })
    const error = { code: 'DIVISION_BY_ZERO', message: 'x' }
    const state = reduce(typed, { type: 'evaluation/failed', expression: '1 / 0', error })
    expect(state).toBe(typed)
  })

  it('ignores any answer once the input was cleared', () => {
    const cleared = reduce(initialState(), { type: 'input/changed', value: '1' }, { type: 'input/cleared' })
    const state = reduce(cleared, { type: 'evaluation/succeeded', expression: '1', result: 1 })
    expect(state).toBe(cleared)
  })
})

describe('history/committed', () => {
  it('saves the answered expression at the top and selects it', () => {
    const state = reduce(answered('2 + 3', 5, [entry('old')]), {
      type: 'history/committed',
      id: 'new',
      now: 1000,
    })
    expect(state.history.map((e) => e.id)).toEqual(['new', 'old'])
    expect(state.history[0]).toEqual({
      id: 'new',
      expression: '2 + 3',
      result: 5,
      pinned: false,
      createdAt: 1000,
    })
    expect(state.selectedId).toBe('new')
  })

  it('does nothing when the preview is not a success', () => {
    const idle = reduce(initialState(), { type: 'history/committed', id: 'x', now: 1 })
    expect(idle.history).toEqual([])

    const failed = reduce(
      initialState(),
      { type: 'input/changed', value: '1 / 0' },
      { type: 'evaluation/failed', expression: '1 / 0', error: { code: 'DIVISION_BY_ZERO', message: 'x' } },
      { type: 'history/committed', id: 'x', now: 1 },
    )
    expect(failed.history).toEqual([])
  })

  it('does nothing when the answer belongs to an earlier version of the input', () => {
    const state = reduce(
      answered('2 + 3', 5),
      { type: 'input/changed', value: '2 + 3 * 4' },
      { type: 'history/committed', id: 'x', now: 1 },
    )
    expect(state.history).toEqual([])
  })

  it('moves a repeated expression to the top instead of duplicating it', () => {
    const history = [
      entry('b', { expression: '9 * 9' }),
      entry('a', { expression: '2 + 3', result: 99, pinned: true, createdAt: 1 }),
    ]
    const state = reduce(answered('2 + 3', 5, history), { type: 'history/committed', id: 'ignored', now: 2000 })

    expect(state.history.map((e) => e.id)).toEqual(['a', 'b'])
    expect(state.history[0]).toEqual({
      id: 'a',
      expression: '2 + 3',
      result: 5,
      pinned: true,
      createdAt: 2000,
    })
    expect(state.selectedId).toBe('a')
  })

  it('drops the oldest unpinned entry beyond the limit', () => {
    const history = Array.from({ length: MAX_HISTORY }, (_, i) => entry(`e${i}`))
    const state = reduce(answered('7 + 7', 14, history), { type: 'history/committed', id: 'new', now: 1 })

    expect(state.history).toHaveLength(MAX_HISTORY)
    expect(state.history[0].id).toBe('new')
    expect(state.history.some((e) => e.id === `e${MAX_HISTORY - 1}`)).toBe(false)
  })

  it('never drops pinned entries, even the oldest', () => {
    const history = [
      ...Array.from({ length: MAX_HISTORY - 1 }, (_, i) => entry(`e${i}`)),
      entry('pinned-oldest', { pinned: true }),
    ]
    const state = reduce(answered('7 + 7', 14, history), { type: 'history/committed', id: 'new', now: 1 })

    expect(state.history).toHaveLength(MAX_HISTORY)
    expect(state.history.some((e) => e.id === 'pinned-oldest')).toBe(true)
    expect(state.history.some((e) => e.id === `e${MAX_HISTORY - 2}`)).toBe(false)
  })

  it('keeps the entry just saved even when every other entry is pinned', () => {
    const history = Array.from({ length: MAX_HISTORY }, (_, i) => entry(`p${i}`, { pinned: true }))
    const state = reduce(answered('7 + 7', 14, history), { type: 'history/committed', id: 'new', now: 1 })

    expect(state.history[0].id).toBe('new')
    expect(state.history).toHaveLength(MAX_HISTORY + 1)
    expect(state.history.some((e) => e.id === state.selectedId)).toBe(true)
  })
})

describe('saving before the answer arrives', () => {
  const typed = (value: string, history: HistoryEntry[] = []) =>
    reduce(initialState(history), { type: 'input/changed', value })

  it('remembers the request and saves when the answer arrives', () => {
    const waiting = reduce(typed('2 + 3'), { type: 'history/committed', id: 'new', now: 7 })
    expect(waiting.history).toEqual([])
    expect(waiting.pendingCommit).toEqual({ id: 'new', now: 7 })

    const state = reduce(waiting, { type: 'evaluation/succeeded', expression: '2 + 3', result: 5 })
    expect(state.history).toEqual([{ id: 'new', expression: '2 + 3', result: 5, pinned: false, createdAt: 7 }])
    expect(state.selectedId).toBe('new')
    expect(state.pendingCommit).toBeNull()
  })

  it('drops the request when the expression turns out to be invalid', () => {
    const state = reduce(
      typed('2 +'),
      { type: 'history/committed', id: 'new', now: 7 },
      { type: 'evaluation/failed', expression: '2 +', error: { code: 'SYNTAX_ERROR', message: 'x' } },
    )
    expect(state.pendingCommit).toBeNull()
    expect(state.history).toEqual([])
  })

  it('drops the request when the user keeps typing, clears, or loads an entry', () => {
    const waiting = reduce(typed('2 + 3', [entry('a')]), { type: 'history/committed', id: 'new', now: 7 })

    expect(reduce(waiting, { type: 'input/changed', value: '2 + 30' }).pendingCommit).toBeNull()
    expect(reduce(waiting, { type: 'input/cleared' }).pendingCommit).toBeNull()
    expect(reduce(waiting, { type: 'history/loaded', id: 'a' }).pendingCommit).toBeNull()
  })

  it('keeps the request when a stale answer arrives first', () => {
    const waiting = reduce(typed('2 + 3'), { type: 'history/committed', id: 'new', now: 7 })
    const state = reduce(waiting, {
      type: 'evaluation/failed',
      expression: '2 +',
      error: { code: 'SYNTAX_ERROR', message: 'x' },
    })
    expect(state.pendingCommit).toEqual({ id: 'new', now: 7 })
  })
})

describe('history/loaded', () => {
  it('puts the entry back in the input with its result', () => {
    const history = [entry('a', { expression: '2 * 8', result: 16 })]
    const state = reduce(initialState(history), { type: 'history/loaded', id: 'a' })

    expect(state.input).toBe('2 * 8')
    expect(state.preview).toEqual({ status: 'success', expression: '2 * 8', result: 16 })
    expect(state.evaluating).toBe(false)
    expect(state.selectedId).toBe('a')
  })

  it('ignores unknown ids', () => {
    const state = initialState([entry('a')])
    expect(reduce(state, { type: 'history/loaded', id: 'nope' })).toBe(state)
  })
})

describe('history selection', () => {
  const history = [entry('r1'), entry('p1', { pinned: true }), entry('r2'), entry('p2', { pinned: true })]
  // Visible order: pinned first, then recent -> p1, p2, r1, r2.

  it('selects and deselects explicitly', () => {
    const state = reduce(initialState(history), { type: 'history/selected', id: 'r2' })
    expect(state.selectedId).toBe('r2')
    expect(reduce(state, { type: 'history/selected', id: null }).selectedId).toBeNull()
  })

  it('moves down from nothing to the first visible entry', () => {
    const state = reduce(initialState(history), { type: 'history/moved', direction: 'down' })
    expect(state.selectedId).toBe('p1')
  })

  it('moves up from nothing to the last visible entry', () => {
    const state = reduce(initialState(history), { type: 'history/moved', direction: 'up' })
    expect(state.selectedId).toBe('r2')
  })

  it('walks the list in the order it is displayed, not the storage order', () => {
    const down = (s: State) => reduce(s, { type: 'history/moved', direction: 'down' })
    let state = initialState(history)
    const visited: Array<string | null> = []
    for (let i = 0; i < 4; i++) {
      state = down(state)
      visited.push(state.selectedId)
    }
    expect(visited).toEqual(['p1', 'p2', 'r1', 'r2'])
  })

  it('stops at both ends instead of wrapping', () => {
    const last = { ...initialState(history), selectedId: 'r2' }
    expect(reduce(last, { type: 'history/moved', direction: 'down' }).selectedId).toBe('r2')

    const first = { ...initialState(history), selectedId: 'p1' }
    expect(reduce(first, { type: 'history/moved', direction: 'up' }).selectedId).toBe('p1')
  })

  it('does nothing when the history is empty', () => {
    const state = initialState()
    expect(reduce(state, { type: 'history/moved', direction: 'down' })).toBe(state)
  })

  it('treats a selection that no longer exists like no selection', () => {
    const stale = { ...initialState(history), selectedId: 'gone' }
    expect(reduce(stale, { type: 'history/moved', direction: 'down' }).selectedId).toBe('p1')
  })
})

describe('history editing', () => {
  it('toggles the pin of an entry', () => {
    const state = initialState([entry('a'), entry('b')])
    const pinned = reduce(state, { type: 'history/pinToggled', id: 'a' })
    expect(pinned.history.map((e) => e.pinned)).toEqual([true, false])
    expect(reduce(pinned, { type: 'history/pinToggled', id: 'a' }).history[0].pinned).toBe(false)
  })

  it('removes an entry and deselects it if it was selected', () => {
    const state = { ...initialState([entry('a'), entry('b')]), selectedId: 'a' }
    const next = reduce(state, { type: 'history/removed', id: 'a' })
    expect(next.history.map((e) => e.id)).toEqual(['b'])
    expect(next.selectedId).toBeNull()
  })

  it('keeps the selection when another entry is removed', () => {
    const state = { ...initialState([entry('a'), entry('b')]), selectedId: 'a' }
    expect(reduce(state, { type: 'history/removed', id: 'b' }).selectedId).toBe('a')
  })

  it('clears every unpinned entry and keeps the pinned ones', () => {
    const state = initialState([entry('a'), entry('b', { pinned: true }), entry('c')])
    const next = reduce(state, { type: 'history/cleared' })
    expect(next.history.map((e) => e.id)).toEqual(['b'])
  })

  it('keeps the selection on clear only if that entry survived', () => {
    const base = initialState([entry('a'), entry('b', { pinned: true })])
    expect(reduce({ ...base, selectedId: 'b' }, { type: 'history/cleared' }).selectedId).toBe('b')
    expect(reduce({ ...base, selectedId: 'a' }, { type: 'history/cleared' }).selectedId).toBeNull()
  })
})

describe('actions/toggled', () => {
  it('toggles the action panel', () => {
    const open = reduce(initialState(), { type: 'actions/toggled' })
    expect(open.actionsOpen).toBe(true)
    expect(reduce(open, { type: 'actions/toggled' }).actionsOpen).toBe(false)
  })

  it('can be forced open or closed', () => {
    const open = reduce(initialState(), { type: 'actions/toggled', open: true })
    expect(reduce(open, { type: 'actions/toggled', open: true }).actionsOpen).toBe(true)
    expect(reduce(open, { type: 'actions/toggled', open: false }).actionsOpen).toBe(false)
  })
})

describe('selectors', () => {
  const history = [entry('r1'), entry('p1', { pinned: true }), entry('r2')]

  it('groupHistory splits pinned from recent, keeping order', () => {
    const { pinned, recent } = groupHistory(history)
    expect(pinned.map((e) => e.id)).toEqual(['p1'])
    expect(recent.map((e) => e.id)).toEqual(['r1', 'r2'])
  })

  it('visibleOrder lists pinned entries first', () => {
    expect(visibleOrder(history)).toEqual(['p1', 'r1', 'r2'])
  })
})
