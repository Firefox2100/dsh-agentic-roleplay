import { readPreset as readStPreset } from '../import/preset.ts'
import type { PresetSampling } from '../../shared/presets.ts'

/**
 * The chosen prompts of a SillyTavern preset as they are, with no model between: their texts, in the order the preset sends them, become one writing guidance (the narration style).
 * The preset's own macros are played and its names for the characters are replaced as for any import; only what a prompt file cannot hold is changed, so that `${` and `{{` in the text
 * are not read as variables.
 * @throws {ImportCardError} when the file is not a preset or holds nothing to read.
 */
export function verbatimStyle(file: Buffer, fileName: string): { name: string; sampling: PresetSampling; text: string } {
  const preset = readStPreset(file, fileName)
  const text = preset.pieces.join('\n\n').replace(/\$\{/g, '$ {').replace(/\{\{/g, '{ {')
  return { name: preset.name, sampling: preset.sampling, text }
}
