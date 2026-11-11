import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEY } from '../lib/historyStorage'
import { type FakeAnswer, mockBackend } from '../test/mockBackend'
import type { HistoryEntry } from '../types'
import { Calculator } from './Calculator'

const ANSWERS: Record<string, FakeAnswer> = {
  '2 + 3': 5,
  '2+3': 5,
  '7*8': 56,
  '7*': { status: 400, code: 'SYNTAX_ERROR', message: 'unexpected end of expression', position: 2 },
  '2 * (3 + 4) ^ 2': 98,
  '-2 ^ 2': -4,
  '1024 * 1024': 1048576,
  '0.1 + 0.2': 0.30000000000000004,
  '2 + )': { status: 400, code: 'SYNTAX_ERROR', message: 'unexpected ")"', position: 4 },
  '1 / 0': { status: 422, code: 'DIVISION_BY_ZERO', message: 'cannot divide by zero' },
}

function setup(answers: Record<string, FakeAnswer> = ANSWERS) {
  const fetchMock = mockBackend(answers)
  const user = userEvent.setup()
  render(<Calculator debounceMs={0} />)
  const input = screen.getByRole<HTMLInputElement>('combobox', { name: 'Expression' })
  return { user, input, fetchMock }
}

function seedHistory(entries: Array<Partial<HistoryEntry> & { id: string; expression: string; result: number }>) {
  const history = entries.map((entry) => ({ pinned: false, createdAt: 0, ...entry }))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
}

const history = () => screen.getByRole('listbox', { name: 'History' })
const options = () => within(history()).queryAllByRole('option')
const result = (text: string) => screen.findByLabelText(`Result: ${text}`)

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('typing an expression', () => {
  it('starts with a short guide and the input focused', () => {
    const { input } = setup()
    expect(screen.getByText('What do you want to calculate?')).toBeInTheDocument()
    expect(screen.getByText('Your history lives here')).toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('shows the result while typing, without pressing anything', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    expect(await result('5')).toBeInTheDocument()
  })

  it('formats results for reading', async () => {
    const { user, input } = setup()

    await user.type(input, '1024 * 1024')
    expect(await result('1,048,576')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '0.1 + 0.2')
    expect(await result('0.3')).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '-2 ^ 2')
    expect(await result('−4')).toBeInTheDocument()
  })

  it('goes back to the guide when the input is emptied', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    await user.clear(input)
    expect(screen.getByText('What do you want to calculate?')).toBeInTheDocument()
  })

  it('fills the input from an example', async () => {
    const { user, input } = setup()
    await user.click(screen.getByRole('button', { name: '2 * (3 + 4) ^ 2' }))

    expect(input).toHaveValue('2 * (3 + 4) ^ 2')
    expect(input).toHaveFocus()
    expect(await result('98')).toBeInTheDocument()
  })

  it('clears the input with the clear button and with Escape', async () => {
    const { user, input } = setup()

    await user.type(input, '2 + 3')
    await user.click(screen.getByRole('button', { name: 'Clear expression' }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()

    await user.type(input, '2 + 3')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })
})

describe('errors', () => {
  it('marks the exact character of a syntax error', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + )')

    expect(await screen.findByText('Unexpected ")"')).toBeInTheDocument()
    const mark = document.querySelector('mark')
    expect(mark).toHaveTextContent(')')
    expect(mark?.previousSibling).toHaveTextContent('2 +')
  })

  it('treats an unfinished expression as a hint, not as an error', async () => {
    const { user, input } = setup()
    await user.type(input, '7*')
    expect(await screen.findByText('Keep typing: unexpected end of expression')).toBeInTheDocument()
  })

  it('explains math errors', async () => {
    const { user, input } = setup()
    await user.type(input, '1 / 0')
    expect(await screen.findByText('Cannot divide by zero')).toBeInTheDocument()
    expect(document.querySelector('mark')).not.toBeInTheDocument()
  })

  it('says so when the backend cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    const user = userEvent.setup()
    render(<Calculator debounceMs={0} />)

    await user.type(screen.getByRole('combobox'), '2 + 3')
    expect(await screen.findByText(/Can't reach the calculator service/)).toBeInTheDocument()
  })

  it('does not offer to save an expression that failed', async () => {
    const { user, input } = setup()
    await user.type(input, '1 / 0')
    await screen.findByText('Cannot divide by zero')

    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(options()).toHaveLength(0)
  })
})

describe('history', () => {
  it('saves the calculation with Enter and persists it', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')
    await user.keyboard('{Enter}')

    const [row] = options()
    expect(row).toHaveTextContent('2 + 3')
    expect(row).toHaveTextContent('5')
    expect(row).toHaveAttribute('aria-selected', 'true')

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as HistoryEntry[]
      expect(stored).toMatchObject([{ expression: '2 + 3', result: 5, pinned: false }])
    })
  })

  it('saves even when Enter is pressed before the answer arrives', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3{Enter}')
    await waitFor(() => expect(options()).toHaveLength(1))
  })

  it('does not duplicate an expression that is saved twice', async () => {
    seedHistory([{ id: 'a', expression: '2 + 3', result: 5 }])
    const { user, input } = setup()

    await user.type(input, '2 + 3')
    await result('5')
    await user.keyboard('{Enter}')

    expect(options()).toHaveLength(1)
  })

  it('restores the saved history on load, pinned entries first', () => {
    seedHistory([
      { id: 'a', expression: '2 + 3', result: 5 },
      { id: 'b', expression: '7*8', result: 56, pinned: true },
    ])
    setup()

    expect(options().map((o) => o.textContent)).toEqual([
      expect.stringContaining('7*8'),
      expect.stringContaining('2 + 3'),
    ])
    expect(within(history()).getByRole('group', { name: 'Pinned' })).toHaveTextContent('7*8')
    expect(within(history()).getByRole('group', { name: 'Recent' })).toHaveTextContent('2 + 3')
  })

  it('browses with the arrow keys and reuses an entry with Enter', async () => {
    seedHistory([
      { id: 'a', expression: '2 + 3', result: 5 },
      { id: 'b', expression: '7*8', result: 56 },
    ])
    const { user, input } = setup()

    await user.keyboard('{ArrowDown}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(await result('5')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-activedescendant', options()[0].id)

    await user.keyboard('{ArrowDown}')
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(await result('56')).toBeInTheDocument()
    expect(input).toHaveValue('')

    await user.keyboard('{ArrowUp}{Enter}')
    expect(input).toHaveValue('2 + 3')
    expect(input).toHaveFocus()
  })

  it('reuses an entry when it is clicked, without asking the backend again', async () => {
    seedHistory([{ id: 'a', expression: '2 + 3', result: 5 }])
    const { user, input, fetchMock } = setup()

    await user.click(options()[0])

    expect(input).toHaveValue('2 + 3')
    expect(await result('5')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('deselects with Escape before clearing the input', async () => {
    seedHistory([{ id: 'a', expression: '2 + 3', result: 5 }])
    const { user, input } = setup()

    await user.type(input, '7*8')
    await result('56')
    await user.keyboard('{ArrowDown}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Escape}')
    expect(options()[0]).toHaveAttribute('aria-selected', 'false')
    expect(input).toHaveValue('7*8')

    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('pins and removes the selected entry with shortcuts', async () => {
    seedHistory([{ id: 'a', expression: '2 + 3', result: 5 }])
    const { user } = setup()

    await user.keyboard('{ArrowDown}{Alt>}p{/Alt}')
    expect(within(history()).getByRole('group', { name: 'Pinned' })).toHaveTextContent('2 + 3')

    await user.keyboard('{Alt>}p{/Alt}')
    expect(within(history()).queryByRole('group', { name: 'Pinned' })).not.toBeInTheDocument()

    await user.keyboard('{Alt>}{Backspace}{/Alt}')
    expect(options()).toHaveLength(0)
  })
})

describe('keypad', () => {
  it('builds an expression and saves it with the equals key', async () => {
    const { user, input } = setup()
    const keypad = within(screen.getByRole('group', { name: 'Keypad' }))

    await user.click(keypad.getByRole('button', { name: '7' }))
    await user.click(keypad.getByRole('button', { name: 'Multiply' }))
    await user.click(keypad.getByRole('button', { name: '8' }))

    expect(input).toHaveValue('7*8')
    expect(await result('56')).toBeInTheDocument()

    await user.click(keypad.getByRole('button', { name: 'Equals' }))
    expect(options()).toHaveLength(1)
  })

  it('keeps the focus in the input', async () => {
    const { user, input } = setup()
    await user.click(screen.getByRole('button', { name: '7' }))
    expect(input).toHaveFocus()
  })

  it('inserts at the caret and replaces the selection', async () => {
    const { user, input } = setup()
    await user.type(input, '23')

    input.setSelectionRange(1, 1)
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(input).toHaveValue('2+3')
    expect(input.selectionStart).toBe(2)

    input.setSelectionRange(0, 3)
    await user.click(screen.getByRole('button', { name: 'Square root' }))
    expect(input).toHaveValue('sqrt(')
  })

  it('deletes with backspace and clears with C', async () => {
    const { user, input } = setup()
    await user.type(input, '7*8')

    await user.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(input).toHaveValue('7*')

    input.setSelectionRange(0, 1)
    await user.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(input).toHaveValue('*')

    input.setSelectionRange(0, 0)
    await user.click(screen.getByRole('button', { name: 'Backspace' }))
    expect(input).toHaveValue('*')

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(input).toHaveValue('')
  })
})

describe('actions', () => {
  it('opens with Ctrl+K, lists what applies, and closes with Escape', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    await user.keyboard('{Control>}k{/Control}')
    const menu = screen.getByRole('menu', { name: 'Actions' })
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Save to history'),
      expect.stringContaining('Copy result'),
      expect.stringContaining('Copy expression'),
      expect.stringContaining('Clear expression'),
    ])
    expect(within(menu).getAllByRole('menuitem')[0]).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(input).toHaveFocus()
    expect(input).toHaveValue('2 + 3')
  })

  it('opens from the footer button and explains itself when there is nothing to do', async () => {
    const { user } = setup()
    const button = screen.getByRole('button', { name: /Actions/ })

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Type an expression to see actions.')).toBeInTheDocument()

    await user.click(button)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('moves through the menu with the arrow keys without touching the history', async () => {
    seedHistory([{ id: 'a', expression: '7*8', result: 56 }])
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    await user.keyboard('{Control>}k{/Control}')
    const items = screen.getAllByRole('menuitem')

    await user.keyboard('{ArrowDown}')
    expect(items[1]).toHaveFocus()
    await user.keyboard('{ArrowUp}{ArrowUp}')
    expect(items[items.length - 1]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(items[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(items[items.length - 1]).toHaveFocus()

    expect(options()[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('runs the focused action with Enter, and only that action', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    // Second item: "Copy result". Enter must not also save to the history.
    await user.keyboard('{Control>}k{/Control}{ArrowDown}{Enter}')

    expect(await screen.findByText('Copied result')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('5')
    expect(options()).toHaveLength(0)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('copies the plain result with Alt+C and with the copy button', async () => {
    const { user, input } = setup()
    await user.type(input, '1024 * 1024')
    await result('1,048,576')

    await user.keyboard('{Alt>}c{/Alt}')
    expect(await navigator.clipboard.readText()).toBe('1048576')
    expect(input).toHaveValue('1024 * 1024')

    await navigator.clipboard.writeText('')
    await user.click(screen.getByRole('button', { name: 'Copy result' }))
    expect(await navigator.clipboard.readText()).toBe('1048576')
  })

  it('copies the expression', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    await user.keyboard('{Control>}k{/Control}')
    await user.click(screen.getByRole('menuitem', { name: /Copy expression/ }))

    expect(await screen.findByText('Copied expression')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('2 + 3')
  })

  it('offers entry actions for the selected history entry', async () => {
    seedHistory([
      { id: 'a', expression: '2 + 3', result: 5 },
      { id: 'b', expression: '7*8', result: 56 },
    ])
    const { user, input } = setup()
    await user.keyboard('{ArrowDown}{Control>}k{/Control}')

    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      expect.stringContaining('Use expression'),
      expect.stringContaining('Copy result'),
      expect.stringContaining('Copy expression'),
      expect.stringContaining('Pin'),
      expect.stringContaining('Remove from history'),
      expect.stringContaining('Clear history'),
    ])

    await user.click(screen.getByRole('menuitem', { name: /^Pin/ }))
    expect(within(history()).getByRole('group', { name: 'Pinned' })).toHaveTextContent('2 + 3')

    await user.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('menuitem', { name: /Unpin/ })).toBeInTheDocument()
    await user.click(screen.getByRole('menuitem', { name: /Clear history/ }))
    expect(options().map((o) => o.textContent)).toEqual([expect.stringContaining('2 + 3')])

    await user.keyboard('{Control>}k{/Control}')
    await user.click(screen.getByRole('menuitem', { name: /Use expression/ }))
    expect(input).toHaveValue('2 + 3')

    await user.keyboard('{Control>}k{/Control}')
    await user.click(screen.getByRole('menuitem', { name: /Remove from history/ }))
    expect(options()).toHaveLength(0)
  })

  it('clears the expression from the menu', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    await user.keyboard('{Control>}k{/Control}')
    await user.click(screen.getByRole('menuitem', { name: /Clear expression/ }))
    expect(input).toHaveValue('')
  })

  it('reports when the clipboard is not available', async () => {
    const { user, input } = setup()
    await user.type(input, '2 + 3')
    await result('5')

    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))
    await user.keyboard('{Alt>}c{/Alt}')

    expect(await screen.findByText("Couldn't copy the result")).toBeInTheDocument()
  })
})

describe('footer', () => {
  it('advertises what Enter does', async () => {
    seedHistory([{ id: 'a', expression: '7*8', result: 56 }])
    const { user, input } = setup()
    expect(screen.queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()

    await user.type(input, '2 + 3')
    await result('5')
    await user.click(screen.getByRole('button', { name: /^Save/ }))
    expect(options()).toHaveLength(2)

    await user.keyboard('{ArrowDown}{ArrowDown}')
    await user.click(screen.getByRole('button', { name: /^Use expression/ }))
    expect(input).toHaveValue('7*8')
  })
})
