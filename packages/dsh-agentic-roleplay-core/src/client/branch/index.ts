import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BranchController } from './branch-controller.ts'
import { BranchDialog } from './BranchDialog.tsx'
import { dictionaries, type BranchLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'roleplay.branch': BranchLocaleKey
  }
}

const NAMESPACE = 'roleplay.branch'

/** Asks for a name when DSH's fork of a roleplay chat has made a session of its own. Forks of ordinary chats are not touched. */
export function registerBranchNaming(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NAMESPACE, dictionaries), 'roleplay: branch dictionaries')
  const branches = new BranchController()
  ctx.inject(['sessions'], (inner) => {
    const sessions = inner.get('sessions') as unknown as { list: Parameters<BranchController['watch']>[0] } | undefined
    if (sessions !== undefined) inner.effect(() => branches.watch(sessions.list), 'roleplay: branch watch')
  })
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'roleplay-branch',
    locale: NAMESPACE,
    inject: () => branches.inject(),
  }, BranchDialog))
}
