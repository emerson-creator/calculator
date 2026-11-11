import { vi } from 'vitest'

/** What the fake backend answers for one expression. */
export type FakeAnswer =
  | number
  | { status: number; code: string; message: string; position?: number }

/**
 * Replaces fetch with a fake of POST /api/v1/evaluate that answers from a
 * table. Expressions missing from the table get a generic syntax error, like
 * the real backend would give for garbage.
 */
export function mockBackend(answers: Record<string, FakeAnswer>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const { expression } = JSON.parse(String(init?.body)) as { expression: string }
    const answer = answers[expression] ?? {
      status: 400,
      code: 'SYNTAX_ERROR',
      message: 'unexpected end of expression',
      position: Array.from(expression).length,
    }

    if (typeof answer === 'number') {
      return new Response(JSON.stringify({ expression, result: answer }), { status: 200 })
    }
    const { status, ...error } = answer
    return new Response(JSON.stringify({ error }), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Expressions sent to the fake backend so far, in order. */
export function sentExpressions(fetchMock: ReturnType<typeof mockBackend>): string[] {
  return fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init?.body)) as { expression: string }).expression)
}
