import { app } from 'electron'

// Sent on every backend request so server-side event logs can answer "which
// client build sent this?". Before this header existed, logs carried no client
// version at all, so "is the user's app too old?" could only be answered by
// inference from the DB, not from logs.
export const CLIENT_VERSION_HEADER = 'x-atlas-client'
export const CLIENT_VERSION_VALUE = `nuphos-desktop/${app.getVersion()}`
