export interface AuthoringApi {
  say(text: string): Promise<void>
  status(): Promise<{ turns: number; running: boolean }>
}

export interface WaitOptions { limitMs: number; pollMs: number; now?: () => number; sleep?: (ms: number) => Promise<void> }

/**
 * Says something to a world's authoring assistant and waits until it has answered: its count of ended turns has grown and it is no longer working, on two looks in a row (a turn that has
 * ended can be followed at once by the next step of a queued one). A look is taken before the message, so an answer that was already finished is never mistaken for the new one.
 * @throws when the assistant has not finished within the limit; the usual cause is a rig that asks for approval of each change (the plugin's `authoringApproval` must be `auto`).
 */
export async function askAuthor(api: AuthoringApi, text: string, options: WaitOptions): Promise<{ turns: number; ms: number }> {
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const before = (await api.status()).turns
  const began = now()
  await api.say(text)
  let quiet = 0
  for (;;) {
    await sleep(options.pollMs)
    const status = await api.status()
    quiet = status.turns > before && !status.running ? quiet + 1 : 0
    if (quiet >= 2) return { turns: status.turns - before, ms: now() - began }
    if (now() - began > options.limitMs) throw new Error(`the assistant had not finished after ${Math.round(options.limitMs / 60_000)} minutes (${status.turns - before} turns ended, ${status.running ? 'still working' : 'idle'}): is the rig's authoringApproval set to auto?`)
  }
}
