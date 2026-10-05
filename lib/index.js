/**
 * Host half of the reasoning-cycle shortcut. This package is a pure browser
 * behavior: the empty `apply` exists so the row appears in the profile's
 * cordis.patch.yml and the Loader mounts it, while the browser half ships
 * through `exports["./client"]`, discovered from the package.json `dsh.client`
 * declaration.
 */

/** Host plugin body — no host-side behavior for this surface plugin. */
export function apply() {}
