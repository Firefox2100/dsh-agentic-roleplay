import type { CharacterDefinition, LocationDefinition } from 'dsh-roleplay-model'
import { mapLimit } from '../import/run.ts'
import { CheckSkipped, foundBy, type Check, type CheckInput, type Found } from './check.ts'
import { verdictOf } from './judge.ts'
import { loaded } from './loaded.ts'

/** The most players' first scenes a model reads: a world with many playable characters is judged by the first few. */
const SCENES_JUDGED = 3
const OPENING_CHARS = 2500
const SCENE_CHARS = 3500

interface Scene {
  player: CharacterDefinition
  place: LocationDefinition | undefined
  /** Who else starts there. */
  others: CharacterDefinition[]
  things: string[]
  /** Places a way leads to from here, or from which one leads here. */
  ways: number
}

/** Where each character the player may play starts and what is around them, as the files say it. */
async function scenesOf(input: CheckInput): Promise<Scene[]> {
  const [{ characters }, { locations }, { items }] = await Promise.all([loaded.characters(input), loaded.locations(input), loaded.items(input)])
  const players = characters.filter(character => character.role === 'playable')
  if (players.length === 0) throw new CheckSkipped('no character can be played (see quality-cast)')
  return players.map((player): Scene => {
    const at = player.start.place?.location
    const place = locations.find(location => location.id === at)
    return {
      player,
      place,
      others: place === undefined ? [] : characters.filter(other => other.id !== player.id && other.kind === 'person' && other.start.place?.location === place.id),
      things: place === undefined ? [] : items.filter(item => item.start.kind === 'location' && item.start.location === place.id && !item.hidden).map(item => item.name),
      ways: place === undefined ? 0 : place.exits.length + locations.filter(other => other.id !== place.id && other.exits.some(exit => exit.to === place.id)).length,
    }
  })
}

const firstScene: Check = {
  id: 'first-scene',
  kit: 'playability',
  mode: 'code',
  needs: [],
  description: 'For each character the player may play: that they start in a place of the world, with other people, things or features there, so the first turn has something to react to. (A place with no way out is named by world-graph.)',
  async run(input) {
    const { locations } = await loaded.locations(input)
    const found: Found[] = []
    for (const scene of await scenesOf(input)) {
      const where = `characters/${scene.player.id}`
      if (scene.place === undefined) {
        if (locations.length > 0) found.push({ severity: 'warning', code: 'start-nowhere', where, message: `${scene.player.name} starts in no place of the world, though the world has places`, hint: 'Give the character a start place.' })
        continue
      }
      if (scene.others.length === 0 && scene.things.length === 0 && scene.place.features.length === 0) found.push({ severity: 'info', code: 'start-empty', where, message: `${scene.player.name} starts alone in ${scene.place.name}, with no people, things or features there to act on` })
      else if (scene.others.length === 0) found.push({ severity: 'info', code: 'start-alone', where, message: `${scene.player.name} starts alone in ${scene.place.name}: nothing answers until they move or something happens` })
    }
    return foundBy('first-scene', found)
  },
}

const HOOK_SCHEMA = { type: 'object', properties: { reason: { type: 'string' }, playable: { type: 'boolean' } }, required: ['reason', 'playable'], additionalProperties: false } as const

const opening: Check = {
  id: 'opening-playable',
  kit: 'playability',
  mode: 'decision',
  needs: ['model'],
  description: 'Whether a player who has read the opening and the first scene of their character knows where they are and has something to do. A decision model may answer; what it is unsure of goes to the language model.',
  async run(input) {
    const model = input.model!
    const scenes = (await scenesOf(input)).slice(0, SCENES_JUDGED)
    const info = await loaded.info(input)
    const found: Found[] = []
    await mapLimit(scenes, model.concurrency, async (scene) => {
      const text = [
        `opening: ${info.opening.trim() === '' ? '(none: the story starts with "The story begins.")' : info.opening.slice(0, OPENING_CHARS)}`,
        `the player's character: ${scene.player.name}: ${scene.player.summary}`,
        ...(scene.player.start.activity === '' ? [] : [`doing: ${scene.player.start.activity}`]),
        ...scene.player.start.intents.slice(0, 3).map(intent => `wants: ${intent.name}: ${intent.description}`),
        scene.place === undefined ? 'place: (none)' : `place: ${scene.place.name}: ${scene.place.description}`,
        ...(scene.place?.features ?? []).slice(0, 8).map(feature => `feature: ${feature.name}`),
        ...scene.others.slice(0, 8).map(other => `here: ${other.name}: ${other.summary}`),
        ...scene.things.slice(0, 8).map(thing => `thing here: ${thing}`),
        `ways out: ${scene.ways}`,
      ].join('\n').slice(0, SCENE_CHARS)
      let reason = ''
      const instructions = model.text('checks/decide-opening')
      const verdict = await verdictOf(model, { scene: text }, 'playable', instructions, async () => {
        const answer = await model.run<{ reason: string; playable: boolean }>({ persona: instructions, prompt: text, result: HOOK_SCHEMA as never, maxTokens: 500 })
        reason = answer.reason
        return answer.playable
      })
      if (!verdict.yes) found.push({ severity: 'warning', code: 'opening-flat', where: `characters/${scene.player.id}`, message: `a player of ${scene.player.name} may not know what to do at the start${reason === '' ? '' : `: ${reason}`}`, hint: 'Give the opening or the first scene a situation, a person or a want to act on, from what the card says; do not make it up.' })
    })
    return foundBy('opening-playable', found)
  },
}

export const playabilityChecks: readonly Check[] = [firstScene, opening]
