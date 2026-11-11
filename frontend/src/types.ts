/** An error to show to the user, whatever its origin (API, network, ...). */
export interface CalcError {
  /** Machine-readable code, e.g. "SYNTAX_ERROR" or "DIVISION_BY_ZERO". */
  code: string
  /** Human-readable explanation. */
  message: string
  /**
   * Zero-based character offset of the problem within the expression. Only
   * the backend's SYNTAX_ERROR carries it.
   */
  position?: number
}

/** One saved calculation. */
export interface HistoryEntry {
  id: string
  expression: string
  result: number
  pinned: boolean
  /** Unix time in milliseconds of the last time the entry was calculated. */
  createdAt: number
}
