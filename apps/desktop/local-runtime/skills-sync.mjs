// Serialized into the adapter with `.toString()`, so it must stay self-contained:
// no top-level imports and no references outside its own body.
export async function nuphosLocalSyncSkills(params, options = {}) {
  const env =
    params?._meta?.claudeCode?.options?.env ?? params?._meta?.['ai.nuphos/codex']?.env ?? {}
  const url = env.NUPHOS_RUNTIME_SKILLS_URL
  const token = env.NUPHOS_RUNTIME_SKILLS_TOKEN
  const workspace = options.workspace ?? process.env.NUPHOS_RUNTIME_WORKSPACE

  if (typeof url !== 'string' || typeof token !== 'string' || !url || !token || !workspace)
    return false
  if (!/^https?:\/\//u.test(url) || /[\u0000-\u001f"\\]/u.test(url + token)) return false
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { randomUUID } = await import('node:crypto')
  const claudeDir = path.join(workspace, '.claude')
  const skillsDir = path.join(claudeDir, 'skills')
  const revisionFile = path.join(claudeDir, '.skills-revision')
  const lockDir = path.join(claudeDir, '.skills-sync.lock')
  const readRevision = () =>
    fs.readFile(revisionFile, 'utf8').then(
      (value) => value.trim(),
      () => '',
    )
  const exists = (target) =>
    fs.lstat(target).then(
      () => true,
      () => false,
    )
  const safeRevision = /^[A-Za-z0-9._-]{1,128}$/u

  try {
    await fs.mkdir(claudeDir, { recursive: true })
    const installed = await readRevision()
    const headers = { authorization: `Bearer ${token}` }

    if ((await exists(skillsDir)) && safeRevision.test(installed))
      headers['if-none-match'] = `"${installed}"`
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    })

    if (response.status === 304) return true
    if (!response.ok) return false
    const bundle = await response.json()

    if (!safeRevision.test(bundle?.revision ?? '') || !Array.isArray(bundle.files)) return false
    const staging = path.join(claudeDir, `.skills-sync.${randomUUID()}`)

    await fs.mkdir(staging, { recursive: true })
    try {
      for (const file of bundle.files) {
        const relative = file?.path

        if (
          typeof relative !== 'string' ||
          !relative ||
          relative.startsWith('/') ||
          relative.includes('..') ||
          relative.includes('//') ||
          relative.includes('\\')
        )
          throw new Error(`unsafe runtime skill path: ${String(relative)}`)
        const destination = path.join(staging, relative)

        await fs.mkdir(path.dirname(destination), { recursive: true })
        await fs.writeFile(destination, Buffer.from(String(file.contentBase64 ?? ''), 'base64'), {
          mode: file.executable === true ? 0o755 : 0o644,
        })
      }

      const deadline = Date.now() + 30_000

      for (;;) {
        try {
          await fs.mkdir(lockDir)
          break
        } catch {
          const stale = await fs.stat(lockDir).then(
            (stat) => Date.now() - stat.mtimeMs > 120_000,
            () => false,
          )

          if (stale) await fs.rm(lockDir, { recursive: true, force: true })
          else if (Date.now() > deadline) return false
          else await new Promise((resolve) => setTimeout(resolve, 200))
        }
      }
      try {
        if ((await exists(skillsDir)) && (await readRevision()) === bundle.revision) return true
        const tree = path.join(claudeDir, `skills.${bundle.revision}.${randomUUID().slice(0, 8)}`)

        await fs.rename(staging, tree)
        const current = await fs.lstat(skillsDir).catch(() => null)

        if (process.platform === 'win32' || (current && !current.isSymbolicLink())) {
          await fs.rm(skillsDir, { recursive: true, force: true })
        }
        if (process.platform === 'win32') await fs.rename(tree, skillsDir)
        else {
          const link = path.join(claudeDir, `.skills-link.${randomUUID()}`)

          await fs.symlink(path.basename(tree), link)
          await fs.rename(link, skillsDir)
        }
        if (process.platform !== 'win32') {
          const agentsDir = path.join(workspace, '.agents')

          await fs.mkdir(agentsDir, { recursive: true })
          if (!(await exists(path.join(agentsDir, 'skills'))))
            await fs.symlink(path.join('..', '.claude', 'skills'), path.join(agentsDir, 'skills'))
        }
        const settings = path.join(skillsDir, '_runtime', 'settings.json')

        if (await exists(settings)) {
          const incoming = path.join(claudeDir, '.settings.json.incoming')

          await fs.copyFile(settings, incoming)
          await fs.rename(incoming, path.join(claudeDir, 'settings.json'))
        }
        await fs.writeFile(`${revisionFile}.incoming`, bundle.revision)
        await fs.rename(`${revisionFile}.incoming`, revisionFile)
        for (const entry of await fs.readdir(claudeDir)) {
          if (entry.startsWith('skills.') && entry !== path.basename(tree))
            await fs.rm(path.join(claudeDir, entry), { recursive: true, force: true })
        }
      } finally {
        await fs.rm(lockDir, { recursive: true, force: true })
      }

      return true
    } finally {
      await fs.rm(staging, { recursive: true, force: true })
    }
  } catch {
    return false
  }
}
