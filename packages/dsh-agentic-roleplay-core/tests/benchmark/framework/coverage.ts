import type { Language } from '../language.ts'
import { LANGUAGES } from '../language.ts'
import { tierOf, CAST_TIERS } from './features.ts'
import { FEATURES, type BenchData, type Feature } from './types.ts'

export interface FeatureCoverage {
  feature: Feature
  rows: string[]
  themes: string[]
  languages: Language[]
}

export interface Gap {
  /** The feature, or the cast tier of a theme. */
  what: string
  /** What is missing, in words. */
  missing: string
  /** The reason it is left out on purpose, when the data says so. */
  excused?: string
}

export interface Coverage {
  features: FeatureCoverage[]
  /** For each theme, the cast tiers seen in its rows. */
  casts: Record<string, string[]>
  gaps: Gap[]
}

/** What the rows cover, and what they do not: a feature seen in fewer than two themes or in one language only is a gap, unless the data excuses it. */
export function coverage(data: BenchData): Coverage {
  const features: FeatureCoverage[] = FEATURES.map(feature => {
    const rows = data.rows.filter(row => row.features.includes(feature))
    return { feature, rows: rows.map(row => row.id), themes: [...new Set(rows.map(row => data.worlds[row.world]?.meta.theme ?? '?'))].sort(), languages: LANGUAGES.filter(language => rows.some(row => row.language === language)) }
  })
  const casts: Coverage['casts'] = {}
  for (const row of data.rows) {
    const theme = data.worlds[row.world]?.meta.theme ?? '?'
    casts[theme] = [...new Set([...casts[theme] ?? [], tierOf(row.cast.npcs)])].sort((a, b) => CAST_TIERS.findIndex(tier => tier.id === a) - CAST_TIERS.findIndex(tier => tier.id === b))
  }
  const gaps: Gap[] = []
  const excuse = (feature: Feature, themes: readonly string[]): string | undefined => data.excluded.find(entry => entry.features.includes(feature) && (entry.where === 'any' || themes.includes(entry.where)))?.reason
  const allThemes = [...new Set(Object.values(data.worlds).map(world => world.meta.theme))].sort()
  for (const entry of features) {
    if (entry.rows.length === 0) { gaps.push({ what: entry.feature, missing: 'no row uses it', ...excuse(entry.feature, allThemes) === undefined ? {} : { excused: excuse(entry.feature, allThemes)! } }); continue }
    const missingThemes = allThemes.filter(theme => !entry.themes.includes(theme))
    if (entry.themes.length < 2) gaps.push({ what: entry.feature, missing: `seen in ${entry.themes.length} theme (${entry.themes.join(', ')}); needs two`, ...excuse(entry.feature, allThemes) === undefined ? {} : { excused: excuse(entry.feature, allThemes)! } })
    else if (missingThemes.length > 0 && missingThemes.every(theme => excuse(entry.feature, [theme]) !== undefined)) continue
    if (entry.languages.length < LANGUAGES.length) gaps.push({ what: entry.feature, missing: `only in ${entry.languages.join(', ')}`, ...excuse(entry.feature, allThemes) === undefined ? {} : { excused: excuse(entry.feature, allThemes)! } })
  }
  for (const [theme, tiers] of Object.entries(casts)) {
    for (const tier of CAST_TIERS) if (!tiers.includes(tier.id)) gaps.push({ what: `cast of ${theme}`, missing: `theme ${theme} has no ${tier.id} cast row` })
  }
  return { features, casts, gaps }
}

/** The report as text, for a person to read. */
export function describeCoverage(report: Coverage): string {
  const lines = ['Feature coverage (rows / themes / languages):']
  for (const entry of report.features) lines.push(`  ${entry.feature.padEnd(16)} ${String(entry.rows.length).padStart(3)} rows  [${entry.themes.join(', ')}]  [${entry.languages.join(', ')}]`)
  lines.push('Cast tiers by theme:', ...Object.entries(report.casts).map(([theme, tiers]) => `  ${theme}: ${tiers.join(', ')}`))
  lines.push(`Gaps (${report.gaps.length}):`, ...report.gaps.map(gap => `  ${gap.what}: ${gap.missing}${gap.excused === undefined ? '' : ` (left out on purpose: ${gap.excused})`}`))
  return lines.join('\n')
}
