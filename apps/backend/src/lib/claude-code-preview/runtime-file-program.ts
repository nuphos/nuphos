// Fixed program shared by the cloud job and Desktop's local file stream.
// Request data is JSON, never interpolated into executable code or a shell.
export const RUNTIME_FILE_LIMIT = 512 * 1024
export const RUNTIME_FILE_PROGRAM = String.raw`
const fs = await import('node:fs/promises');
const path = await import('node:path');
const constants = (await import('node:fs')).constants;
const limit = 512 * 1024;
let handle;
try {
  const input = process.argv[2]
    ? JSON.parse(await fs.readFile(path.join(process.argv[2], 'params.json'), 'utf8'))
    : JSON.parse(await new Promise((resolve, reject) => {
        let text = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', chunk => { text += chunk; if (text.length > 16384) reject(Error('invalid_path')); });
        process.stdin.on('end', () => resolve(text));
        process.stdin.on('error', reject);
      }));
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(input.sessionId) || typeof input.path !== 'string' || input.path.length > 4096 || input.path.includes('\0')) throw Error('invalid_path');
  const workspace = input.workspace;
  if (typeof workspace !== 'string' || !path.isAbsolute(workspace)) throw Error('invalid_path');
  if ((await fs.lstat(workspace)).isSymbolicLink()) throw Error('forbidden_path');
  const workspaceRoot = await fs.realpath(workspace);
  // Desktop supplies its account-owned workspace; managed runtimes share a volume.
  const conversationRoot = input.workspaceScope === 'local-user'
    ? workspaceRoot : path.join(workspaceRoot, 'conv-' + input.sessionId);
  if ((await fs.lstat(conversationRoot)).isSymbolicLink()) throw Error('forbidden_path');
  const root = await fs.realpath(conversationRoot);
  if (root !== conversationRoot) throw Error('forbidden_path');
  // Accept both the adapter's virtual /workspace path and the real local path.
  const virtual = '/workspace';
  const requested = input.path === virtual ? root : input.path.startsWith(virtual + '/') ? path.join(root, input.path.slice(virtual.length + 1)) : path.resolve(root, input.path);
  const inside = candidate => {
    const relative = path.relative(root, candidate);
    return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
  };
  if (!inside(requested)) throw Error('forbidden_path');
  const target = await fs.realpath(requested);
  if (!inside(target)) throw Error('forbidden_path');
  if (input.action === 'list') {
    if (!(await fs.stat(target)).isDirectory()) throw Error('not_a_directory');
    const directory = await fs.opendir(target);
    const entries = [];
    let truncated = false;
    try {
      for await (const entry of directory) {
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue;
        if (entries.length === 500) { truncated = true; break; }
        entries.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' });
      }
    } finally { await directory.close().catch(() => {}); }
    entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1);
    process.stdout.write(JSON.stringify({ entries, truncated }));
  } else {
  handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  // Linux can validate the opened descriptor, including parent-directory swaps.
  if (process.platform === 'linux') {
    const opened = await fs.realpath('/proc/self/fd/' + handle.fd);
    if (opened !== target) throw Error('forbidden_path');
  }
  if (await fs.realpath(requested) !== target) throw Error('forbidden_path');
  const stat = await handle.stat();
  const current = await fs.stat(target);
  if (stat.dev !== current.dev || stat.ino !== current.ino) throw Error('forbidden_path');
  if (!stat.isFile()) throw Error('not_a_file');
  if (stat.size > limit) throw Error('file_too_large');
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  while (size <= limit) {
    const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
    if (!bytesRead) break;
    size += bytesRead;
  }
  if (size > limit) throw Error('file_too_large');
  process.stdout.write(JSON.stringify({ name: path.basename(target), data: buffer.subarray(0, size).toString('base64'), size }));
  }
} catch (error) {
  const code = error.code === 'ENOENT' ? 'file_not_found' : error.code === 'EACCES' || error.code === 'ELOOP' ? 'forbidden_path' : error.message;
  const allowed = ['invalid_path', 'forbidden_path', 'not_a_file', 'not_a_directory', 'file_too_large', 'file_not_found'];
  process.stdout.write(JSON.stringify({ error: allowed.includes(code) ? code : 'file_read_failed' }));
} finally { await handle?.close(); }
`
