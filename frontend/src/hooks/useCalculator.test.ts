import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../lib/historyStorage'
import { mockBackend, sentExpressions } from '../test/mockBackend'
import { useCalculator } from './useCalculator'

const DEBOUNCE = 150

/** Lets the debounce timer fire and the fake response settle. */
async function settle(ms = DEBOUNCE) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useCalculator', () => {
  it('waits for the input to rest before asking the backend', async () => {
    const fetchMock = mockBackend({ '2 + 3': 5 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2'))
    await settle(DEBOUNCE - 1)
    act(() => result.current.actions.setInput('2 +'))
    await settle(DEBOUNCE - 1)
    act(() => result.current.actions.setInput('2 + 3'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.state.evaluating).toBe(true)

    await settle()
    expect(sentExpressions(fetchMock)).toEqual(['2 + 3'])
    expect(result.current.state.preview).toEqual({ status: 'success', expression: '2 + 3', result: 5 })
    expect(result.current.state.evaluating).toBe(false)
  })

  it('sends the expression trimmed', async () => {
    const fetchMock = mockBackend({ '2 + 3': 5 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('  2 + 3  '))
    await settle()

    expect(sentExpressions(fetchMock)).toEqual(['2 + 3'])
  })

  it('does not ask again for an expression it already has the answer to', async () => {
    const fetchMock = mockBackend({ '2 + 3': 5 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 + 3'))
    await settle()
    act(() => result.current.actions.setInput('2 + 3 '))
    await settle()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never asks the backend about an empty input', async () => {
    const fetchMock = mockBackend({})
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('   '))
    await settle()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.state.preview).toEqual({ status: 'idle' })
  })

  it('aborts the request in flight when the input changes', async () => {
    const signals: AbortSignal[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => {
        const signal = init!.signal!
        signals.push(signal)
        // A response that only ends when it is aborted, like a slow network.
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
      }),
    )
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 + 3'))
    await settle()
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)

    act(() => result.current.actions.setInput('2 + 30'))
    expect(signals[0].aborted).toBe(true)

    // The aborted request must not surface as an error.
    await settle()
    expect(result.current.state.preview).toEqual({ status: 'idle' })
    expect(result.current.state.evaluating).toBe(true)
  })

  it('ignores a late answer from a superseded request, even one that ignores the abort', async () => {
    // Responses are released by hand and do not react to the abort signal:
    // the worst case, where the old answer was already on its way back.
    const pending: Array<(response: Response) => void> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve))),
    )
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 +'))
    await settle()
    act(() => result.current.actions.setInput('2 + 3'))
    act(() => result.current.actions.commit())
    await settle()
    expect(pending).toHaveLength(2)

    // The old request fails late. It must neither show up nor cancel the save.
    const error = { code: 'SYNTAX_ERROR', message: 'unexpected end of expression', position: 3 }
    pending[0](new Response(JSON.stringify({ error }), { status: 400 }))
    await settle(0)
    expect(result.current.state.preview).toEqual({ status: 'idle' })

    pending[1](new Response(JSON.stringify({ result: 5 }), { status: 200 }))
    await settle(0)
    expect(result.current.state.preview).toMatchObject({ status: 'success', result: 5 })
    expect(result.current.state.history).toMatchObject([{ expression: '2 + 3', result: 5 }])
  })

  it('stores failures as the preview', async () => {
    mockBackend({ '1 / 0': { status: 422, code: 'DIVISION_BY_ZERO', message: 'cannot divide by zero' } })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('1 / 0'))
    await settle()

    expect(result.current.state.preview).toEqual({
      status: 'error',
      expression: '1 / 0',
      error: { code: 'DIVISION_BY_ZERO', message: 'cannot divide by zero' },
    })
  })

  it('commits right away when the answer is already there', async () => {
    mockBackend({ '2 + 3': 5 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 + 3'))
    await settle()
    act(() => result.current.actions.commit())

    expect(result.current.state.history).toMatchObject([{ expression: '2 + 3', result: 5 }])
  })

  it('remembers a commit requested while the answer is on its way', async () => {
    mockBackend({ '2 + 3': 5 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 + 3'))
    act(() => result.current.actions.commit())
    expect(result.current.state.history).toEqual([])

    await settle()
    expect(result.current.state.history).toMatchObject([{ expression: '2 + 3', result: 5 }])
  })

  it('forgets that pending commit if the user keeps typing', async () => {
    mockBackend({ '2 + 3': 5, '2 + 30': 32 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 + 3'))
    act(() => result.current.actions.commit())
    act(() => result.current.actions.setInput('2 + 30'))
    await settle()

    expect(result.current.state.preview).toMatchObject({ status: 'success', result: 32 })
    expect(result.current.state.history).toEqual([])
  })

  it('forgets that pending commit if the expression turns out to be invalid', async () => {
    mockBackend({ '2 + 3': 5 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => result.current.actions.setInput('2 +'))
    act(() => result.current.actions.commit())
    await settle()
    expect(result.current.state.preview.status).toBe('error')

    act(() => result.current.actions.setInput('2 + 3'))
    await settle()
    expect(result.current.state.history).toEqual([])
  })

  it('persists the history and restores it on the next mount', async () => {
    mockBackend({ '2 + 3': 5 })
    const first = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))

    act(() => first.result.current.actions.setInput('2 + 3'))
    await settle()
    act(() => first.result.current.actions.commit())

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toMatchObject([{ expression: '2 + 3', result: 5 }])
    first.unmount()

    const second = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))
    expect(second.result.current.state.history).toMatchObject([{ expression: '2 + 3', result: 5 }])
  })

  it('exposes the remaining state transitions as actions', async () => {
    mockBackend({ '2 + 3': 5, '7 * 8': 56 })
    const { result } = renderHook(() => useCalculator({ debounceMs: DEBOUNCE }))
    const { actions } = result.current

    for (const expression of ['2 + 3', '7 * 8']) {
      act(() => actions.setInput(expression))
      await settle()
      act(() => result.current.actions.commit())
    }
    const [second, first] = result.current.state.history

    act(() => actions.clearInput())
    expect(result.current.state.input).toBe('')

    act(() => actions.select(first.id))
    expect(result.current.state.selectedId).toBe(first.id)

    act(() => actions.move('up'))
    expect(result.current.state.selectedId).toBe(second.id)

    act(() => actions.load(first.id))
    expect(result.current.state.input).toBe('2 + 3')

    act(() => actions.togglePin(first.id))
    act(() => actions.clearHistory())
    expect(result.current.state.history.map((e) => e.id)).toEqual([first.id])

    act(() => actions.remove(first.id))
    expect(result.current.state.history).toEqual([])

    act(() => actions.toggleActions())
    expect(result.current.state.actionsOpen).toBe(true)
    act(() => actions.toggleActions(false))
    expect(result.current.state.actionsOpen).toBe(false)
  })
})
