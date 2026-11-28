import clsx from 'clsx'
import { Loader2, Plug } from 'lucide-react'
import { useState } from 'react'

import { api } from '../../api'
import { parseAtlasError } from '../../api/errors'
import { Button } from '../../components/ui/button'
import { AppSelect } from '../../components/ui/select'
import { t } from '../../i18n'

import { draftIncomplete, draftValue, resourceProblem, urlProblem } from './customProviderDraft'
import { Alert, CheckResult, Row } from './CustomProviderParts'
import { inputClasses } from './styles'

import type { ProviderDraft, ProviderKind } from './customProviderDraft'
import type { CustomProviderAgent, CustomProviderCheck } from '../../api'

/**
 * A custom provider's fields, its Test connection and the note on the key: the form in Runtime
 * details and, for OpenCode, the dialog that adds one (`modal`, which also offers `none`).
 */
export function CustomProviderFields({
  provider,
  draft,
  onChange,
  instanceId,
  error,
  onCheck,
  modal = false,
}: {
  provider: CustomProviderAgent
  draft: ProviderDraft
  onChange: (draft: ProviderDraft) => void
  /** An added OpenCode's, whose saved key a test may use. */
  instanceId?: string
  /** Save's refusal, shown where a failed test shows. */
  error?: string | null
  /** The last test's result, which a change of any field clears. */
  onCheck?: (check: CustomProviderCheck | null) => void
  modal?: boolean
}) {
  const [checking, setChecking] = useState(false)
  const [check, setResult] = useState<CustomProviderCheck | null>(null)
  const setCheck = (next: CustomProviderCheck | null) => {
    setResult(next)
    onCheck?.(next)
  }
  const [checkError, setCheckError] = useState<string | null>(null)
  const opencode = provider === 'opencode'
  const azure = draft.kind === 'azure'
  const problem = azure ? resourceProblem(draft.resource) : urlProblem(draft.baseUrl)
  const update = (patch: Partial<ProviderDraft>) => {
    onChange({ ...draft, ...patch })
    setCheck(null)
  }

  async function test() {
    setChecking(true)
    setCheck(null)
    setCheckError(null)
    try {
      setCheck(await api.localRuntimeCheckCustomProvider(provider, draftValue(draft), instanceId))
    } catch (cause) {
      setCheckError(parseAtlasError(cause).message)
    } finally {
      setChecking(false)
    }
  }

  const kinds = [
    ...(modal ? [{ value: 'none', label: t('Sign in on the next step') }] : []),
    { value: 'openai', label: t('Custom endpoint') },
    { value: 'azure', label: t('Azure OpenAI') },
  ]
  const select = opencode && (
    <Row
      modal={modal}
      div
      label={t('Provider')}
      hint={
        draft.kind === 'none'
          ? t(
              'Or use your own gateway or a compatible API. You can change this later in Runtime details.',
            )
          : undefined
      }
    >
      <AppSelect
        ariaLabel={t('Provider')}
        value={draft.kind}
        options={kinds}
        onValueChange={(kind) => update({ kind: kind as ProviderKind })}
      />
    </Row>
  )

  if (draft.kind === 'none') return <>{select}</>
  const inputClass = (invalid?: string) =>
    clsx(inputClasses, 'font-mono', invalid && '!border-error')

  return (
    <>
      {select}
      {azure ? (
        <Row
          modal={modal}
          label={t('Resource name')}
          hint={t('The name in https://<resource>.openai.azure.com.')}
          problem={problem}
        >
          <input
            required
            spellCheck={false}
            value={draft.resource}
            placeholder="acme-openai"
            aria-invalid={problem ? true : undefined}
            onChange={(event) => update({ resource: event.target.value })}
            className={inputClass(problem)}
          />
        </Row>
      ) : (
        <Row
          modal={modal}
          label={t('Base URL')}
          hint={t('Your gateway or a compatible API. https://, or http:// to this computer.')}
          problem={problem}
        >
          <input
            type="url"
            required
            spellCheck={false}
            autoFocus={!modal}
            value={draft.baseUrl}
            placeholder="https://"
            aria-invalid={problem ? true : undefined}
            onChange={(event) => update({ baseUrl: event.target.value })}
            className={inputClass(problem)}
          />
        </Row>
      )}
      <Row
        modal={modal}
        div
        label={t('API key')}
        hint={opencode && !azure ? t('Optional for a gateway on this computer.') : undefined}
      >
        {draft.apiKey === null ? (
          <div className="flex h-9 items-center justify-between rounded-lg border border-line-control px-3 text-[13px] text-secondary">
            <span className="font-mono">{t('•••• saved')}</span>
            <button
              type="button"
              className="text-xs text-main hover:underline"
              onClick={() => update({ apiKey: '' })}
            >
              {t('Replace')}
            </button>
          </div>
        ) : (
          <input
            type="password"
            aria-label={t('API key')}
            autoComplete="off"
            spellCheck={false}
            required={provider !== 'opencode' || azure}
            value={draft.apiKey}
            onChange={(event) => update({ apiKey: event.target.value })}
            className={inputClass()}
          />
        )}
      </Row>
      {/* Codex's adapter refuses any model outside Codex's catalog but the configured one (#5214). */}
      {provider === 'codex' ? (
        <Row modal={modal} label={t('Model ID')} hint={t('Optional. Codex runs this model.')}>
          <input
            spellCheck={false}
            value={draft.models}
            onChange={(event) => update({ models: event.target.value })}
            className={inputClass()}
          />
        </Row>
      ) : (
        <Row
          modal={modal}
          label={azure ? t('Deployment names') : t('Model IDs')}
          hint={
            azure
              ? t('Not the model name. One per line; the first one is the default.')
              : opencode
                ? t('One per line; the first one is the default.')
                : t('Optional. The first one is the default in Model settings.')
          }
        >
          <textarea
            rows={2}
            spellCheck={false}
            value={draft.models}
            onChange={(event) => update({ models: event.target.value })}
            className={clsx(inputClass(), 'h-auto py-2')}
          />
        </Row>
      )}
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          variant="secondary"
          type="button"
          disabled={checking || draftIncomplete(draft)}
          onClick={() => void test()}
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plug className="h-3.5 w-3.5" />
          )}
          {t('Test connection')}
        </Button>
        <span className="text-xs text-tertiary">{t('Sends one request with this key')}</span>
      </div>
      {check && <CheckResult check={check} provider={provider} azure={azure} />}
      {(error ?? checkError) && <Alert>{error ?? checkError}</Alert>}
      <p className="text-xs leading-5 text-tertiary">
        {opencode
          ? t(
              'The key is kept in this computer’s secure credential store for this runtime only and never shown again. Usage and quota from a custom provider show as unknown.',
            )
          : t(
              'The key is kept in this computer’s secure credential store and never shown again. Usage and quota from a custom provider show as unknown.',
            )}
      </p>
    </>
  )
}
