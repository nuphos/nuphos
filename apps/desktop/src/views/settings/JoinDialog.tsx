import { Loader2 } from 'lucide-react'
import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { Button } from '../../components/ui/button'
import { toast } from '../../components/ui/toast'
import { t } from '../../i18n'
import { SSH_TARGET } from '../../lib/sshTarget'

import { LiveDot } from './BoxParts'
import { joinCommand } from './joinCommand'
import { SshHostField } from './SshHostField'
import { useSshJoin } from './useSshJoin'

import type { BoxJoin } from './joinCommand'

/**
 * Makes a Linux or macOS machine one of your computers: Desktop connects to it with your own ssh,
 * or you run the command on it yourself.
 */
export function JoinDialog({
  join,
  onClose,
  onPairRuntime,
}: {
  join: BoxJoin
  onClose: () => void
  /** A self-hosted runtime (Docker, Kubernetes) pairs with a code instead of joining. */
  onPairRuntime: () => void
}) {
  const [host, setHost] = useState('')
  const ssh = useSshJoin()
  const busy = ssh.phase === 'connecting' || ssh.phase === 'waiting'
  const target = host.trim()
  const connect = () => {
    if (!busy && SSH_TARGET.test(target)) void ssh.connect(target)
  }
  const command = joinCommand(join)

  return (
    <Modal
      open
      onClose={onClose}
      title={t('Your own computer')}
      description={t('Desktop connects to it with your own SSH, or you run one command on it.')}
      width={560}
    >
      <div className="space-y-5 p-5">
        <section className="space-y-2">
          <div className="flex gap-2">
            <SshHostField value={host} onChange={setHost} onSubmit={connect} disabled={busy} />
            <Button className="h-9" disabled={busy || !SSH_TARGET.test(target)} onClick={connect}>
              {busy ? t('Connecting…') : t('Connect')}
            </Button>
          </div>
          <p className="text-[11.5px] leading-4 text-tertiary">
            {t('Uses your SSH config, keys and agent on this computer. Nuphos never sees them.')}
          </p>
          {ssh.output && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-zGray-800 bg-main p-3 font-mono text-[11.5px] text-secondary">
              {ssh.output}
            </pre>
          )}
          {ssh.phase === 'waiting' && (
            <p role="status" className="flex items-center gap-2 text-[12px] text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('Waiting for {host} to come online…', { host: target })}
            </p>
          )}
          {ssh.phase === 'online' && (
            <p role="status" className="flex items-center gap-2 text-[12px] text-main">
              <LiveDot />
              {t('{name} is online and listed under Computers.', { name: ssh.computer ?? target })}
            </p>
          )}
        </section>
        <section className="space-y-2 border-t border-zGray-800 pt-4">
          <p className="text-[12px] text-secondary">
            {t('Or run this on the machine. The token works once and expires in an hour.')}
          </p>
          <pre className="whitespace-pre-wrap break-all rounded-lg border border-zGray-800 bg-main p-3 font-mono text-[12px] text-main">
            {command}
          </pre>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onPairRuntime}
              className="mr-auto text-[12px] text-tertiary underline-offset-2 hover:text-secondary hover:underline"
            >
              {t('Pairing a self-hosted runtime (Docker, Kubernetes)?')}
            </button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void navigator.clipboard.writeText(command).then(() => toast.success(t('Copied')))
              }
            >
              {t('Copy')}
            </Button>
            <Button size="sm" onClick={onClose}>
              {t('Done')}
            </Button>
          </div>
        </section>
      </div>
    </Modal>
  )
}
