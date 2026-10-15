import {themes as prismThemes} from 'prism-react-renderer'
import type {Config} from '@docusaurus/types'
import type * as Preset from '@docusaurus/preset-classic'

const config: Config = {
  title: 'DSH Agentic Roleplay',
  tagline: 'Persistent, agent-driven roleplay for DeepSeek Harness',
  favicon: 'img/favicon.svg',
  future: {v4: true, faster: false},
  url: 'https://firefox2100.github.io',
  baseUrl: '/dsh-agentic-roleplay/',
  organizationName: 'Firefox2100',
  projectName: 'dsh-agentic-roleplay',
  onBrokenLinks: 'throw',
  headTags: [{
    tagName: 'script',
    attributes: {type: 'application/ld+json'},
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: 'DSH Agentic Roleplay',
      description: 'Persistent, agent-driven roleplay and world authoring for DeepSeek Harness.',
      codeRepository: 'https://github.com/Firefox2100/dsh-agentic-roleplay',
      programmingLanguage: 'TypeScript',
      runtimePlatform: 'DeepSeek Harness 0.2.x',
      license: 'https://www.gnu.org/licenses/gpl-3.0.html',
    }),
  }],
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
      sitemap: {lastmod: 'date'},
      theme: {customCss: './src/css/custom.css'},
    } satisfies Preset.Options,
  ]],
  themeConfig: {
    image: 'img/social-card.png',
    metadata: [
      {name: 'keywords', content: 'DeepSeek Harness, DSH, agentic roleplay, roleplaying game, world authoring, persistent memory, local AI'},
      {name: 'robots', content: 'index, follow, max-image-preview:large'},
    ],
    colorMode: {respectPrefersColorScheme: true},
    navbar: {
      title: 'DSH Agentic Roleplay',
      logo: {alt: 'Agentic Roleplay', src: 'img/logo.svg'},
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
