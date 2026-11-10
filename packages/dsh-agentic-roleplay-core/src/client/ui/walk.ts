/** The part of a segmented option keyboard walking needs; kept structural so tests can pass plain objects. */
export interface WalkOption<Value extends string> {
  value: Value
  disabled?: boolean | undefined
}

/** Whether a key moves the selection inside a tablist. */
export function isWalkKey(key: string): boolean {
  return key === 'ArrowLeft' || key === 'ArrowRight' || key === 'ArrowUp' || key === 'ArrowDown' || key === 'Home' || key === 'End'
}

/**
 * The enabled option a walk key lands on from the selected one: arrows step to the nearest enabled
 * neighbour and wrap around the list, Home and End take the first and last enabled option.
 */
export function walk<Value extends string>(options: readonly WalkOption<Value>[], from: number, key: string): WalkOption<Value> | undefined {
  const enabled = options.filter(option => option.disabled !== true)
  if (key === 'Home') return enabled[0]
  if (key === 'End') return enabled[enabled.length - 1]
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : -1
  const count = options.length
  for (let offset = 1; offset < count; offset += 1) {
    const candidate = options[((from + step * offset) % count + count) % count]
    if (candidate !== undefined && candidate.disabled !== true) return candidate
  }
  return undefined
}
