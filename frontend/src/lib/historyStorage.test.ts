import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../types'
import { STORAGE_KEY, loadHistory, saveHistory } from './historyStorage'

const entry: HistoryEntry = { id: 'a', expression: '2 + 3', result: 5, pinned: true, createdAt: 10 }

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('historyStorage', () => {
  it('returns an empty history when nothing was saved', () => {
    expect(loadHistory()).toEqual([])
  })

  it('round-trips the history', () => {
    saveHistory([entry])
    expect(loadHistory()).toEqual([entry])
  })

  it('ignores data that is not valid JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    expect(loadHistory()).toEqual([])
  })

  it('ignores data that is not a list', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: 'a' }))
    expect(loadHistory()).toEqual([])
  })

  it('drops malformed entries and keeps the valid ones', () => {
    const stored = [
      entry,
      null,
      'text',
      { ...entry, id: 1 },
      { ...entry, expression: undefined },
      { ...entry, result: 'five' },
      { ...entry, result: null },
      { ...entry, pinned: 'yes' },
      { ...entry, createdAt: 'now' },
    ]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    expect(loadHistory()).toEqual([entry])
  })

  it('survives storage that throws on read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadHistory()).toEqual([])
  })

  it('survives storage that throws on write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveHistory([entry])).not.toThrow()
  })
})
