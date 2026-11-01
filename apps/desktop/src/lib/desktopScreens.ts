// Which of a Box's displays a desktop tab shows, kept in the tab's route filter so a
// restore reopens it: the Box id alone for its own :1, or `<deviceId>:<display>:<sessionId>`
// for a conversation's display there. A bare number is a conversation tab's own display.

import { t } from '../i18n/index.ts'

import type { AgentDevice } from '../api/device-types'

export type DesktopScreen = { display: number; sessionId: string }

export type DesktopTarget =
  { kind: 'session'; display: number } | { kind: 'box'; deviceId: string; screen?: DesktopScreen }

export function parseDesktopFilter(filter: string): DesktopTarget {
  if (/^\d+$/u.test(filter)) return { kind: 'session', display: Number(filter) }
  const match = /^(.+):(\d+):([^:]+)$/u.exec(filter)

  return match
    ? {
        kind: 'box',
        deviceId: match[1]!,
        screen: { display: Number(match[2]), sessionId: match[3]! },
      }
    : { kind: 'box', deviceId: filter }
}

export function desktopFilter(deviceId: string, screen?: DesktopScreen): string {
  return screen ? `${deviceId}:${String(screen.display)}:${screen.sessionId}` : deviceId
}

/** The switcher's choices: the Box's own desktop, then each of the viewer's sessions there. */
export function desktopScreens(
  device: Pick<AgentDevice, 'deviceId' | 'label' | 'desktops'> | undefined,
  deviceId: string,
): { value: string; label: string }[] {
  return [
    { value: deviceId, label: `${device?.label ?? t('Computer')} · :1` },
    ...(device?.desktops ?? []).map((desktop) => ({
      value: desktopFilter(deviceId, desktop),
      label: `:${String(desktop.display)} · ${desktop.title || t('Agent')}`,
    })),
  ]
}
