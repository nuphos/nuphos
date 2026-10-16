import { shell } from 'electron'

// Links reach shell.openExternal from transcripts and web content, so any other
// scheme (file:, smb:, custom protocol handlers) could launch local software.
// slack: is the bot DM deep link in Slack settings.
const EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'slack:'])

/** Opens a URL the app did not build itself; the OS receives the URL exactly as checked. */
export async function openExternal(url: string): Promise<void> {
  const parsed = URL.parse(url)

  if (!parsed || !EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('Refused to open a URL with a disallowed scheme.')
  }
  await shell.openExternal(parsed.href)
}
