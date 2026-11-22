import { changeItem, createSessionStore, planItemChange, type ItemChangeSpec } from '@dsh-agentic-roleplay/state'
import { castSummary } from '../../src/host/orchestration/defaults.ts'
import { carriedBy, castOf, itemsIn } from '../../src/host/orchestration/store.ts'
import { shippedText } from '../../src/host/prompts/library.ts'
import type { Language } from './language.ts'
import { castName } from './attribution-cases.ts'
import { eliasOf, type TransferCase } from './transfer-cases.ts'

export interface Problem { rule: 'unrecorded' | 'wrong' | 'spurious' | 'unreadable'; detail: string }

const change = (withFrom: boolean) => ({
  type: 'object',
  properties: {
    item: { type: 'string', description: 'The key of the item, as the scene lists it.' },
    action: { type: 'string', enum: ['take', 'drop', 'give', 'put', 'wear', 'remove', 'open', 'close', 'lock', 'unlock', 'reveal'], description: 'take (pick up what is here or take it out of a container it carries), drop (leave it here), give (to someone present), put (into an open container), wear, remove (what is worn), open, close, lock, unlock, reveal.' },
    to: { type: 'string', description: 'For give: who gets it. For put: the container.' },
    ...(withFrom ? { from: { type: 'string', description: 'For take: the character it is taken from, when this outcome has it taken out of their hands, pockets or belt (a theft, a snatch, a confiscation) and not given: a thing someone holds changes hands in the records only this way or by give.' } } : {}),
  },
  required: ['item', 'action'],
  additionalProperties: false,
})

export const outcomesSchema = (withFrom: boolean) => ({
  type: 'object',
  properties: {
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          character: { type: 'string', description: 'The character\'s key; for the player\'s character, only when it moves or handles things.' },
          result: { type: 'string', enum: ['succeeded', 'partial', 'failed'] },
          summary: { type: 'string', description: 'What concretely happens to the character, in a sentence.' },
          item_changes: { type: 'array', description: 'What the character does with things as a result, in order, when it does: leave out when it handles nothing. Each is checked. Not for a character whose intent failed.', items: change(withFrom) },
        },
        required: ['character', 'result', 'summary'],
        additionalProperties: false,
      },
    },
  },
  required: ['outcomes'],
  additionalProperties: false,
})

const ADDED = { en: / When the summary has a thing change hands or place.*?a summary alone changes nothing in the story's records\./s, zh: /如果一句话说明里有物品易手或换了位置.*?只写在说明里不会改变故事的记录。/s }

export function build(made: TransferCase, language: Language, variant: 'old' | 'new'): { persona: string; prompt: string; story: ReturnType<typeof createSessionStore> } {
  const session = createSessionStore(':memory:', { id: `bench-transfer-${made.id}`, name: made.id, world: { id: 'bench', name: 'Bench' } }) as unknown as Parameters<typeof castOf>[0]
  const raw = session as unknown as ReturnType<typeof createSessionStore>
  for (const key of ['mara', 'elias'] as const) raw.characters.add({ sourceId: key, name: castName(key, language), aliases: [], kind: 'person', tier: 'principal', role: key === 'mara' ? 'playable' : 'npc', control: key === 'mara' ? 'player' : 'agent', summary: '', personality: '', background: '', appearance: '', speech: { style: '', examples: [] } })
  raw.edit({
    turn: 1,
    places: [{ key: 'kitchen', name: language === 'en' ? 'The kitchen' : '厨房', features: [{ key: 'table', name: language === 'en' ? 'Table' : '桌子' }] }],
    moves: [{ character: 'mara', to: 'kitchen', ignoreExits: true }, { character: 'elias', to: 'kitchen', ignoreExits: true }],
    items: [
      { key: 'key', name: language === 'en' ? 'Storeroom key' : '储藏室钥匙', unique: true, heldBy: 'elias' },
      { key: 'lantern', name: language === 'en' ? 'Brass lantern' : '黄铜提灯', at: { location: 'kitchen', feature: 'table' } },
      { key: 'drawer', name: language === 'en' ? 'Drawer' : '抽屉', container: { state: 'open' }, at: { location: 'kitchen' } },
    ],
  })
  const cast = castOf(session)
  const name = language === 'en' ? 'English' : 'Chinese'
  let master = shippedText('roleplay/game-master', language, { language: name, preview: '', dice: '', standing: '' })
  if (variant === 'old') master = master.replace(ADDED[language], '')
  const persona = `${shippedText('roleplay/persona', language, { language: name, style: '' })}\n\n${master}`
  const here = raw.locations.getBySourceId('kitchen')!.id
  const scene = castSummary.scene({ cast, turn: 3, input: made.input(language), story: session, language, items: { at: (id: number, hidden?: boolean) => itemsIn(session, id, hidden ?? false), carried: (id: number) => carriedBy(session, id) } } as never)
  void here
  const report = eliasOf(made, language)
  const told = language === 'en'
    ? `You called activate_characters. Its result:\n- ${castName('elias', language)} intended: ${report.intent}${report.utterance === undefined ? '' : ` and said: "${report.utterance}"`} (commitment: medium)`
    : `你调用了 activate_characters，结果如下：\n- ${castName('elias', language)}的意图：${report.intent}${report.utterance === undefined ? '' : `，并说：“${report.utterance}”`}（投入程度：medium）`
  const prompt = `${scene}\n\n${language === 'en' ? 'The player\'s message:' : '玩家的消息：'}\n${made.input(language)}\n\n${told}\n\n${language === 'en' ? 'Now call resolve_round: answer with its arguments, one outcome for each character that acted or handled things.' : '现在调用 resolve_round：给出它的参数，为每个行动了或处理了物品的角色各给出一个结果。'}`
  return { persona, prompt, story: raw }
}

type Outcomes = { outcomes?: { character: string; summary?: string; item_changes?: { item: string; action: string; to?: string; from?: string }[] }[] }

export interface Scored { problems: Problem[]; refused: number }

/** The key of the item a model named: its key, its name, or the scene's "key: name" label. */
function keyOf(story: Built['story'], named: string): string {
  const text = named.split(':')[0]!.trim().toLowerCase()
  return story.items.list().find(item => (item.sourceId ?? '').toLowerCase() === text || item.name.toLowerCase() === named.trim().toLowerCase() || item.name.toLowerCase() === text)?.sourceId ?? named
}

type Built = { story: ReturnType<typeof createSessionStore> }

/** What the outcome would make of the story's records: its item changes are run through the real rules, in order, and where the thing ends up is held against what the round says happened. */
export function score(answer: Outcomes, made: TransferCase, story: Built['story']): Scored {
  if (!Array.isArray(answer.outcomes)) return { problems: [{ rule: 'unreadable', detail: JSON.stringify(answer).slice(0, 120) }], refused: 0 }
  const asked = answer.outcomes.flatMap(outcome => (outcome.item_changes ?? []).map(entry => ({ actor: outcome.character, spec: { item: keyOf(story, entry.item), action: entry.action, ...(entry.to === undefined ? {} : { to: entry.to }), ...(entry.from === undefined ? {} : { from: entry.from }) } as ItemChangeSpec })))
  let refused = 0
  for (const { actor, spec } of asked) {
    const who = story.characters.getBySourceId(actor)
    if (who === undefined) { refused += 1; continue }
    const planned = planItemChange(story, who.id, spec)
    if (!planned.ok) { refused += 1; continue }
    changeItem(story, who.id, spec)
  }
  const holder = (key: string) => { const item = story.items.getBySourceId(key)!; return story.items.holding(item.id)?.holder }
  const key = holder('key')
  const lantern = holder('lantern')
  const mara = story.characters.getBySourceId('mara')!.id
  const elias = story.characters.getBySourceId('elias')!.id
  const drawer = story.items.getBySourceId('drawer')!.id
  const wanted: Record<TransferCase['kind'], boolean> = {
    snatch: key?.kind === 'character' && key.characterId === mara,
    give: key?.kind === 'character' && key.characterId === mara,
    drop: key?.kind === 'location',
    put: lantern?.kind === 'item' && lantern.itemId === drawer,
    take: lantern?.kind === 'character' && lantern.characterId === mara,
    none: key?.kind === 'character' && key.characterId === elias && lantern?.kind === 'location',
  }
  if (wanted[made.kind]) return { problems: [], refused }
  const touched = asked.some(entry => entry.spec.item === (made.expect?.item ?? 'key'))
  return { problems: [{ rule: made.kind === 'none' ? 'spurious' : touched ? 'wrong' : 'unrecorded', detail: asked.map(entry => `${entry.actor}:${entry.spec.action} ${entry.spec.item}`).join(', ') || 'nothing recorded' }], refused }
}
