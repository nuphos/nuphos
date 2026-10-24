// What the artifact tab's toolbar does with a version.
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
    toast.success('Copied', version.title)
  } catch {
    toast.error('Could not copy the artifact')
  }
}

/** Save the version as one self-contained file named after its title. */
export async function downloadArtifact(version: ArtifactVersion) {
  let file: Awaited<ReturnType<typeof exportArtifact>>

  try {
    file = await exportArtifact(version)
  } catch {
    toast.error('Could not prepare the download')

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
      `Saved without ${String(count)} ${count === 1 ? 'thing' : 'things'} it loads from the web`,
      `Parts of ${file.fileName} may not work offline: ${file.missing.slice(0, 3).join(', ')}${count > 3 ? '…' : ''}`,
    )
  }
}

/** Copy a link that opens the artifact in Nuphos for anyone who can see its chat. */
export async function copyArtifactLink(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    toast.success('Link copied', 'Teammates who can open this chat will see the artifact.')
  } catch {
    toast.error('Could not copy the link')
  }
}
