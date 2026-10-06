import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { relative } from 'node:path'
import type { ImageGenerationService } from 'dsh-ai-core'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  characterKey, itemKey, locationKey, type SessionStore, type VisualIdentity, type VisualSubjectKind,
} from 'dsh-roleplay-state'
import { generateReferenceImage, generateTransientImage } from './generator.ts'
import { nextSceneSerial, referenceImagePath, type EntityImageAddress, type VisualImageSubject } from './storage.ts'

interface Subject {
  kind: VisualSubjectKind
  key: string
  id: number
  name: string
  description: string
  current: string
  sourceId?: string
  hidden?: boolean
}

export interface ImageToolDeps {
  root: string
  story: Omit<SessionStore, 'snapshotTo' | 'close'>
  service: ImageGenerationService
  turn: number
  timelineNode: string
  /** Filled by successful generation tools, in call order. */
  generated?: string[]
  referenceMode?: 'text-only' | 'prefer-reference' | 'require-reference'
  signal?: AbortSignal
}

const kindSchema = { type: 'string', enum: ['character', 'location', 'item'] } as const
const stringList = { type: 'array', items: { type: 'string' } } as const

type ImageStory = ImageToolDeps['story']

function subjects(story: ImageStory): Subject[] {
  const characters = story.characters.list().map((character): Subject => {
    const state = story.characterStates.get(character.id)
    return { kind: 'character', key: characterKey(character), id: character.id, name: character.name, description: character.appearance || character.summary, current: [state?.publicState, state?.activity].filter(Boolean).join('; '), ...(character.sourceId === undefined ? {} : { sourceId: character.sourceId }) }
  })
  const locations = story.locations.list().map((location): Subject => ({ kind: 'location', key: locationKey(location), id: location.id, name: location.name, description: location.description, current: '', ...(location.sourceId === undefined ? {} : { sourceId: location.sourceId }) }))
  const items = story.items.list().map((item): Subject => ({ kind: 'item', key: itemKey(item), id: item.id, name: item.name, description: item.description, current: item.quality, hidden: item.hidden, ...(item.sourceId === undefined ? {} : { sourceId: item.sourceId }) }))
  return [...characters, ...locations, ...items]
}

function findSubject(story: ImageStory, kind: VisualSubjectKind, key: string): Subject {
  const found = subjects(story).find(subject => subject.kind === kind && subject.key === key)
  if (found === undefined) throw new Error(`there is no ${kind} "${key}"`)
  return found
}

function address(subject: Subject, identity?: VisualIdentity): EntityImageAddress {
  return { kind: subject.kind, localId: subject.sourceId ?? subject.id, ...(identity?.globalId === undefined ? {} : { globalId: identity.globalId }) }
}

function imageSubject(subject: Subject, identity: VisualIdentity): VisualImageSubject {
  return { ...address(subject, identity), name: subject.name, identityVersion: identity.version }
}

function identityOf(story: ImageStory, subject: Subject): VisualIdentity {
  const identity = story.visualIdentities.get(subject.kind, subject.id)
  if (identity === undefined) throw new Error(`${subject.kind} ${subject.key} has no visual identity: establish it with set_visual_identity first`)
  return identity
}

const output = (text: string) => [{ type: 'text' as const, text }]

/** Model-facing tools used by the image author. They are registered only on that child's scope. */
export function imageTools(deps: ImageToolDeps): ToolDefinition[] {
  const recorded = deps.generated ?? []
  const list = defineTool({
    name: 'list_visual_subjects',
    description: 'List the characters, places and things available to depict, with their stable visual identity and current visible state.',
    parameters: { kind: { ...kindSchema, description: 'Limit the list to one kind.' } },
    output: { schema: { type: 'array', items: { type: 'json' } }, render: (_args, value) => output(JSON.stringify(value, null, 2)) },
    execute(args) {
      const found = subjects(deps.story).filter(subject => args.kind === undefined || subject.kind === args.kind).map(subject => {
        const identity = deps.story.visualIdentities.get(subject.kind, subject.id)
        return { kind: subject.kind, key: subject.key, name: subject.name, description: subject.description, current: subject.current, ...(subject.hidden === undefined ? {} : { hidden: subject.hidden }), ...(identity === undefined ? {} : { visual_identity: { description: identity.description, tags: identity.tags, negative_tags: identity.negativeTags, version: identity.version, ...(identity.globalId === undefined ? {} : { global_id: identity.globalId }) }, reference_exists: existsSync(referenceImagePath(deps.root, address(subject, identity))) }) }
      })
      return Promise.resolve(found)
    },
  })
  const setIdentity = defineTool({
    name: 'set_visual_identity',
    description: 'Establish or correct the canonical visual identity of one entity. Include only traits that remain stable between scenes; never expression, pose, current clothing, activity, lighting, weather or surroundings.',
    parameters: {
      kind: { ...kindSchema, required: true }, key: { type: 'string', required: true },
      description: { type: 'string', required: true, description: 'One or two precise sentences of stable visual identity.' },
      tags: { ...stringList, required: true, description: 'Stable positive visual traits.' },
      negative_tags: { ...stringList, required: true, description: 'Contradictions or drift to avoid.' },
      global_id: { type: 'string', description: 'Existing globally unique identity; omit rather than invent one.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => output(`Visual identity stored: ${JSON.stringify(value)}`) },
    execute(args) {
      const subject = findSubject(deps.story, args.kind, args.key)
      const identity = deps.story.visualIdentities.set(subject.kind, subject.id, { description: args.description, tags: args.tags, negativeTags: args.negative_tags, ...(args.global_id === undefined ? {} : { globalId: args.global_id }) })
      return Promise.resolve({ kind: subject.kind, key: subject.key, version: identity.version })
    },
  })
  const reference = defineTool({
    name: 'generate_reference_image',
    description: 'Generate or replace the canonical reference.png of one entity from its stored visual identity.',
    parameters: { kind: { ...kindSchema, required: true }, key: { type: 'string', required: true }, art_direction: { type: 'string', description: 'Composition and shared art style, without changing identity.' } },
    output: { schema: { type: 'json' }, render: (_args, value) => output(`Reference image generated: ${(value as { path: string }).path}`) },
    async execute(args) {
      const subject = findSubject(deps.story, args.kind, args.key)
      const identity = identityOf(deps.story, subject)
      const path = await generateReferenceImage(deps.service, { root: deps.root, subject: imageSubject(subject, identity), identity, ...(args.art_direction === undefined ? {} : { artDirection: args.art_direction }), ...(deps.signal === undefined ? {} : { signal: deps.signal }) })
      const local = relative(deps.root, path)
      recorded.push(local)
      return { path: local }
    },
  })
  const transient = defineTool({
    name: 'generate_transient_image',
    description: 'Generate a new immutable scene image for this turn. Every subject needs a stored visual identity. Describe only visible transient differences for each subject.',
    parameters: {
      scene: { type: 'string', required: true, description: 'The established visible moment, composition and environment; invent no event or subject.' },
      subjects: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { kind: { ...kindSchema, required: true }, key: { type: 'string', required: true }, transient: { type: 'string', required: true, description: 'Current expression, clothing, condition, activity, pose and interaction only.' } } } },
      art_direction: { type: 'string', description: 'Camera, composition and shared art style.' },
      segment: { type: 'integer', description: 'Optional zero-based narration segment this image illustrates.' },
    },
    output: { schema: { type: 'json' }, render: (_args, value) => output(`Scene image generated: ${(value as { path: string }).path}`) },
    async execute(args) {
      if (args.subjects.length === 0) throw new Error('name at least one subject to depict')
      if (args.segment !== undefined && args.segment < 0) throw new Error('segment must be zero or greater')
      const selected = args.subjects.map((entry) => {
        const subject = findSubject(deps.story, entry.kind, entry.key)
        const identity = identityOf(deps.story, subject)
        return { ...imageSubject(subject, identity), identity, transient: entry.transient }
      })
      const referenceMode = deps.referenceMode ?? 'prefer-reference'
      const referencePaths = selected.map(subject => ({ subject, path: referenceImagePath(deps.root, subject) }))
      if (referenceMode === 'require-reference') {
        const missing = referencePaths.filter(entry => !existsSync(entry.path))
        if (missing.length > 0) throw new Error(`canonical reference images are required; generate these first: ${missing.map(entry => `${entry.subject.kind} ${entry.subject.name}`).join(', ')}`)
      }
      const references = referenceMode === 'text-only' ? [] : await Promise.all(referencePaths.filter(entry => existsSync(entry.path)).map(async entry => ({ data: new Blob([await readFile(entry.path)], { type: 'image/png' }), description: `${entry.subject.kind} ${entry.subject.name}` })))
      const serial = await nextSceneSerial(deps.root, deps.timelineNode)
      const path = await generateTransientImage(deps.service, { root: deps.root, timelineNode: deps.timelineNode, turn: deps.turn, serial, scene: args.scene, subjects: selected, ...(args.art_direction === undefined ? {} : { artDirection: args.art_direction }), ...(args.segment === undefined ? {} : { segment: args.segment }), ...(references.length === 0 ? {} : { references }), ...(deps.signal === undefined ? {} : { signal: deps.signal }) })
      const local = relative(deps.root, path)
      recorded.push(local)
      return { path: local, serial }
    },
  })
  return [list, setIdentity, reference, transient]
}
