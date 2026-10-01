// Executed with Node inside a verified managed placement. Only the conversation
// workspace is portable; the runtime home (tokens, SSH keys, kubeconfig) is not.
export const WORKSPACE_ARCHIVE_PROGRAM = String.raw`
try {
const fs = await import('node:fs/promises');
const path = await import('node:path');
const crypto = await import('node:crypto');
const [mode, root, sessionId, lengthText] = process.argv.slice(1);
if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) throw Error('Invalid conversation');
const limit = 64 * 1024 * 1024;
const cwd = path.join(root, 'conv-' + sessionId);
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const safeLink = (relative, target) => {
  if (typeof target !== 'string' || !target || target.includes('\\') || target.includes('\0') || path.isAbsolute(target)) return false;
  const resolved = path.resolve(cwd, path.dirname(relative), target);
  return resolved === cwd || resolved.startsWith(cwd + '/');
};
const exists = async p => { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };
const rootStat = await fs.lstat(root);
if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw Error('Unsafe workspace root');
if (mode === 'export') {
  const entries = [];
  let bytes = 0;
  const visit = async (relative) => {
    if (relative.includes('\\') || relative.length > 4096) throw Error('Unsupported workspace path');
    const full = path.join(cwd, relative);
    const stat = await fs.lstat(full);
    if (stat.isSymbolicLink()) {
      if (!relative) throw Error('Workspace root must not be a link');
      const target = await fs.readlink(full);
      if (!safeLink(relative, target)) throw Error('Workspace link leaves the conversation');
      entries.push({ path: relative, kind: 'symlink', target });
      if (entries.length > 10000) throw Error('Workspace contains too many entries');
      return;
    }
    if (!stat.isFile() && !stat.isDirectory()) throw Error('Unsupported workspace entry');
    if (entries.length >= 10000) throw Error('Workspace contains too many entries');
    if (stat.isDirectory()) {
      if (relative) entries.push({ path: relative, kind: 'directory' });
      for (const name of (await fs.readdir(full)).sort()) await visit(relative ? relative + '/' + name : name);
    } else {
      bytes += stat.size;
      if (bytes > limit) throw Error('Workspace exceeds 64 MiB');
      const handle = await fs.open(full, (await import('node:fs')).constants.O_RDONLY | (await import('node:fs')).constants.O_NOFOLLOW);
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.ino !== stat.ino || before.size !== stat.size) throw Error('Workspace changed');
        const data = await handle.readFile();
        const after = await handle.stat();
        if (before.mtimeMs !== after.mtimeMs || before.size !== data.length) throw Error('Workspace changed');
        entries.push({ path: relative, kind: 'file', executable: Boolean(stat.mode & 64), data: data.toString('base64'), sha256: digest(data) });
      } finally { await handle.close(); }
    }
  };
  if (await exists(cwd)) await visit('');
  process.stdout.write(JSON.stringify({ version: 1, sessionId, entries }));
} else if (mode === 'import') {
  const length = Number(lengthText);
  if (!Number.isSafeInteger(length) || length < 1 || length > limit * 2) throw Error('Invalid archive length');
  const data = await new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const timer = setTimeout(() => reject(Error('Archive input timed out')), 60000);
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > length) { clearTimeout(timer); reject(Error('Archive too large')); return; }
      chunks.push(chunk);
      if (size === length) { clearTimeout(timer); process.stdin.pause(); resolve(Buffer.concat(chunks)); }
    });
    process.stdin.on('end', () => { if (size !== length) { clearTimeout(timer); reject(Error('Incomplete archive')); } });
  });
  const archive = JSON.parse(data.toString());
  if (archive.version !== 1 || archive.sessionId !== sessionId || !Array.isArray(archive.entries) || archive.entries.length > 10000) throw Error('Invalid archive');
  let bytes = 0; const seen = new Set();
  for (const entry of archive.entries) {
    if (typeof entry.path !== 'string' || entry.path.length > 4096 || entry.path.includes('\\') || entry.path.includes('\0') || entry.path.split('/').some(p => !p || p === '.' || p === '..') || seen.has(entry.path)) throw Error('Unsafe archive path');
    seen.add(entry.path);
    if (entry.kind === 'file') {
      if (typeof entry.data !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.data)) throw Error('Invalid file');
      const decoded = Buffer.from(entry.data, 'base64'); bytes += decoded.length;
      if (bytes > limit || digest(decoded) !== entry.sha256) throw Error('Archive integrity failed');
    } else if (entry.kind === 'symlink') {
      if (!safeLink(entry.path, entry.target)) throw Error('Unsafe archive link');
    } else if (entry.kind !== 'directory') throw Error('Invalid entry');
  }
  // Retry a completed restore only when the destination still matches exactly.
  const destinationStat = await exists(cwd);
  if (destinationStat?.isDirectory() && !destinationStat.isSymbolicLink()) {
    const expected = new Map(archive.entries.map(entry => [entry.path, entry]));
    let same = true; let count = 0;
    const compare = async relative => {
      for (const name of await fs.readdir(path.join(cwd, relative))) {
        const key = relative ? relative + '/' + name : name;
        const entry = expected.get(key); const full = path.join(cwd, key);
        const stat = await fs.lstat(full); count++;
        if (!entry) { same = false; return; }
        if (entry.kind === 'symlink' && stat.isSymbolicLink()) {
          if (await fs.readlink(full) !== entry.target) same = false;
          if (!same) return;
          continue;
        }
        if (stat.isSymbolicLink()) { same = false; return; }
        if (entry.kind === 'directory' && stat.isDirectory()) await compare(key);
        else if (entry.kind === 'file' && stat.isFile() && stat.size === Buffer.from(entry.data, 'base64').length) {
          if (digest(await fs.readFile(full)) !== entry.sha256 || Boolean(stat.mode & 64) !== Boolean(entry.executable)) same = false;
        } else same = false;
        if (!same) return;
      }
    };
    await compare('');
    if (same && count === archive.entries.length) {
      await new Promise(resolve => process.stdout.write('restored', resolve));
      process.exit(0);
    }
  }
  const staging = await fs.mkdtemp(path.join(root, '.nuphos-restore-'));
  try {
    for (const entry of archive.entries.filter(entry => entry.kind !== 'symlink')) {
      const full = path.join(staging, entry.path);
      if (entry.kind === 'directory') await fs.mkdir(full, { recursive: true, mode: 448 });
      else {
        await fs.mkdir(path.dirname(full), { recursive: true, mode: 448 });
        await fs.writeFile(full, Buffer.from(entry.data, 'base64'), { flag: 'wx', mode: entry.executable ? 448 : 384 });
      }
    }
    // Links are created last so extraction can never write through one.
    for (const entry of archive.entries.filter(entry => entry.kind === 'symlink')) {
      const full = path.join(staging, entry.path);
      await fs.mkdir(path.dirname(full), { recursive: true, mode: 448 });
      await fs.symlink(entry.target, full);
    }
    const destination = await exists(cwd);
    if (destination) {
      if (!destination.isDirectory() || destination.isSymbolicLink() || (await fs.readdir(cwd)).length) throw Error('Destination workspace is not empty');
      await fs.rmdir(cwd);
    }
    await fs.rename(staging, cwd);
  } finally { await fs.rm(staging, { recursive: true, force: true }); }
  process.stdout.write('restored', () => process.exit(0));
} else throw Error('Invalid operation');
} catch (error) {
  const message = String(error?.message ?? '');
  const code = message.includes('64 MiB') || message.includes('too many entries') ? 'limit'
    : message.includes('link leaves') || message.includes('root must not be a link') ? 'external_link'
    : message.includes('Destination workspace is not empty') ? 'destination_not_empty'
    : message.includes('Workspace changed') ? 'changed'
    : message.includes('integrity') || message.includes('Unsafe archive') || message.includes('Invalid archive') ? 'integrity'
    : 'unavailable';
  process.stdout.write(JSON.stringify({ error: code }), () => process.exit(1));
}
`
