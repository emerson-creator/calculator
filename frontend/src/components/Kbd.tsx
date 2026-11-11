import type { ReactNode } from 'react'
import styles from './Kbd.module.css'

/** A single keyboard key, as shown in shortcut hints. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={styles.kbd}>{children}</kbd>
}
