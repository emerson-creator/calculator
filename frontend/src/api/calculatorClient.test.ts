import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  ClientErrorCode,
  evaluate,
  isAbortError,
  toCalcError,
} from './calculatorClient'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function mockFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** Runs evaluate() expecting it to reject, and returns the rejection. */
async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err) {
    return err
  }
  throw new Error('expected the promise to reject')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('evaluate', () => {
  it('posts the expression as JSON and returns the result', async () => {
    const fetchMock = mockFetch(async () =>
      jsonResponse({ expression: '2 * (3 + 4) ^ 2', result: 98 }),
    )

    await expect(evaluate('2 * (3 + 4) ^ 2')).resolves.toBe(98)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/evaluate')
    expect(init.method).toBe('POST')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ expression: '2 * (3 + 4) ^ 2' })
  })

  it('returns negative and zero results untouched', async () => {
    mockFetch(async () => jsonResponse({ result: -4 }))
    await expect(evaluate('-2 ^ 2')).resolves.toBe(-4)

    mockFetch(async () => jsonResponse({ result: 0 }))
    await expect(evaluate('0')).resolves.toBe(0)
  })

  it('rejects with the syntax error and its position', async () => {
    mockFetch(async () =>
      jsonResponse(
        { error: { code: 'SYNTAX_ERROR', message: 'missing closing ")"', position: 6 } },
        400,
      ),
    )

    const err = await rejection(evaluate('(2 + 3'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({
      code: 'SYNTAX_ERROR',
      message: 'missing closing ")"',
      position: 6,
      status: 400,
    })
  })

  it('rejects with math errors, which carry no position', async () => {
    mockFetch(async () =>
      jsonResponse({ error: { code: 'DIVISION_BY_ZERO', message: 'cannot divide by zero' } }, 422),
    )

    const err = await rejection(evaluate('1 / 0'))
    expect(err).toMatchObject({ code: 'DIVISION_BY_ZERO', status: 422 })
    expect((err as ApiError).position).toBeUndefined()
  })

  it('reports an unreachable backend as a network error', async () => {
    mockFetch(async () => {
      throw new TypeError('Failed to fetch')
    })

    const err = await rejection(evaluate('1 + 1'))
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ code: ClientErrorCode.Network, status: 0 })
  })

  it('rethrows aborts as they are, so callers can ignore them', async () => {
    mockFetch(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    const err = await rejection(evaluate('1 + 1'))
    expect(isAbortError(err)).toBe(true)
    expect(err).not.toBeInstanceOf(ApiError)
  })

  it('passes the abort signal to fetch', async () => {
    const fetchMock = mockFetch(async () => jsonResponse({ result: 2 }))
    const controller = new AbortController()

    await evaluate('1 + 1', controller.signal)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })

  describe('responses that break the API contract', () => {
    const cases: Array<[string, () => Promise<Response>]> = [
      ['a success body without a result', async () => jsonResponse({ expression: '1' })],
      ['a result that is not a number', async () => jsonResponse({ result: '2' })],
      ['a success body that is not an object', async () => jsonResponse(null)],
      ['an error body without the error object', async () => jsonResponse({ message: 'x' }, 400)],
      ['an error body with a malformed error', async () => jsonResponse({ error: { code: 1 } }, 400)],
      [
        'a proxy error page instead of JSON',
        async () => new Response('<html>Bad gateway</html>', { status: 502 }),
      ],
      ['an empty success body', async () => new Response('', { status: 200 })],
    ]

    it.each(cases)('rejects on %s', async (_name, impl) => {
      mockFetch(impl)

      const err = await rejection(evaluate('1 + 1'))
      expect(err).toBeInstanceOf(ApiError)
      expect((err as ApiError).code).toBe(ClientErrorCode.BadResponse)
    })
  })
})

describe('isAbortError', () => {
  it('only matches AbortError DOMExceptions', () => {
    expect(isAbortError(new DOMException('x', 'AbortError'))).toBe(true)
    expect(isAbortError(new DOMException('x', 'NetworkError'))).toBe(false)
    expect(isAbortError(new Error('AbortError'))).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})

describe('toCalcError', () => {
  it('keeps code, message and position of an ApiError', () => {
    const err = new ApiError({ code: 'SYNTAX_ERROR', message: 'oops', status: 400, position: 3 })
    expect(toCalcError(err)).toEqual({ code: 'SYNTAX_ERROR', message: 'oops', position: 3 })
  })

  it('omits the position when there is none', () => {
    const err = new ApiError({ code: 'DIVISION_BY_ZERO', message: 'no', status: 422 })
    expect(toCalcError(err)).toEqual({ code: 'DIVISION_BY_ZERO', message: 'no' })
  })

  it('turns anything else into a generic error without leaking details', () => {
    const calcError = toCalcError(new Error('secret internals'))
    expect(calcError.code).toBe('UNKNOWN_ERROR')
    expect(calcError.message).not.toContain('secret')
  })
})
