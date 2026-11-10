import type { Verdict } from './framework/expect.ts'

/**
 * Writes a row run's verdicts to a Langfuse server as scores on the story's session, so they sit beside the traces the story made.
 * Only when `BENCH_LANGFUSE_HOST` and the keys (`BENCH_LANGFUSE_PUBLIC_KEY`, `BENCH_LANGFUSE_SECRET_KEY`) are in the environment.
 */
export function langfuseTarget(env: NodeJS.ProcessEnv = process.env): { host: string; authorization: string } | undefined {
  const host = env['BENCH_LANGFUSE_HOST']
  const publicKey = env['BENCH_LANGFUSE_PUBLIC_KEY']
  const secretKey = env['BENCH_LANGFUSE_SECRET_KEY']
  if (host === undefined || host === '' || publicKey === undefined || secretKey === undefined) return undefined
  return { host: host.replace(/\/+$/, ''), authorization: `Basic ${Buffer.from(`${publicKey}:${secretKey}`).toString('base64')}` }
}

/** One score per kind of expectation (the share that held, of those that could be judged) and one for the whole row. */
export function scoresOf(verdicts: readonly Verdict[]): { name: string; value: number; comment: string }[] {
  const judged = verdicts.filter(verdict => verdict.held !== undefined)
  const kinds = new Map<string, { held: number; total: number }>()
  for (const verdict of judged) {
    const tally = kinds.get(verdict.expectation.type) ?? { held: 0, total: 0 }
    tally.total += 1
    if (verdict.held === true) tally.held += 1
    kinds.set(verdict.expectation.type, tally)
  }
  const held = judged.filter(verdict => verdict.held === true).length
  return [
    ...judged.length === 0 ? [] : [{ name: 'bench.row', value: held / judged.length, comment: `${held} of ${judged.length} expectations held` }],
    ...[...kinds].map(([type, tally]) => ({ name: `bench.${type}`, value: tally.held / tally.total, comment: `${tally.held} of ${tally.total}` })),
  ]
}

export async function reportScores(session: string, row: string, verdicts: readonly Verdict[], send: typeof fetch = fetch): Promise<string | undefined> {
  const target = langfuseTarget()
  if (target === undefined) return undefined
  for (const score of scoresOf(verdicts)) {
    const response = await send(`${target.host}/api/public/scores`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: target.authorization },
      body: JSON.stringify({ sessionId: session, name: score.name, value: score.value, dataType: 'NUMERIC', comment: `${row}: ${score.comment}`, metadata: { row } }),
    })
    if (!response.ok) return `Langfuse answered ${response.status} to the score ${score.name}`
  }
  return undefined
}
