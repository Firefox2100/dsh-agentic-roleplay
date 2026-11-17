/** A small invented card and the answers a model would give to its jobs, for tests of the import's steps. */

export const book = { entries: [
  { comment: 'Tam', content: 'Old Tam keeps the lighthouse and writes the ledger.', keys: ['Tam'] },
  { comment: 'The Lighthouse', content: 'A white tower on the point, with a cellar.', keys: [] },
  { comment: 'Style', content: 'Write short answers.', keys: [] },
  { comment: 'History', content: 'The harbour was founded by net makers.', keys: [] },
  { comment: 'Skipped', content: 'Switched off by the person.', keys: [] },
] }

export const answers = (job: { prompt: string; persona: string }): unknown => {
  const prompt = job.prompt
  if (job.persona.startsWith('You read one piece')) {
    if (prompt.includes('Title: Tam')) return { roles: ['character'], targets: [{ name: 'Old Tam', kind: 'character' }] }
    if (prompt.includes('Title: The Lighthouse')) return { roles: ['place'], targets: [{ name: 'The Lighthouse', kind: 'place' }] }
    if (prompt.includes('Title: Style')) return { roles: ['instruction'], targets: [] }
    if (prompt.includes('Title: History')) return { roles: ['world'], targets: [] }
    if (prompt.includes('Piece: scenario')) return { roles: ['scenario'], targets: [] }
    return { roles: ['irrelevant'], targets: [] }
  }
  if (job.persona.startsWith('You turn the instructions')) return { narration: 'Write short answers, in a dry voice.', characters: 'Stay in character as ${name}.', world_rules: ['There are no firearms in this world.'], left_out: ['a status panel'], persona_names: [] }
  if (job.persona.startsWith('You find what a character card keeps track of')) return { variables: [{ key: 'Trust Meter', name: 'Trust', kind: 'number', subject: 'character', only: ['Old Tam'], min: 0, max: 100, integer: true, default: 50, bands: [{ up_to: 40, label: 'Wary' }, { up_to: 100, label: 'Easy' }] }], left_out: ['an output format'] }
  if (job.persona.startsWith('You make the final list')) return { characters: [{ name: 'Old Tam', aliases: ['Tam'] }], places: [{ name: 'The Lighthouse', aliases: [] }], factions: [], things: [] }
  if (prompt.includes('Make the character')) return { tier: 'principal', kind: 'person', summary: 'Keeps the light.', personality: 'Gruff.', background: '', appearance: '', speech: { style: '', examples: [] }, start: { location: 'The Lighthouse' } }
  if (prompt.includes('Make the place')) return { description: 'A white tower.' }
  if (job.persona.startsWith('You turn one piece')) return { entries: [{ title: 'Founding', kind: 'history', summary: 'Net makers founded it.', body: 'The harbour was founded by net makers.', subjects: [{ kind: 'place', name: 'The Lighthouse' }] }] }
  return { description: 'A harbour town.', tags: ['harbour'] }
}
