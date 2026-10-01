type SetupScript = {
  /** Arguments after `$TEAM <id>`. */
  extraArgs?: string
  /** Shell to run after the script, e.g. sourcing the env file it wrote. */
  after?: string
  /** The script prints exports instead of writing a file. */
  sourced?: boolean
  note?: string
}

const SETUP_SCRIPTS: Record<string, SetupScript> = {
  linode: {},
  hetzner: {},
  cloudflare: {},
  tencent: { extraArgs: '[region]' },
  aliyun: { extraArgs: '[region]' },
  volcengine: { extraArgs: '[region]', after: 'source ~/.volc/credentials.env' },
  azure: { sourced: true },
  huawei: {
    extraArgs: '[region]',
    after: 'source ~/.huawei/credentials.env',
    note: 'call APIs with skills/huawei/scripts/hw-api.py (there is no Huawei CLI)',
  },
  asana: { after: 'source ~/.asana/nuphos.env' },
  sentry: { after: 'source ~/.sentry/nuphos.env' },
  posthog: { after: 'source ~/.posthog/nuphos.env' },
}

export function setupHint(skill: string, args: string, script: SetupScript = {}): string {
  const run = `bash skills/${skill}/scripts/setup-credentials.sh $TEAM ${args}`
  const command = script.sourced ? `source <(${run})` : run
  const steps = [script.after ? `${command} && ${script.after}` : command, script.note]

  return `Use the ${skill} skill: ${steps.filter(Boolean).join(', then ')}; see skills/${skill}/SKILL.md.`
}

/** The hint for an account vended by `<provider>-accounts/:id/credentials`, if its skill has a setup script. */
export function vendedAccountHint(provider: string, id: string): string | undefined {
  const script = SETUP_SCRIPTS[provider]

  if (!script) return undefined

  return setupHint(provider, [id, script.extraArgs].filter(Boolean).join(' '), script)
}
