import pkg from '../package.json' with { type: 'json' }

// Sent on every backend request so server-side event logs can answer "which
// client build sent this?". Before this header existed, logs carried no client
// version at all, so "is the user's app too old?" could only be answered by
// inference from the DB, not from logs.
//
// Must not import `electron`: `nuphos agent`'s host bundle loads this under
// plain Node, where the `electron` package throws on load (#2749).
export const CLIENT_VERSION_HEADER = 'x-atlas-client'
export const CLIENT_VERSION_VALUE = process.versions.electron
  ? `nuphos-desktop/${pkg.version}`
  : `nuphos-cli/${process.env.NUPHOS_CLI_VERSION ?? 'dev'}`
