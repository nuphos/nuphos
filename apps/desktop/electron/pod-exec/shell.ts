export const NO_SUPPORTED_SHELL_MESSAGE =
  'This container image does not include a supported shell. Choose another container or use an image that includes bash, sh, or ash.'

const POD_SHELL_CANDIDATES: readonly (readonly string[])[] = [
  ['/bin/bash'],
  ['/bin/sh'],
  ['/bin/ash'],
  ['/busybox/sh'],
  ['/bin/busybox', 'sh'],
  ['/usr/bin/bash'],
  ['/usr/bin/sh'],
  ['bash'],
  ['sh'],
  ['ash'],
]

export async function resolvePodShell(
  probe: (command: readonly string[]) => Promise<boolean>,
): Promise<string[] | null> {
  for (const command of POD_SHELL_CANDIDATES) {
    if (await probe(command)) return [...command]
  }

  return null
}
