import { Button } from '../../components/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '../../components/ui/menu'
import { t } from '../../i18n'

import { snoozeTimes } from './snooze'

/**
 * Snooze as one of a question card's option buttons, in the Inbox and in a chat
 * alike: a menu of when the question comes back.
 */
export function SnoozeMenu({
  className,
  onSnooze,
}: {
  /** The option buttons' own class, so it reads as one of them. */
  className: string
  onSnooze: (until: Date) => void
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button variant="secondary" size="sm" className={className}>
            {t('Snooze')}
          </Button>
        }
      />
      <MenuContent align="start">
        {snoozeTimes(new Date()).map(({ label, until }) => (
          <MenuItem key={label} onClick={() => onSnooze(until)}>
            {label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  )
}
