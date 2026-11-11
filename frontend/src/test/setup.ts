import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only unmounts between tests automatically when the test
// framework exposes globals. We import from 'vitest' explicitly instead, so
// the cleanup is registered here.
afterEach(() => {
  cleanup()
})
