import type { CalcError } from '../types'

const EVALUATE_URL = '/api/v1/evaluate'

/** Codes produced by the client itself, as opposed to the backend. */
export const ClientErrorCode = {
  /** The request never got an answer: backend down, offline, DNS, ... */
  Network: 'NETWORK_ERROR',
  /** The answer was not what the API contract promises. */
  BadResponse: 'BAD_RESPONSE',
} as const

/**
 * Error returned by evaluate(). It is also a CalcError, so it can be stored in
 * state and rendered as is.
 */
export class ApiError extends Error implements CalcError {
  readonly code: string
  readonly position?: number
  /** HTTP status, or 0 when there was no HTTP response at all. */
  readonly status: number

  constructor(init: { code: string; message: string; status: number; position?: number }) {
    super(init.message)
    this.name = 'ApiError'
    this.code = init.code
    this.status = init.status
    this.position = init.position
  }
}

/** True when err comes from an AbortController, i.e. it is not a real failure. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

/** Strips an ApiError down to the plain CalcError the UI stores. */
export function toCalcError(err: unknown): CalcError {
  if (err instanceof ApiError) {
    const calcError: CalcError = { code: err.code, message: err.message }
    if (err.position !== undefined) calcError.position = err.position
    return calcError
  }
  return { code: 'UNKNOWN_ERROR', message: 'Something went wrong. Try again.' }
}

/**
 * Asks the backend to evaluate an arithmetic expression.
 *
 * Resolves with the numeric result. Rejects with an ApiError for anything the
 * user can act on (syntax errors, division by zero, backend unreachable) and
 * with the original AbortError when `signal` is aborted; use isAbortError to
 * tell the two apart.
 */
export async function evaluate(expression: string, signal?: AbortSignal): Promise<number> {
  let response: Response
  try {
    response = await fetch(EVALUATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expression }),
      signal,
    })
  } catch (err) {
    if (isAbortError(err)) throw err
    throw new ApiError({
      code: ClientErrorCode.Network,
      message: "Can't reach the calculator service. Check that the backend is running.",
      status: 0,
    })
  }

  const body: unknown = await response.json().catch(() => undefined)

  if (response.ok) {
    if (isRecord(body) && typeof body.result === 'number' && Number.isFinite(body.result)) {
      return body.result
    }
    throw badResponse(response.status)
  }

  // Every error of the API has the shape { error: { code, message, position? } }.
  if (isRecord(body) && isRecord(body.error)) {
    const { code, message, position } = body.error
    if (typeof code === 'string' && typeof message === 'string') {
      throw new ApiError({
        code,
        message,
        status: response.status,
        position: typeof position === 'number' ? position : undefined,
      })
    }
  }
  throw badResponse(response.status)
}

function badResponse(status: number): ApiError {
  return new ApiError({
    code: ClientErrorCode.BadResponse,
    message: 'The calculator service sent an unexpected response.',
    status,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
