import { beforeEach, describe, expect, it, vi } from 'vitest'

const { addSessionPlot, runChild } = vi.hoisted(() => ({ addSessionPlot: vi.fn(), runChild: vi.fn() }))

vi.mock('../../../src/host/agents/child.ts', () => ({
  childModel: () => ({}),
  childSampling: () => ({}),
  childTrace: () => ({}),
  runChild,
}))
vi.mock('../../../src/host/pacing/director.ts', () => ({ addSessionPlot }))
vi.mock('../../../src/host/prompts/access.ts', () => ({ promptFor: () => 'plot author' }))

const { authorPlot, mendPlot } = await import('../../../src/host/pacing/author.ts')

const draft = {
  builds_on: ['E1'], id: 'new-plot', name: 'A new pressure', themes: ['duty'],
  hook: { id: 'hook', from: 'E1', actor: 'guide', pressure: 'The guide wants the ledger returned', opening: 'If the bell rings', guidance: '', avoid: [] },
  developments: [{ id: 'd1', text: 'The guide may ask about the ledger.', mode: 'opportunity' as const, prerequisites: [], guidance: '', avoid: [] }],
  stakes: ['The ledger remains missing.'], resolutions: ['The ledger is returned.'], participants: ['guide'],
}

function storeOf() {
  const events = [{ text: 'A ledger went missing.' }]
  return {
    cast: () => [
      { key: 'guide', character: { name: 'Ari', summary: 'Keeps the records.', control: 'model', aliases: [] } },
      { key: 'traveller', character: { name: 'Nia', summary: 'Passing through.', control: 'player', aliases: [] } },
    ],
    settings: () => ({ prompts: { language: 'en' }, reasoning: { children: 'off' } }),
    story: {
      events: { list: () => events },
      threads: { list: () => [{ text: 'The ledger is still missing.' }] },
      factions: { list: () => [] },
      locations: { list: () => [{ id: 1, name: 'Archive' }] },
    },
  } as never
}

beforeEach(() => {
  addSessionPlot.mockReset()
  runChild.mockReset().mockImplementation(async (task: { beforeSubmit(value: unknown): string | undefined }) => {
    const problem = task.beforeSubmit(draft)
    if (problem !== undefined) throw new Error(problem)
    return draft
  })
})

const plot = (hook: string, developments: [string, string][], resolutions: string[]) => ({
  id: 'p', name: 'n', builds_on: [], themes: [], stakes: [], participants: [],
  hook: { id: 'h', text: hook, guidance: '', avoid: [] },
  developments: developments.map(([id, text], index) => ({ id, text, mode: 'opportunity' as const, prerequisites: index > 0 ? [developments[0]![0]] : [], guidance: '', avoid: [] })),
  resolutions,
})

describe('what a plot may say of the player\'s character', () => {
  it('cuts the sentence that names the character from a hook, and leaves the rest', () => {
    const mended = mendPlot(plot('Pavel waits at the door. Mara arrives and he turns to her.', [], []), ['Mara'])
    expect(mended).toMatchObject({ plot: { hook: { text: 'Pavel waits at the door.' } }, cut: ['the hook'] })
  })

  it('drops a development that is only about the character, and the prerequisites that pointed at it', () => {
    const mended = mendPlot(plot('Pavel waits.', [['d1', 'Mara reads the letter aloud.'], ['d2', 'Odile lends a lamp.']], []), ['Mara'])
    expect(mended).toMatchObject({ plot: { developments: [{ id: 'd2', prerequisites: [] }] }, cut: ['development d1 (dropped)'] })
  })

  it('treats the generic term like a name in a hook or development, and lets a resolution use it as a condition', () => {
    const mended = mendPlot(plot('Pavel waits.', [['d1', 'Odile offers the Player\'s character a lamp.']], ['If the player\'s character pays, Pavel leaves.', 'Lin walks away.']), ['Lin'], ['player'])
    expect(mended).toMatchObject({ plot: { developments: [], resolutions: ['If the player\'s character pays, Pavel leaves.'] }, cut: ['development d1 (dropped)', 'resolution 2 (dropped)'] })
  })

  it('refuses a plot with nothing left of its hook, and changes nothing when the character is not named', () => {
    expect(mendPlot(plot('Mara waits.', [], []), ['Mara'])).toHaveProperty('refusal')
    expect(mendPlot(plot('Pavel waits.', [['d1', 'Odile lends a lamp.']], ['Pavel leaves.']), ['Mara'])).toMatchObject({ cut: [] })
    expect(mendPlot(plot('Mara waits.', [], []), [])).toMatchObject({ cut: [] })
  })
})

describe('writing an optional plot from the recorded story', () => {
  it('grounds the generated hook in a record and adds the validated plot', async () => {
    const store = storeOf()
    const made = await authorPlot({} as never, store, 7, new AbortController().signal)

    expect(made).toMatchObject({
      id: 'new-plot',
      premise: 'A ledger went missing.',
      hooks: [{ text: 'A ledger went missing. Ari: The guide wants the ledger returned. If the bell rings.' }],
    })
    expect(addSessionPlot).toHaveBeenCalledWith(store, made)
  })

  it('retries one contradictory hook, then accepts the replacement', async () => {
    const faulty = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    await authorPlot({} as never, storeOf(), 8, new AbortController().signal, { chat: 'chat', check: { faulty } as never })

    expect(runChild).toHaveBeenCalledTimes(2)
    expect(faulty).toHaveBeenCalledTimes(2)
    expect(addSessionPlot).toHaveBeenCalledOnce()
  })

  it('refuses a second contradictory hook without changing the story', async () => {
    const faulty = vi.fn().mockResolvedValue(true)

    await expect(authorPlot({} as never, storeOf(), 9, new AbortController().signal, { chat: 'chat', check: { faulty } as never })).rejects.toThrow(/contradicts the recorded events twice/)
    expect(addSessionPlot).not.toHaveBeenCalled()
  })
})
