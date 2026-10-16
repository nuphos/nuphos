import { nuphosStreamReplyImages } from './reply-image-stream.mjs'

// Inlined into both native adapters, so local and cloud use the same contract.
export function nuphosReplyImages(agent, params, response) {
  const env = params?._meta?.claudeCode?.options?.env ?? params?._meta?.['ai.nuphos/codex']?.env
  if (
    !env?.NUPHOS_TOKEN ||
    !env.NUPHOS_SESSION_ID ||
    !(env.TEAM || env.NUPHOS_TEAM_ID) ||
    !params.cwd
  )
    return response
  const target = agent.client?.sessionUpdate ? agent.client : agent.connection
  const method = target === agent.client ? 'sessionUpdate' : 'notify'
  if (!target?.[method]) return response
  if (!agent.nuphosReplyImageState) {
    const sessions = new Map()
    const original = target[method].bind(target)
    const send = (notification) =>
      method === 'notify' ? original('session/update', notification) : original(notification)
    let queue = Promise.resolve()
    const flush = async (state) => {
      const pending = state.pending
      if (pending) {
        const text = await nuphosStreamReplyImages('', state, nuphosUploadReplyImages, true)
        if (text)
          await send({
            ...pending,
            update: { ...pending.update, content: { ...pending.update.content, text } },
          })
      }
      state.pending = null
      state.scan = undefined
      state.uploadSignal = undefined
    }
    target[method] = (...args) => {
      if (method === 'notify' && args[0] !== 'session/update') return original(...args)
      const notification = args[method === 'notify' ? 1 : 0]
      const work = async () => {
        const state = sessions.get(notification?.sessionId)
        if (!state) return send(notification)
        const update = notification.update
        if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
          if (state.pending && state.pending.update.messageId !== update.messageId)
            await flush(state)
          state.pending = notification
          const text = await nuphosStreamReplyImages(
            update.content.text,
            state,
            nuphosUploadReplyImages,
          )
          if (text)
            await send({
              ...notification,
              update: { ...update, content: { ...update.content, text } },
            })
          return
        }
        await flush(state)
        return send(notification)
      }
      const result = queue.then(work)
      queue = result.catch(() => {})
      return result
    }
    agent.nuphosFlushReplyImages = (sessionId) => {
      const state = sessions.get(sessionId)
      const result = queue.then(() => state && flush(state))
      queue = result.catch(() => {})
      return result
    }
    const prompt = agent.prompt.bind(agent)
    agent.prompt = async (...args) => {
      try {
        return await prompt(...args)
      } finally {
        await agent.nuphosFlushReplyImages(args[0]?.sessionId)
      }
    }
    agent.nuphosReplyImageState = sessions
  }
  const id = response?.sessionId ?? params.sessionId
  if (id)
    agent.nuphosReplyImageState.set(id, {
      env: { ...env },
      cwd: params.cwd,
      cache: agent.nuphosReplyImageState.get(id)?.cache ?? new Map(),
      credentialsDir: process.env.OPENAB_CREDENTIALS_DIR,
      pending: null,
    })
  return response
}

export async function nuphosUploadReplyImages(text, state) {
  const fs = await import('node:fs/promises')
  const path = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const { createHash } = await import('node:crypto')
  // Match code before images: examples in fenced/inline code are never attachments.
  const uploadSignal = state.uploadSignal ?? AbortSignal.timeout(20_000)
  const tokens =
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`+[^`\n]*`+|!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"[^"\n]*")?\)/g
  let output = '',
    last = 0,
    count = 0
  for (const match of text.matchAll(tokens)) {
    if (!match[0].startsWith('![')) continue
    const escapes = /\\*$/.exec(text.slice(0, match.index))?.[0].length ?? 0
    if (escapes % 2) continue
    let source = match[2].replace(/^<|>$/g, '')
    if (/^(?:https?:|data:)/i.test(source)) continue
    if (/^[a-z][a-z\d+.-]*:/i.test(source) && !source.startsWith('file:')) continue
    output += text.slice(last, match.index)
    last = match.index + match[0].length
    try {
      if (++count > 8) throw new Error('Too many images in this reply')
      source = source.startsWith('file:') ? fileURLToPath(source) : decodeURIComponent(source)
      const root = await fs.realpath(state.cwd)
      const resolved = await fs.realpath(path.resolve(root, source))
      const relative = path.relative(root, resolved)
      if (
        !relative ||
        relative === '..' ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
      )
        throw new Error('Image is outside this session workspace')
      // O_NOFOLLOW closes the final-component symlink swap; check the descriptor's bytes
      // rather than reading a second time after validating a pathname.
      const { constants } = await import('node:fs')
      const handle = await fs.open(
        resolved,
        constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
      )
      let bytes
      try {
        const stat = await handle.stat()
        const checkedPath = await fs.realpath(resolved)
        const checkedStat = await fs.stat(checkedPath)
        if (
          checkedPath !== resolved ||
          checkedStat.ino !== stat.ino ||
          checkedStat.dev !== stat.dev
        )
          throw new Error('Image changed while reading')
        if (!stat.isFile() || stat.size === 0 || stat.size > 5 * 1024 * 1024)
          throw new Error('Image must be a file under 5 MiB')
        bytes = Buffer.alloc(stat.size)
        let offset = 0
        while (offset < bytes.length) {
          const read = await handle.read(bytes, offset, bytes.length - offset, offset)
          if (!read.bytesRead) throw new Error('Image changed while reading')
          offset += read.bytesRead
        }
      } finally {
        await handle.close()
      }
      const mime = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? 'image/jpeg'
          : /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())
            ? 'image/gif'
            : bytes.subarray(0, 4).toString() === 'RIFF' &&
                bytes.subarray(8, 12).toString() === 'WEBP'
              ? 'image/webp'
              : null
      if (!mime) throw new Error('Unsupported image format')
      const key = createHash('sha256').update(bytes).digest('hex')
      const cached = state.cache.get(key)
      let group = cached?.expiresAt > Date.now() ? cached.id : null
      if (!group) {
        const env = state.env
        let token = env.NUPHOS_TOKEN
        if (state.credentialsDir)
          token = (
            await fs.readFile(path.join(state.credentialsDir, 'NUPHOS_TOKEN'), 'utf8')
          ).trim()
        const base = `${(env.NUPHOS_BACKEND_URL || 'https://api.nuphos.ai').replace(/\/$/, '')}/agent-sessions/${encodeURIComponent(env.NUPHOS_SESSION_ID)}/teams/${encodeURIComponent(env.TEAM || env.NUPHOS_TEAM_ID)}/file-transfers`
        const signal = uploadSignal
        const request = async (url, options) => {
          const result = await fetch(url, { ...options, signal })
          if (!result.ok) throw new Error('Image upload failed; ask the agent to retry')
          return result
        }
        const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        const created = await (
          await request(base, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              direction: 'download',
              label: 'Reply image',
              files: [{ fileName: path.basename(resolved), size: bytes.length, contentType: mime }],
            }),
          })
        ).json()
        await request(created.files[0].uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': mime },
          body: bytes,
        })
        const finalized = await (
          await request(`${base}/${created.groupId}/finalize`, { method: 'POST', headers })
        ).json()
        if (finalized.status !== 'ready')
          throw new Error('Image upload incomplete; ask the agent to retry')
        group = created.groupId
        if (state.cache.size >= 128) state.cache.clear()
        state.cache.set(key, { id: group, expiresAt: Date.parse(created.expiresAt) })
      }
      output += `![${match[1]}](https://nuphos.ai/_reply-images/${group})`
    } catch (error) {
      // No native errors: they can expose local paths, URLs or credentials.
      const allowed = [
        'Too many images in this reply',
        'Image is outside this session workspace',
        'Image must be a file under 5 MiB',
        'Unsupported image format',
      ]
      const reason = allowed.includes(error.message)
        ? error.message
        : 'Image could not be uploaded; ask the agent to retry'
      output += `**Image unavailable:** ${reason}.`
    }
  }
  return output + text.slice(last)
}
