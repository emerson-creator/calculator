import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import App from './App'

it('renders the calculator under a page heading', () => {
  render(<App />)

  expect(screen.getByRole('heading', { level: 1, name: 'Calculator' })).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Calculator' })).toBeInTheDocument()
  expect(screen.getByRole('combobox', { name: 'Expression' })).toBeInTheDocument()
})
