export const isDev = Boolean(process.env.VITE_DEV_SERVER_URL)
// In dev, allow a second concurrent instance by setting ATLAS_DEV_SUFFIX
// (e.g. a worktree name). The single-instance lock is keyed off userData,
// which is derived from APP_NAME, so giving each instance a unique name lets
// both run side-by-side without one silently quitting. Path separators are
// stripped so a stray slash can't make `path.join(appData, APP_NAME)` escape
// the appData directory.
const rawDevSuffix = process.env.ATLAS_DEV_SUFFIX?.replace(/[/\\]/g, '-') ?? ''

export const devSuffix = rawDevSuffix ? ` (${rawDevSuffix})` : ''
export const APP_NAME = isDev ? `Nuphos Dev${devSuffix}` : 'Nuphos'
