import { useEffect, useState } from 'react'
import { AI_API_PREFIX, AI_API_ROUTES, type CapabilitiesPayload, type RequestOption } from 'dsh-ai-core'

/**
 * What the selected embedding provider lets a request set, as the provider describes it, for the chat
 * settings to offer. It asks the AI providers plugin; without it, or without a provider selected, or
 * one with nothing to set, the answer is none and the form simply shows nothing more.
 * @param only - `start` for the options that have to be chosen before the first request, `all` for every one.
 */
export function useEmbeddingOptions(only: 'start' | 'all'): readonly RequestOption[] {
  const [options, setOptions] = useState<readonly RequestOption[]>([])
  useEffect(() => {
    const abort = new AbortController()
    fetch(`${AI_API_PREFIX}${AI_API_ROUTES.capabilities}`, { credentials: 'same-origin', signal: abort.signal })
      .then(response => (response.ok ? response.json() as Promise<CapabilitiesPayload> : undefined))
      .then((payload) => {
        const state = payload?.capabilities.find(entry => entry.capability === 'embedding')
        const chosen = state?.providers.find(provider => provider.id === state.selected)?.requestOptions ?? []
        setOptions(only === 'start' ? chosen.filter(option => option.atStart === true) : chosen)
      })
      .catch(() => { if (!abort.signal.aborted) setOptions([]) })
    return () => { abort.abort() }
  }, [only])
  return options
}
