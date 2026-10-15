/** Reads pnpm's JSON pack result while ignoring lifecycle-script progress written before it. */
export function parsePackOutput(output) {
  const lines = output.split(/\r?\n/)
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (!lines[index]?.trim().startsWith('{')) continue
    try {
      const result = JSON.parse(lines.slice(index).join('\n'))
      if (typeof result === 'object' && result !== null && typeof result.filename === 'string' && result.filename !== '') return result
    } catch {
      // An earlier line may only look like the beginning of the final JSON object.
    }
  }
  throw new Error('pnpm pack did not return a JSON object with a filename')
}
