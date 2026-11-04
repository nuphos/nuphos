// What an extension can reach, in Chrome's install-warning wording.

export type ExtensionManifest = {
  name?: string
  version?: string
  permissions?: unknown[]
  host_permissions?: unknown[]
  content_scripts?: { matches?: unknown[] }[]
}

const ALL_SITES = new Set(['<all_urls>', '*://*/*', 'http://*/*', 'https://*/*'])

// Chrome's lines, in Chrome's order. Permissions not listed here have no line in Chrome.
const PERMISSION_LINES: [string[], string][] = [
  [['tabs', 'webNavigation', 'history', 'topSites'], 'Read your browsing history'],
  [['bookmarks'], 'Read and change your bookmarks'],
  [['clipboardRead'], 'Read data you copy and paste'],
  [['clipboardWrite'], 'Modify data you copy and paste'],
  [['nativeMessaging'], 'Communicate with cooperating native applications'],
  [['management'], 'Manage your apps, extensions, and themes'],
  [['privacy'], 'Change your privacy-related settings'],
  [['contentSettings'], "Change your settings that control websites' access to features"],
  [['downloads'], 'Manage your downloads'],
  [['geolocation'], 'Detect your physical location'],
  [['desktopCapture'], 'Capture content of your screen'],
  [['debugger'], 'Access the page debugger backend'],
  [['declarativeNetRequest'], 'Block content on any page'],
  [['notifications'], 'Display notifications'],
]

const strings = (values: unknown[] | undefined) =>
  (values ?? []).filter((value): value is string => typeof value === 'string')

const isHostPattern = (value: string) => ALL_SITES.has(value) || value.includes('://')

/** The API permissions and host patterns a manifest asks for. Optional permissions are not granted. */
function access(manifest: ExtensionManifest) {
  const listed = strings(manifest.permissions)
  const hosts = new Set([
    ...listed.filter(isHostPattern),
    ...strings(manifest.host_permissions),
    ...(manifest.content_scripts ?? []).flatMap((script) => strings(script.matches)),
  ])
  const permissions = new Set(listed.filter((value) => !isHostPattern(value)))

  return { hosts, permissions }
}

/** `*://*.example.com/*` → `example.com`, for the "on these sites" line. */
function siteOf(pattern: string): string {
  const host = /^[^:]+:\/\/([^/]*)/.exec(pattern)?.[1] ?? pattern

  return host.replace(/^\*\./, '').replace(/:\*$/, '')
}

function hostLines(hosts: Set<string>): string[] {
  if (hosts.size === 0) return []
  if ([...hosts].some((host) => ALL_SITES.has(host) || siteOf(host) === '*'))
    return ['Read and change all your data on all websites']
  const sites = [...new Set([...hosts].map(siteOf))].sort((a, b) => a.localeCompare(b))

  if (sites.length > 3) return ['Read and change your data on a number of websites']

  return [`Read and change your data on ${sites.join(', ')}`]
}

function lines(hosts: Set<string>, permissions: Set<string>): string[] {
  return [
    ...hostLines(hosts),
    ...PERMISSION_LINES.filter(([names]) => names.some((name) => permissions.has(name))).map(
      ([, line]) => line,
    ),
  ]
}

/**
 * The install question's lines. Every extension in Nuphos gets each tab's
 * address through the tabs API, so every list says it reads browsing history.
 */
export function installWarnings(manifest: ExtensionManifest): string[] {
  const { hosts, permissions } = access(manifest)

  permissions.add('tabs')

  return lines(hosts, permissions)
}

/**
 * What `next` can reach that `current` could not: one line per new kind of
 * access. Any new API permission counts, even one Chrome shows no line for.
 */
export function addedAccess(current: ExtensionManifest, next: ExtensionManifest): string[] {
  const before = access(current)
  const after = access(next)
  // `https://*/*` does not cover `http://` pages, so only these two cover every site.
  const allSites = before.hosts.has('<all_urls>') || before.hosts.has('*://*/*')
  const newHosts = new Set(
    allSites ? [] : [...after.hosts].filter((host) => !before.hosts.has(host)),
  )
  const newPermissions = new Set(
    [...after.permissions].filter((permission) => !before.permissions.has(permission)),
  )
  const described = lines(newHosts, newPermissions)
  const silent = [...newPermissions].filter(
    (permission) => !PERMISSION_LINES.some(([names]) => names.includes(permission)),
  )

  return [...described, ...silent.map((permission) => `Use the "${permission}" permission`)]
}
