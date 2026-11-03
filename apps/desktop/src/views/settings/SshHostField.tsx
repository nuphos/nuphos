import { useEffect, useMemo, useState } from 'react'

import { api } from '../../api'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '../../components/ui/combobox'
import { t } from '../../i18n'

import type { SshHost } from '../../api/device-types'

const MAX_SUGGESTIONS = 50

/** A host's second line: where its alias goes, as user@hostname. */
const hostDetail = (host: SshHost) => [host.user, host.hostName].filter(Boolean).join('@') || null

/**
 * user@host[:port] typed in, or a Host from the user's own ~/.ssh/config picked as they type. A
 * picked alias stays an alias, so ssh applies its User, Port, IdentityFile and ProxyJump.
 */
export function SshHostField({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  disabled: boolean
}) {
  const [hosts, setHosts] = useState<SshHost[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // No config, or none readable: the field still takes a typed host.
    void api
      .sshHosts()
      .then(setHosts)
      .catch(() => setHosts([]))
  }, [])

  const items = useMemo(() => {
    const query = value.trim().toLowerCase()

    return hosts
      .filter((host) =>
        [host.alias, host.hostName, host.user].some((part) => part?.toLowerCase().includes(query)),
      )
      .slice(0, MAX_SUGGESTIONS)
  }, [hosts, value])
  const showing = open && items.length > 0

  return (
    <Combobox<SshHost>
      items={items}
      filter={null}
      value={null}
      open={showing}
      onOpenChange={setOpen}
      inputValue={value}
      onInputValueChange={(next, details) => {
        // Only typing: picking a host sets its alias below, and Base UI then clears the box.
        if (details.reason === 'input-change') onChange(next)
      }}
      onValueChange={(host) => {
        if (!host) return
        setOpen(false)
        onChange(host.alias)
      }}
      itemToStringLabel={(host) => host.alias}
    >
      <ComboboxInput
        aria-label={t('SSH host')}
        placeholder={t('user@host, or a host from your SSH config')}
        showTrigger={false}
        disabled={disabled}
        spellCheck={false}
        autoCapitalize="off"
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !showing) onSubmit()
        }}
        className="h-9 flex-1"
        inputClassName="font-mono text-[12.5px]"
      />
      <ComboboxContent className="p-1">
        <ComboboxList>
          {(host: SshHost) => (
            <ComboboxItem key={host.alias} value={host} className="rounded-md">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-mono text-[12.5px]">{host.alias}</span>
                {hostDetail(host) && (
                  <span className="ml-auto truncate pl-3 font-mono text-[11.5px] text-tertiary">
                    {hostDetail(host)}
                  </span>
                )}
              </span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
