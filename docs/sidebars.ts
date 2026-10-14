import type {SidebarsConfig} from '@docusaurus/plugin-content-docs'

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {type: 'category', label: 'Getting started', items: [
      'getting-started/installation', 'getting-started/ai-services',
      'getting-started/first-world', 'getting-started/first-session',
    ]},
    {type: 'category', label: 'Playing', items: [
      'playing/interface', 'playing/sessions', 'playing/media', 'playing/settings',
    ]},
    {type: 'category', label: 'World authoring', items: [
      'authoring/overview', 'authoring/editor', 'authoring/assistant',
      'authoring/avatars-import', 'authoring/visual-identity', 'authoring/interface-packs',
    ]},
    {type: 'category', label: 'World format', items: [
      'world-format/overview', 'world-format/world', 'world-format/characters',
      'world-format/locations-items', 'world-format/factions-lore',
      'world-format/plots-automation', 'world-format/prompts-media',
    ]},
    {type: 'category', label: 'How it works', items: [
      'concepts/orchestration', 'concepts/memory-knowledge',
      'concepts/time-pacing', 'concepts/images-context',
    ]},
    {type: 'category', label: 'Plugin development', items: [
      'developers/architecture', 'developers/state',
      'developers/extensions', 'developers/dsh-integration',
    ]},
    {type: 'category', label: 'Maintainer guide', items: [
      'maintainers/overview', 'maintainers/orchestration',
      'maintainers/state-memory', 'maintainers/world-prompts-import',
      'maintainers/images-capabilities', 'maintainers/interface-packs', 'maintainers/dsh-contracts',
      'maintainers/testing-release',
      {type: 'category', label: 'Detailed specifications', items: [
        'specifications/world-files', 'specifications/turn-engine',
        'specifications/story-state', 'specifications/image-system',
        'specifications/dsh-api-contract', 'specifications/prompt-system',
        'specifications/import-pipeline', 'specifications/capability-integration',
      ]},
    ]},
    {type: 'category', label: 'Reference', items: [
      'reference/configuration', 'reference/filesystem', 'reference/interface-pack-format',
      'reference/troubleshooting', 'reference/glossary',
    ]},
  ],
}

export default sidebars
