const registry = 'https://registry.npmjs.org/'

export async function isPublished(name, version, request = fetch) {
  const response = await request(new URL(encodeURIComponent(name), registry), {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (response.status === 404) return false
  if (!response.ok) throw new Error(`Could not query ${name}@${version}: npm registry returned ${response.status} ${response.statusText}`)
  const metadata = await response.json()
  return Object.hasOwn(metadata.versions ?? {}, version)
}
