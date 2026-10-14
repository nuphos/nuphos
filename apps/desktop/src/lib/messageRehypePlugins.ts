import { defaultRehypePlugins } from 'streamdown'

// Without `harden`: sanitize already drops unsafe protocols, and with every
// prefix allowed harden only rewrote `./a` to `/a` and blocked bare `a`, which
// is how agents cite files relative to their workspace.
export const messageRehypePlugins = [defaultRehypePlugins.raw, defaultRehypePlugins.sanitize]
