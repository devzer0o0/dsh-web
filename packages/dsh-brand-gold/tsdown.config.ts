/**
 * Standalone tsdown config for the brand-gold plugin.
 *
 * Uses the repo's shared client-bundle preset (shared/tsdown.client.ts):
 * closure-factory artifact for window.__ModuleLoader__, CSS Modules inlined,
 * externals resolved through the loader module table. The node half carries no
 * behavior; types ship from lib/types (tsc).
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('@linxin666/dsh-client-ui-brand-gold', ['src/index.ts'])
