/**
 * Significant digits kept when cleaning up binary floating point noise. A
 * float64 holds 15 decimal digits exactly, so this never alters a real digit.
 */
const PRECISION = 15

/** Removes floating point noise: 0.30000000000000004 becomes 0.3. */
function tidy(value: number): number {
  return Number(value.toPrecision(PRECISION))
}

/**
 * The result as plain text a user can paste anywhere: no grouping, ASCII
 * minus sign. For example -1234.5 or 1e+21.
 */
export function plainResult(value: number): string {
  return String(tidy(value))
}

/**
 * The result formatted for display: thousands separators, a typographic minus
 * sign, and scientific notation for very large or very small magnitudes.
 */
export function formatResult(value: number): string {
  const n = tidy(value)
  if (n === 0) return '0'

  const magnitude = Math.abs(n)
  let text: string
  if (magnitude >= 1e15 || magnitude < 1e-6) {
    // "1.5e+21" -> "1.5e21"; the plus sign is noise on screen.
    text = magnitude.toExponential().replace('e+', 'e')
  } else {
    text = magnitude.toLocaleString('en-US', { maximumFractionDigits: 10 })
  }
  return n < 0 ? `−${text}` : text
}
