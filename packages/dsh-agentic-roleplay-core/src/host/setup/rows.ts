import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ALL = ['@dsh-agentic-roleplay/all', 'dsh-agentic-roleplay']
const SINGLE = ['@dsh-agentic-roleplay/core', '@dsh-agentic-roleplay/state', 'dsh-agentic-roleplay-core', 'dsh-roleplay-state']

/**
 * The profile directory DSH launched this plugin in: `DSH_PROFILE_DIR`, which a profile-launched Host carries, or
 * `DSH_HOME/profiles/<DSH_PROFILE>` when only those are set (a `dsh` CLI launch). Both are environment facts; a
 * Harness booted without a profile has none.
 */
export function profileDirectory(): string | undefined {
  if (process.env.DSH_PROFILE_DIR !== undefined) return process.env.DSH_PROFILE_DIR
  const home = process.env.DSH_HOME
  const profile = process.env.DSH_PROFILE
  return home === undefined || profile === undefined ? undefined : join(home, 'profiles', profile)
}

/**
 * The bundle layers the profile has selected, in order; none when there is no profile to read. DSH exposes no
 * service for a profile's selected bundles, so this reads the profile's own manifest — never writes it.
 */
export function selectedBundles(profileDir: string | undefined): string[] {
  if (profileDir === undefined) return []
  try {
    const manifest = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as { dsh?: { profile?: { bundles?: unknown } } }
    const bundles = manifest.dsh?.profile?.bundles
    return Array.isArray(bundles) ? bundles.filter((name): name is string => typeof name === 'string') : []
  } catch { return [] }
}

/**
 * The layers of single packages that are selected next to the `all` layer. Each of them inserts the same plugin row as `all`, so the profile then holds the row twice
 * and DSH, which writes a plugin's settings through its row, refuses every save of Settings → Role Play.
 */
export function redundantLayers(bundles: readonly string[]): string[] {
  return bundles.some(name => ALL.includes(name)) ? bundles.filter(name => SINGLE.includes(name)) : []
}

export function redundantLayersMessage(layers: readonly string[]): string {
  return `the profile selects ${layers.map(name => `"${name}"`).join(', ')} next to the all bundle, which already inserts the same plugin rows, so DSH refuses to save the Role Play settings: deselect them (keep the packages installed) and restart`
}
