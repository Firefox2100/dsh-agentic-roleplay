import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { CardVersion } from '../import/card-tools.ts'
import { contextOf, type Prompting } from '../import/tools.ts'
import type { ImportSettings } from '../import/service.ts'
import type { TextOf } from '../import/run.ts'
import type { KitId } from '../../shared/checks.ts'
import type { AuthoredWorldReader } from '../authoring/read-tools.ts'
import { loadCardEvidence } from './card-evidence.ts'
import { presentReport } from './present.ts'
import { CHECKS, runChecks } from './run.ts'

const output = { schema: { type: 'json' as const }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }

const deepParameter = { type: 'boolean' as const, description: 'Also run the checks a model judges (slower, one or more model requests each). Leave it off for a quick look; turn it on when the quick checks leave the world looking thin, when the person asks for a thorough check, or before you say an import is done.' }

/** What the tools need to ask a model: the import's own settings and the texts in the language of the world's authoring. */
export interface Judging {
  settings: () => ImportSettings
  prompting: Prompting
}

function kitTool(reader: AuthoredWorldReader, judging: Judging, name: string, kit: KitId, description: string, card = false): ToolDefinition {
  return defineTool({
    name,
    description,
    parameters: { ...(card ? { version: { type: 'string' as const, enum: ['current', 'new'], description: 'current (the default) is the card the world was made from; new is the newer version waiting to update it.' } } : {}), deep: deepParameter },
    output,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const { record } = await reader.read(exec)
      const version: CardVersion = args.version === 'new' ? 'new' : 'current'
      const evidence = card ? await loadCardEvidence(record.directory, version) : undefined
      if (card && evidence === undefined) throw new Error(version === 'new' ? 'no newer version of the card is waiting to update this world' : 'this world has no source card: it was not imported from one, or its .import folder was removed')
      const language = judging.prompting.languages().get(record.summary.id)
      const text: TextOf = (id, variables) => judging.prompting.prompts().text(id, language, variables)
      const model = args.deep === true ? contextOf(exec, judging.settings(), text, language) : undefined
      const report = await runChecks({ world: record, ...(evidence === undefined ? {} : { card: evidence }), ...(model === undefined ? {} : { model }) }, { kits: [kit], deep: args.deep === true })
      return JSON.parse(JSON.stringify(presentReport(report))) as never
    },
  })
}

/** The checks of the suite as tools of a world authoring chat; each kit is one call, and what it finds is stored with the world for the next run to compare with. */
export function checkTools(reader: AuthoredWorldReader, judging: Judging): ToolDefinition[] {
  return [
    kitTool(reader, judging, 'check_world', 'consistency', 'Check the world for inconsistencies: whether a story could start from it (every file reads and everything that refers to something refers to something that is there; it names the problems of the first part of the world that has any, so run it again after fixing them), places no one can reach, names that clash, tracked values that are the same thing twice, and prompts the story could not use. Run it before you say a world is done. It reads only; each finding says where it is and, when clear, what would fix it.'),
    kitTool(reader, judging, 'check_card', 'fidelity', 'Compare the world with the card it was imported from, which is kept: whether every piece of the card the import read is in the world, whether every name in the world occurs in the card, whether the numbers the card gives were kept, and, with version new, what a newer card waiting to update the world changed that the world does not say yet. With deep, a model also compares each document with the pieces it was made from and quotes the facts that were lost or made up. A finding is a pointer: read the piece with card_read before you change anything. It reads only.', true),
    kitTool(reader, judging, 'check_quality', 'quality', 'Check the authoring quality of the world: whether someone can be played, whether the characters that matter have sheets to play from, places with nothing in them, what the world says about itself. With deep, a model also judges whether each sheet is enough to play and what the world is missing to play well. It reads only; a finding is a gap to fill from what the card or the person says, never from invention.'),
    defineTool({
      name: 'check_list',
      description: 'List the checks of the suite: which kit each belongs to, whether the program or a model decides it, and what it needs.',
      parameters: {},
      output,
      isConcurrencySafe: () => true,
      async execute() {
        return JSON.parse(JSON.stringify(CHECKS.map(check => ({ id: check.id, kit: check.kit, mode: check.mode, needs: check.needs, description: check.description })))) as never
      },
    }),
  ]
}
