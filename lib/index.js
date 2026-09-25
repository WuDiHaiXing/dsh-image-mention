/**
 * dsh-image-mention — host (node) half.
 *
 * Mounted by the cordis loader as the row
 *     { id: dsh-image-mention, name: dsh-image-mention }
 * contributed by cordis.patch.yml.
 *
 * Export shape mirrors the third-party plugins already running in this profile
 * (@nanmicoder/dsh-agent-teams/lib/index.js:38-103): named `name` / `inject` /
 * `apply`.  `apply` is required; `name` is the plugin's own name.
 *
 * This round the host half is deliberately a no-op: it needs no platform service
 * at all, so `inject` stays empty and the row can never be left
 * "waiting for services" (the pending state a wrong service name would create).
 * The browser half lives in ./client.js and is owned by a separate task.
 */
export const name = 'dsh-image-mention'

/** No platform service is required by the host half. Keep this list empty. */
export const inject = []

/**
 * Mount point, called once by the loader with this plugin's context.
 * @param ctx - the cordis context of this plugin row.
 */
export function apply(ctx) {
  ctx.logger.info('dsh-image-mention: host half mounted (no-op skeleton)')
}
