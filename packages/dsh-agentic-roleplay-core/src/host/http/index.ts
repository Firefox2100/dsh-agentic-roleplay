import type { Context } from '@deepseek-ai/cordis'
// Type-only: declares `ctx.webServer`.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { API_PREFIX } from '../../shared/worlds.ts'
import { createApiHandler, type ApiConnection, type ApiDeps } from './api.ts'

/** Mount the API once the web server and its authentication are available; profiles without them skip it. */
export function registerApi(ctx: Context, deps: Omit<ApiDeps, 'connection'>): void {
  ctx.inject(['webServer', 'connection'], (webCtx) => {
    // The connection package is browser-side, so its service is typed locally.
    const connection = Reflect.get(webCtx, 'connection') as ApiConnection
    const handler = createApiHandler({ ...deps, connection })
    webCtx.effect(
      () => webCtx.webServer.register({ kind: 'prefix', path: `/${API_PREFIX}`, handler }),
      'roleplay: http api',
    )
  })
}
