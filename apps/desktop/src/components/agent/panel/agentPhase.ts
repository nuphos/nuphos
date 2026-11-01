import { t } from '../../../i18n/index.ts'

export const AGENT_PHASE_LABELS = {
  'request-accepted': t('Request accepted by backend…'),
  'saving-turn': t('Saving your message…'),
  'building-context': t('Reading page context…'),
  'loading-credentials': t('Loading selected credentials…'),
  'preparing-tools': t('Preparing tools and sandbox…'),
  'building-prompt': t('Building agent instructions…'),
  'recalling-memory': t('Recalling memories…'),
  'loading-compaction': t('Loading conversation summary…'),
  'preparing-model': t('Preparing model request…'),
  'connecting-model': t('Connecting to model…'),
  thinking: t('Thinking…'),
  stopping: t('Stopping…'),
} as const

export type AgentPhase = keyof typeof AGENT_PHASE_LABELS
