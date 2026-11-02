import { AppSelect } from '../components/ui/select'
import { t } from '../i18n'
import { desktopFilter, desktopScreens, parseDesktopFilter } from '../lib/desktopScreens'

import { BoxDesktopView, SessionDesktopView } from './DesktopPanes'
import { useAgentDevices } from './settings/useAgentDevices'

/** A Box's desktop with a switcher between its own :1 and the viewer's sessions there. */
function BoxScreens({
  teamId,
  filter,
  onFilterChange,
}: {
  teamId: string
  filter: string
  onFilterChange: (filter: string) => void
}) {
  const target = parseDesktopFilter(filter)
  const deviceId = target.kind === 'box' ? target.deviceId : ''
  // Sessions open and close their displays on their own; look again now and then.
  const { list } = useAgentDevices(() => 15_000, teamId, { teamId })
  const options = desktopScreens(
    list?.devices.find((device) => device.deviceId === deviceId),
    deviceId,
  )
  const screen = target.kind === 'box' ? target.screen : undefined
  const switcher = (
    <AppSelect
      ariaLabel={t('Screen')}
      value={desktopFilter(deviceId, screen)}
      onValueChange={onFilterChange}
      options={options}
      className="w-48 shrink-0"
      triggerClassName="h-6 text-xs"
    />
  )

  // Each screen mounts its own view, so a switch connects afresh with a new link.
  return screen ? (
    <SessionDesktopView
      key={filter}
      teamId={teamId}
      display={screen.display}
      sessionId={screen.sessionId}
      switcher={switcher}
    />
  ) : (
    <BoxDesktopView key={filter} teamId={teamId} deviceId={deviceId} switcher={switcher} />
  )
}

/** `filter` is a session's X display number, or a Box's desktop (see desktopScreens). */
export function DesktopView({
  teamId,
  filter,
  onFilterChange,
}: {
  teamId: string
  filter: string
  onFilterChange: (filter: string) => void
}) {
  const target = parseDesktopFilter(filter)

  return target.kind === 'session' ? (
    <SessionDesktopView teamId={teamId} display={target.display} />
  ) : (
    <BoxScreens teamId={teamId} filter={filter} onFilterChange={onFilterChange} />
  )
}
