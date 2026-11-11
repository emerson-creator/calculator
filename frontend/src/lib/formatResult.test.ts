import { describe, expect, it } from 'vitest'
import { formatResult, plainResult } from './formatResult'

describe('formatResult', () => {
  const cases: Array<[number, string]> = [
    [0, '0'],
    [-0, '0'],
    [5, '5'],
    [2.5, '2.5'],
    [0.1 + 0.2, '0.3'],
    [1 / 3, '0.3333333333'],
    [1234567890123, '1,234,567,890,123'],
    [1024, '1,024'],
    [1234567.891, '1,234,567.891'],
    [-4, '−4'],
    [-1234.5, '−1,234.5'],
    [999999999999999, '999,999,999,999,999'],
    [1e15, '1e15'],
    [1.5e21, '1.5e21'],
    [-2e30, '−2e30'],
    [0.000001, '0.000001'],
    [0.0000001, '1e-7'],
    [1e-9, '1e-9'],
  ]

  it.each(cases)('formats %s as %s', (value, expected) => {
    expect(formatResult(value)).toBe(expected)
  })
})

describe('plainResult', () => {
  const cases: Array<[number, string]> = [
    [5, '5'],
    [0.1 + 0.2, '0.3'],
    [-1234.5, '-1234.5'],
    [1024, '1024'],
    [1e21, '1e+21'],
    [-0, '0'],
  ]

  it.each(cases)('renders %s as %s', (value, expected) => {
    expect(plainResult(value)).toBe(expected)
  })

  it('produces text the backend can parse back', () => {
    for (const value of [98, 0.3, -4, 1e21, 2.5e-7]) {
      expect(Number(plainResult(value))).toBeCloseTo(value, 12)
    }
  })
})
