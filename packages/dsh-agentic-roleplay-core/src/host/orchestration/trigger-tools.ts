import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import { InvalidEditError, parseRecordsEdit } from '@dsh-agentic-roleplay/state'
import type { ToolDeps } from './tools.ts'

export const SET_TRIGGER_TOOL = 'set_trigger'
export const CANCEL_TRIGGER_TOOL = 'cancel_trigger'
export const LIST_TRIGGERS_TOOL = 'list_triggers'

export const SET_TRIGGER_DESCRIPTION = 'Plan something the world will do by itself when a condition turns true: a deadline that passes, someone arriving, a trap going off, news reaching a place. Use it for what the story has set up and is bound to reach, so it happens on time without you; not for what you can simply narrate now, and never to decide what a character does. It fires once unless repeat is set, no character is told it exists until it fires (announce makes a scheduled, known thing public), and at most two can be made in a turn. It is checked like a trigger of the world: every key must exist.'

/** How many triggers the game master may make in one turn: a plan is a few moments the story is bound to reach, not a script. */
const PER_TURN = 2

const WHEN = 'The condition, decided in code from what the story has recorded. One of: {type:"time", from:"1912-10-05T21:00", to?, window?:{from:"22:00",to:"06:00"}, days?:["fri"]} (story-local times); {type:"place", character, location, feature?}; {type:"variable", variable, subject?, op, value}; {type:"item", item, holder?, at?}; {type:"event", text? tags? involves?} (something recorded); {type:"fired", trigger}; or {type:"all"|"any", of:[...]}, {type:"not", of}. Keys are the ones the scene and the list tools show.'
const EFFECTS = 'What happens when it fires, one to six: {type:"edit", edit:{...}} a change of the records in the same format as edit_records (events, variable_changes, item_changes, moves, exit_changes, intents_added, engagements); {type:"beat", text} something you are told to weave into the story when it fits; {type:"cue", text, characters?} something characters notice. A beat or cue may name people and things as {character:key}, {place:key}, {item:key}.'

/**
 * The game master plans ahead: a moment the story is bound to reach (a deadline given, a promised arrival, a trap laid, a rumour that spreads) becomes a trigger the world carries out by itself when its
 * condition turns true, so the story advances without the game master having to remember. Triggers made in play belong to the story and are checked like a world's own.
 */
export function createTriggerTools(deps: ToolDeps): ToolDefinition[] {
  const ownerOf = (exec: { agent?: { session: { id: string } } }) => {
    const agent = exec.agent as Parameters<ToolDeps['turnOf']>[0] | undefined
    if (agent === undefined) throw new Error('the roleplay tools can only be called by an agent')
    const owner = { chat: agent.session.id, turn: deps.turnOf(agent) }
    const store = deps.stores(owner.chat)
    if (store === undefined) throw new Error('this chat is not a roleplay session')
    return { owner, store }
  }

  const setTrigger = defineTool({
    name: SET_TRIGGER_TOOL,
    description: SET_TRIGGER_DESCRIPTION,
    parameters: {
      key: { type: 'string', required: true, description: 'A short identifier: lowercase letters, digits, hyphens and underscores.' },
      name: { type: 'string', required: true, description: 'A short label for yourself; never shown to any character.' },
      when: { type: 'json', required: true, description: WHEN },
      effects: { type: 'json', required: true, description: EFFECTS },
      repeat: { type: 'boolean', description: 'Fire again after the condition went false and true again. Default no.' },
      cooldown_seconds: { type: 'integer', description: 'With repeat: the least story time between two firings.' },
      chance: { type: 'number', description: 'From 0 to 1: the chance that it fires when the condition turns true.' },
      priority: { type: 'integer', description: 'The higher goes first when several are due at once.' },
      expires: { type: 'string', description: 'After this story-local time it never fires.' },
      announce: { type: 'json', description: 'Only for something that is no secret, scheduled and known beforehand: {audience:"everyone"|{characters:[keys]}|{place:key}, text, from?, at?}; text is the public side only.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: `Trigger ${(value as { key: string }).key} is set. It fires by itself when its condition turns true; nobody is told before then${(value as { announced?: true }).announced === true ? ' except those it was announced to' : ''}.` }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { owner, store } = ownerOf(exec)
      await deps.engine.settle(owner.chat, owner.turn)
      const made = store.story.triggers.list().filter(trigger => trigger.origin === 'story' && trigger.createdTurn === owner.turn).length
      if (made >= PER_TURN) throw new Error(`${made} triggers were already made this turn, which is the most one turn makes: the rest can wait for a later turn`)
      const document = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))
      let edit
      try { edit = parseRecordsEdit({ turn: owner.turn, triggers: [document] }) } catch (error) { throw new Error(error instanceof Error ? error.message : String(error)) }
      try { store.story.edit(edit) } catch (error) {
        if (error instanceof InvalidEditError) throw new Error(`the trigger was not made: ${error.problems.join('; ')}`)
        throw error
      }
      return { key: String(args.key), ...(args.announce === undefined ? {} : { announced: true as const }) }
    },
  })

  const cancelTrigger = defineTool({
    name: CANCEL_TRIGGER_TOOL,
    description: 'Cancel a trigger made in play that has not fired yet, because the story has gone another way. The world\'s own triggers are not yours to cancel.',
    parameters: { key: { type: 'string', required: true, description: 'The key of the trigger, as list_triggers shows it.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: `Trigger ${(value as { key: string }).key} was cancelled: it will not fire.` }] },
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { store } = ownerOf(exec)
      const trigger = store.story.triggers.getByKey(args.key)
      if (trigger === undefined) throw new Error(`there is no trigger "${args.key}" (list_triggers shows them)`)
      if (trigger.origin !== 'story') throw new Error(`${args.key} is one of the world's own triggers, not made in play`)
      if (trigger.status !== 'dormant') throw new Error(`${args.key} is ${trigger.status}, so there is nothing to cancel`)
      store.story.triggers.update(trigger.id, { status: 'expired' })
      return { key: args.key }
    },
  })

  const listTriggers = defineTool({
    name: LIST_TRIGGERS_TOOL,
    description: 'List the triggers of the story: key, label, who made it, whether it is waiting, its condition and what it does when it fires. Use it before planning, so you do not make the same thing twice; look before you plan.',
    parameters: {},
    output: { schema: { type: 'json' }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const { store } = ownerOf(exec)
      return { triggers: store.story.triggers.list().map(trigger => ({ key: trigger.key, name: trigger.name, origin: trigger.origin === 'story' ? 'made in play' : 'the world', status: trigger.status, fired: trigger.fireCount, when: trigger.condition, effects: trigger.effects.map(effect => effect.type) })) }
    },
  })

  return [setTrigger, cancelTrigger, listTriggers]
}
