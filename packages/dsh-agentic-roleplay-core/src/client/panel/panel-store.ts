import { defineStore, type StoreHandle } from '../store.ts'

type PanelState = {
  /** Selected page id; undefined until the user picks one. */
  page: string | undefined
}

type PanelActions = {
  selectPage: (draft: PanelState, id: string) => void
}

export function createPanelStore(): StoreHandle<PanelState, PanelActions> {
  return defineStore({
    init: (): PanelState => ({ page: undefined }),
    actions: {
      selectPage: (draft, id: string) => { draft.page = id },
    },
  })
}
