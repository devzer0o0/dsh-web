/**
 * Host loader entry for the brand-gold plugin — runs in the DSH host process.
 *
 * The plugin is purely presentational: it fills two declared client slots with
 * the gold rendition of the brand vectors. The host half has no behavior.
 */

/** Apply the host half (no-op for a pure browser plugin). */
export function apply(): void {
  // Intentionally empty: this plugin has no host behavior.
}
