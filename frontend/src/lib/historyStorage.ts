import type { HistoryEntry } from '../types'

/** Versioned so a future change of shape can ignore old data instead of crashing. */
export const STORAGE_KEY = 'calculator.history.v1'

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === 'string' &&
    typeof entry.expression === 'string' &&
    typeof entry.result === 'number' &&
    Number.isFinite(entry.result) &&
    typeof entry.pinned === 'boolean' &&
    typeof entry.createdAt === 'number'
  )
}

/**
 * Reads the saved history. Storage is outside our control (other tabs, manual
 * edits, private mode), so anything unexpected yields an empty history rather
 * than an exception.
 */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(isHistoryEntry) : []
  } catch {
    return []
  }
}

/** Saves the history. Failing to persist (quota, private mode) is not fatal. */
export function saveHistory(history: HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {
    // The history still works for this session; it just will not survive a reload.
  }
}
