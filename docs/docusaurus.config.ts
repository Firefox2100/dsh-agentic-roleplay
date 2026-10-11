import {themes as prismThemes} from 'prism-react-renderer'
import type {Config} from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title: 'DSH Agentic Roleplay',
  tagline: 'Persistent, agent-driven roleplay for DeepSeek Harness',
  favicon: 'img/favicon.ico',
  future: {v4: true, faster: false},
  url: 'https://firefox2100.github.io',
  baseUrl: '/dsh-agentic-roleplay/',
  organizationName: 'Firefox2100',
  projectName: 'dsh-agentic-roleplay',
  onBrokenLinks: 'throw',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'zh-Hans'],
    localeConfigs: {
      en: {label: 'English', htmlLang: 'en-GB'},
      'zh-Hans': {label: '简体中文', htmlLang: 'zh-CN'},
    },
  },
  presets: [[
    'classic',
    {
      docs: {
        routeBasePath: '/docs',
        sidebarPath: './sidebars.ts',
        editUrl: 'https://github.com/Firefox2100/dsh-agentic-roleplay/tree/main/docs/docs/',
      },
      blog: false,
      theme: {customCss: './src/css/custom.css'},
    } satisfies Preset.Options,
  ]],
  themeConfig: {
    colorMode: {respectPrefersColorScheme: true},
    navbar: {
      title: 'DSH Agentic Roleplay',
      items: [
        {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Documentation'},
        {type: 'localeDropdown', position: 'right'},
        {href: 'https://github.com/Firefox2100/dsh-agentic-roleplay', label: 'GitHub', position: 'right'},
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {title: 'Start', items: [
          {label: 'Installation', to: '/docs/getting-started/installation'},
          {label: 'Create a world', to: '/docs/getting-started/first-world'},
          {label: 'Start a session', to: '/docs/getting-started/first-session'},
        ]},
        {title: 'Author', items: [
          {label: 'World authoring', to: '/docs/authoring/overview'},
          {label: 'World format', to: '/docs/world-format/overview'},
        ]},
        {title: 'Develop', items: [
          {label: 'Architecture', to: '/docs/developers/architecture'},
          {label: 'Maintainer guide', to: '/docs/maintainers/overview'},
          {label: 'GitHub', href: 'https://github.com/Firefox2100/dsh-agentic-roleplay'},
        ]},
      ],
      copyright: `Copyright © ${new Date().getFullYear()} DSH Agentic Roleplay contributors.`,
    },
    prism: {theme: prismThemes.github, darkTheme: prismThemes.dracula},
  } satisfies Preset.ThemeConfig,
}

export default config
