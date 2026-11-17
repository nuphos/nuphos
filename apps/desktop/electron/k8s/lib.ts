import { createRequire } from 'node:module'

import type * as K8s from '@kubernetes/client-node'

let loaded: typeof K8s | undefined

function load(): typeof K8s {
  loaded ??= createRequire(import.meta.url)('@kubernetes/client-node') as typeof K8s

  return loaded
}

/**
 * `@kubernetes/client-node`, loaded on first use rather than at launch: it is
 * about 800 files and 110 ms to import, and nothing before the first window
 * needs it. Use `import type * as k8s` for its types and this for its values.
 * Only property reads are forwarded: spreading it or an `in` check sees an empty
 * object, so read members by name.
 */
export const k8sLib = new Proxy({} as typeof K8s, {
  get: (_, name) => load()[name as keyof typeof K8s],
})
