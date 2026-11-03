/**
 * Brand-gold plugin — browser half.
 *
 * Fills the two sidebar brand slots the shell declares
 * (`sidebar.brand.mark` and `sidebar.brand.name`) with the gold rendition of
 * the original whale mark, deepseek wordmark and HARNESS plate. Registration
 * is declaration-aware via `ctx.slots.inject`, so the order in which the
 * sidebar and this plugin activate does not matter, and both occupants are
 * withdrawn together when the declaration goes away.
 *
 * Both occupants register one step below the official brand package's
 * priority: the slot registry renders the lowest live priority per cell, so the
 * gold rendition shadows the stock white mark without unloading anything, and
 * removing this plugin hands the slots straight back. Geometry, viewBox and
 * layout footprint are identical to the originals, so the sidebar row never
 * reflows either way.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the two brand holes).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { GoldBrandMark } from './GoldBrandMark.tsx'
import { GoldBrandName } from './GoldBrandName.tsx'

/** Registrant label shown in the slot ledger. */
const REGISTRANT = '@linxin666/dsh-client-ui-brand-gold'

/**
 * One step below the stock occupants: the registry renders the lowest live
 * priority per cell, so this shadows the official white mark while keeping
 * every original registration in place.
 */
const GOLD_PRIORITY = -1

/** Services required by this plugin. */
export const inject = ['slots']

/**
 * Register the gold brand occupants.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.brand.mark', () =>
    ctx.slots.inject('sidebar.brand.name', function* () {
      yield ctx.slots.register({ name: 'sidebar.brand.mark', priority: GOLD_PRIORITY, registrant: REGISTRANT }, GoldBrandMark)
      yield ctx.slots.register({ name: 'sidebar.brand.name', priority: GOLD_PRIORITY, registrant: REGISTRANT }, GoldBrandName)
    }),
  )
}
