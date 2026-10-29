import { t } from '../../../i18n/index.ts'

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath
}

export function relativeTimeFromNow(value: string): string {
  const ms = Date.now() - new Date(value).getTime()

  if (!Number.isFinite(ms) || ms < 0) return t('just now')
  const minutes = Math.floor(ms / 60000)

  if (minutes < 1) return t('just now')
  if (minutes < 60)
    return minutes === 1 ? t('1 min ago') : t('{n} mins ago', { n: String(minutes) })
  const hours = Math.floor(minutes / 60)

  if (hours < 24) return hours === 1 ? t('1 hour ago') : t('{n} hours ago', { n: String(hours) })
  const days = Math.floor(hours / 24)

  if (days < 30) return days === 1 ? t('1 day ago') : t('{n} days ago', { n: String(days) })
  const months = Math.floor(days / 30)

  if (months < 12)
    return months === 1 ? t('1 month ago') : t('{n} months ago', { n: String(months) })
  const years = Math.floor(months / 12)

  return years === 1 ? t('1 year ago') : t('{n} years ago', { n: String(years) })
}

export function inferUserLanguage(text: string): string {
  if (/[\u4e00-\u9fff]/.test(text)) return 'Chinese'
  if (/[A-Za-z]/.test(text)) return 'English'

  return 'the same language as the visible user message'
}

export function getAgentLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined

  return navigator.language || undefined
}

export function escapeLocalFilePath(filePath: string): string {
  return filePath
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
}

export function formatLocalFileInstruction(filePath: string, visibleText: string): string {
  const language = inferUserLanguage(visibleText)

  return [
    'The user selected this local file path in the Nuphos UI:',
    `<local_file_path>${escapeLocalFilePath(filePath)}</local_file_path>`,
    'When the user asks about the file, use local_exec to inspect it directly.',
    'Do not tell the user that you can only see the path or that the content was not uploaded.',
    `Keep tool call labels and the assistant response in ${language} unless the user explicitly asks otherwise.`,
  ].join('\n')
}

export function homeGreeting(displayName: string | undefined): string {
  const firstName = displayName?.trim().split(/\s+/)[0]

  return firstName ? t("What's up next, {name}?", { name: firstName }) : t("What's up next?")
}
