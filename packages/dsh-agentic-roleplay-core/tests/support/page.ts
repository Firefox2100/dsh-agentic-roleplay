/** Just enough of `document` for the page-visibility code: a state, and the `visibilitychange` listeners. */
export interface FakePage {
  visibilityState: string
  listeners: Set<() => void>
  addEventListener: (type: string, listener: () => void) => void
  removeEventListener: (type: string, listener: () => void) => void
}

const globals = globalThis as { document?: unknown }

export function fakePage(state: string): FakePage {
  const listeners = new Set<() => void>()
  return {
    visibilityState: state,
    listeners,
    addEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.add(listener) },
    removeEventListener: (type, listener) => { if (type === 'visibilitychange') listeners.delete(listener) },
  }
}

/** Put a page in front of the code under test. Call `clearPage()` when the test ends. */
export function withPage(page: FakePage): FakePage {
  globals.document = page
  return page
}

export function clearPage(): void {
  globals.document = undefined
}

/** Say the browser told its listeners the page changed. */
export function show(page: FakePage): void {
  for (const listener of [...page.listeners]) listener()
}
