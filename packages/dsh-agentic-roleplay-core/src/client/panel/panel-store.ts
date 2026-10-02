import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'

type PanelState = {
  /** Selected page id; undefined until the user picks one. */
  page: string | undefined
}

type PanelActions = {
  selectPage: (draft: PanelState, id: string) => void
}

export function createPanelStore(): EngineStoreHandle<PanelState, PanelActions> {
  return defineStore({
    init: (): PanelState => ({ page: undefined }),
    actions: {
      selectPage: (draft, id: string) => { draft.page = id },
    },
  })
}
