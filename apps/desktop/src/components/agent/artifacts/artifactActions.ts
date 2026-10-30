// What the artifact tab's toolbar does with a version.
import { t } from '../../../i18n/index.ts'
import { toast } from '../../ui/toast'

import { exportArtifact } from './artifactExport'

import type { ArtifactVersion } from './artifactPayload'

export function fixPrompt(version: ArtifactVersion, errors: string[]): string {
  const list = errors.map((message) => `- ${message}`).join('\n')
  const subject = errors.length === 1 ? 'this error' : 'these errors'

  return `The artifact "${version.title}" (version ${String(version.version)}) reports ${subject} in its preview:\n\n${list}\n\nPlease fix it and show the new version.`
}

export async function copySource(version: ArtifactVersion) {
  try {
    await navigator.clipboard.writeText(version.content)
    toast.success(t('Copied'), version.title)
  } catch {
    toast.error(t('Could not copy the artifact'))
  }
}

/** Save the version as one self-contained file named after its title. */
export async function downloadArtifact(version: ArtifactVersion) {
  let file: Awaited<ReturnType<typeof exportArtifact>>

  try {
    file = await exportArtifact(version)
  } catch {
    toast.error(t('Could not prepare the download'))

    return
  }
  const url = URL.createObjectURL(
    new Blob([file.content], { type: `${file.mimeType};charset=utf-8` }),
  )
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = file.fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  if (file.missing.length > 0) {
    const count = file.missing.length

    toast.error(
      count === 1
        ? t('Saved without 1 thing it loads from the web')
        : t('Saved without {count} things it loads from the web', { count: String(count) }),
      t('Parts of {fileName} may not work offline: {missing}', {
        fileName: file.fileName,
        missing: `${file.missing.slice(0, 3).join(', ')}${count > 3 ? '…' : ''}`,
      }),
    )
  }
}

/** Copy a link that opens the artifact in Nuphos for anyone who can see its chat. */
export async function copyArtifactLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success(t('Link copied'), t('Teammates who can open this chat will see the artifact.'))
  } catch {
    toast.error(t('Could not copy the link'))
  }
}
