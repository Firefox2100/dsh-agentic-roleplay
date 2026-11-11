import { describe, expect, it } from 'vitest'
import type { Dictionaries, RoleplayLocaleId } from '../../src/client/i18n.ts'
import { dictionaries as branch } from '../../src/client/branch/locales.ts'
import { dictionaries as chat } from '../../src/client/chat-settings/locales.ts'
import { dictionaries as trace } from '../../src/client/chat-settings/trace-locales.ts'
import { dictionaries as interfaceCopy } from '../../src/client/interface/locales.ts'
import { dictionaries as panel } from '../../src/client/panel/locales.ts'
import { dictionaries as recall } from '../../src/client/recall/locales.ts'
import { dictionaries as reference } from '../../src/client/reference/locales.ts'
import { dictionaries as settingsForm } from '../../src/client/settings-form/locales.ts'
import { dictionaries as settings } from '../../src/client/settings/locales.ts'
import { dictionaries as transcript } from '../../src/client/transcript/locales.ts'
import { dictionaries as avatars } from '../../src/client/pages/avatars/locales.ts'
import { dictionaries as catalogue } from '../../src/client/pages/catalogue/locales.ts'
import { dictionaries as lorebooks } from '../../src/client/pages/lorebooks/locales.ts'
import { dictionaries as presets } from '../../src/client/pages/presets/locales.ts'
import { dictionaries as prompts } from '../../src/client/pages/prompts/locales.ts'
import { dictionaries as sessions } from '../../src/client/pages/sessions/locales.ts'
import { dictionaries as sync } from '../../src/client/pages/sync/locales.ts'
import { dictionaries as worlds } from '../../src/client/pages/worlds/locales.ts'
import { dictionaries as gallery } from '../../src/client/widgets/gallery-view/locales.ts'
import { dictionaries as importCard } from '../../src/client/widgets/import-card/locales.ts'
import { dictionaries as importSelection } from '../../src/client/widgets/import-selection/locales.ts'
import { dictionaries as sampling } from '../../src/client/widgets/sampling-fields/locales.ts'
import { dictionaries as toolSwitches } from '../../src/client/widgets/tool-switches/locales.ts'
import { dictionaries as world } from '../../src/client/world-editor/locales.ts'
import { dictionaries as dice } from '../../src/client/world-editor/dice-locales.ts'
import { dictionaries as packs } from '../../src/client/world-editor/packs-locales.ts'
import { dictionaries as questions } from '../../src/client/world-editor/questions-locales.ts'
import { dictionaries as triggers } from '../../src/client/world-editor/triggers-locales.ts'

const LOCALES = ['en', 'zh', 'ja', 'es', 'fr', 'de', 'ru', 'pt'] satisfies RoleplayLocaleId[]
const catalogues: Record<string, Dictionaries<string>> = {
  branch, chat, trace, interface: interfaceCopy, panel, recall, reference, settingsForm, settings,
  transcript, avatars, catalogue, lorebooks, presets, prompts, sessions, sync, worlds, gallery,
  importCard, importSelection, sampling, toolSwitches, world, dice, packs, questions, triggers,
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\$?\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(match => match[0]).sort()
}

describe('the roleplay UI translations', () => {
  it('ships every UI catalogue in exactly the supported locales', () => {
    for (const [name, dictionaries] of Object.entries(catalogues)) {
      expect(Object.keys(dictionaries).sort(), name).toEqual([...LOCALES].sort())
    }
  })

  it('keeps every key, value and interpolation placeholder in every locale', () => {
    for (const [name, dictionaries] of Object.entries(catalogues)) {
      const englishKeys = Object.keys(dictionaries.en).sort()
      for (const locale of LOCALES) {
        expect(Object.keys(dictionaries[locale]).sort(), `${name} ${locale} keys`).toEqual(englishKeys)
        for (const key of englishKeys) {
          const value = dictionaries[locale][key]
          const english = dictionaries.en[key]
          if (value === undefined || english === undefined) throw new Error(`Missing ${name} ${locale}.${key}`)
          expect(value.trim(), `${name} ${locale}.${key}`).not.toBe('')
          expect(placeholders(value), `${name} ${locale}.${key} placeholders`).toEqual(placeholders(english))
        }
      }
    }
  })
})
