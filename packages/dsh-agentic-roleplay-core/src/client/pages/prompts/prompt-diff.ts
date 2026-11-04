export interface ShippedLine {
  text: string
  /** The shipped line has no identical line in the person's text. */
  missing: boolean
}

export interface LineComparison {
  shipped: ShippedLine[]
  /** How many lines of the person's text have no identical line in the shipped text. */
  extra: number
}

const linesOf = (text: string): string[] => text.replace(/\r\n/g, '\n').trimEnd().split('\n')

/** A plain comparison by whole lines, enough to see what a shipped text says that an edited one does not; blank lines never count. */
export function compareLines(shipped: string, current: string): LineComparison {
  const mine = new Set(linesOf(current).map(line => line.trim()).filter(line => line !== ''))
  const theirs = new Set(linesOf(shipped).map(line => line.trim()).filter(line => line !== ''))
  return {
    shipped: linesOf(shipped).map(text => ({ text, missing: text.trim() !== '' && !mine.has(text.trim()) })),
    extra: linesOf(current).filter(line => line.trim() !== '' && !theirs.has(line.trim())).length,
  }
}
