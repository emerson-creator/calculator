/** True on Apple platforms, where shortcuts use Command and Option. */
export const isApple: boolean =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform)

/** Label of the main modifier key: Command on Apple devices, Ctrl elsewhere. */
export const modKey = isApple ? '⌘' : 'Ctrl'

/** Label of the Alt / Option key. */
export const altKey = isApple ? '⌥' : 'Alt'

/** Creates an id for a history entry. */
export function newId(): string {
  // randomUUID only exists in secure contexts (https or localhost).
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
