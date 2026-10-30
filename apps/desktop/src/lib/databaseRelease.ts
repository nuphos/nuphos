import { t } from '../i18n/index.ts'

import type { DatabaseEngine } from '../types'

export const RELEASED_DATABASE_ENGINE = 'mongodb' as const

/**
 * Sidebar nav keys for a bound database connection, and their labels. Backup /
 * Restore and Parameters are deliberately absent: those workflows are unfinished
 * and their entry points stay hidden for this release.
 */
export const DATABASE_NAV_LABELS: Record<string, string> = {
  'database.overview': t('Overview'),
  'database.collections': t('Collections'),
  'database.query': t('Query'),
  'database.changes': t('Changes'),
  'database.monitoring': t('Monitoring'),
  'database.access': t('Access'),
  'database.audit': t('Audit'),
  'database.settings': t('Settings'),
}

export function isDatabaseEngineReleased(engine: DatabaseEngine): boolean {
  return engine === RELEASED_DATABASE_ENGINE
}

/** Agent access levels a database connection can grant, in ascending order. */
export const AGENT_POLICY_OPTIONS = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'metadata-only', label: 'Metadata only' },
  { value: 'read-only', label: 'Read-only queries' },
]
