/** The DSH releases the packages are tested against, oldest first: the one list every constraint is derived from. */
export const DSH_RELEASES = ['0.2.1-rc.2']
/** The release the workspace is developed against: DSH dependencies, which a bundle also installs, pin it exactly. */
export const DSH_DEVELOPMENT = DSH_RELEASES.at(-1)

/** For each patch tuple, from its oldest tested release up to the next patch: a prerelease never stands for a later patch. */
function enginesOf(releases) {
  const lowest = new Map()
  for (const release of releases) {
    const tuple = release.split('-')[0]
    if (!lowest.has(tuple)) lowest.set(tuple, release)
  }
  return [...lowest].map(([tuple, release]) => {
    const [major, minor, patch] = tuple.split('.').map(Number)
    return `>=${release} <${major}.${minor}.${patch + 1}`
  }).join(' || ')
}

/** `engines.dsh` of the plugin packages: each tested patch tuple, stopping before the next patch. */
export const DSH_ENGINES = enginesOf(DSH_RELEASES)
