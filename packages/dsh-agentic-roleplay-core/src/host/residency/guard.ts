import type { OffloadRole } from '../../shared/offload.ts'
import type { ModelResidency } from './residency.ts'

/** The same service, whose listed methods first make room for the model they use and keep it from being unloaded while they run. */
export function guarded<T extends object>(residency: ModelResidency | undefined, role: OffloadRole, service: T | undefined, methods: readonly (keyof T & string)[]): T | undefined {
  if (residency === undefined || service === undefined) return service
  return new Proxy(service, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver)
      if (typeof value !== 'function') return value
      const call = value as (...args: unknown[]) => unknown
      if (typeof property === 'string' && (methods as readonly string[]).includes(property)) {
        return (...args: unknown[]) => residency.run(role, async () => await call.apply(target, args))
      }
      return call.bind(target)
    },
  })
}
