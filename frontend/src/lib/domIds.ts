/** DOM id of the history list; the expression input points at it. */
export const HISTORY_LIST_ID = 'history-list'

/** DOM id of a history option; the input's aria-activedescendant uses it. */
export function optionId(entryId: string): string {
  return `history-option-${entryId}`
}
