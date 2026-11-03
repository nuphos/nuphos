import { t } from '../i18n/index.ts'

export const SHARED_COMPUTER_ACCESS = t(
  'Only share with people you trust. Access includes commands, files, terminals and computer control. Agents may use files and existing sign-ins available to the operating-system account.',
)

export const SHARED_COMPUTER_PRIVACY = t(
  'This is a shared computer, not a private sandbox. Host administrators and processes using the same operating-system account may access work sent here, including conversation context, files and credentials.',
)

export const SHARED_COMPUTER_AUDIT = t(
  'Computer owners and managers can view supported device-operation records, including who requested them, conversation titles, command summaries, times and results. Records are retained for 90 days. Secret masking is best effort; coverage is incomplete. This does not grant access to the full conversation.',
)
