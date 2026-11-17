// Removes the conversation's CLI homes that apps/runtime/image/session-home.mjs
// creates: <runtime HOME>/.nuphos/session-homes/<sha256(sessionId)> for the
// owner and <sha256(sessionId)>.<sha256(actor)> for each teammate, unless a
// process still runs with that HOME or inside it (a turn that just started, or
// a shell left running). The next session start recreates a home.
// Request data is JSON, never interpolated into executable code or a shell.
export const RECLAIM_SESSION_HOME_PROGRAM = String.raw`
const fs = await import('node:fs/promises');
const path = await import('node:path');
const os = await import('node:os');
const { createHash, randomUUID } = await import('node:crypto');
const { sessionId } = JSON.parse(await fs.readFile(path.join(process.argv[2], 'params.json'), 'utf8'));
if (typeof sessionId !== 'string' || !sessionId.trim()) process.exit(2);
const id = createHash('sha256').update(sessionId).digest('hex');
const homes = path.join(os.homedir(), '.nuphos', 'session-homes');
let unreadable;
const done = (result) => { process.stdout.write(JSON.stringify({ result, unreadable })); process.exit(0); };
// Processes of this user, each marked whether it is inside the runtime's tree:
// descendants of the topmost ancestor of this job that runs as the same user
// (tini in the image). The parent pid in /proc/<pid>/stat is readable for every
// process, so the tree is known even where environ is not. A session process
// can also sit outside it: an orphan adopted by a root pid 1 (Railway).
const userProcesses = async () => {
  const parent = new Map();
  for (const pid of await fs.readdir('/proc')) {
    const stat = /^\d+$/.test(pid) && (await fs.readFile('/proc/' + pid + '/stat', 'utf8').catch(() => ''));
    if (stat) parent.set(pid, stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
  }
  const sameUser = async (pid) => (await fs.stat('/proc/' + pid).catch(() => null))?.uid === process.getuid();
  let root = String(process.pid);
  for (let pid = parent.get(root); pid && pid !== '0' && (await sameUser(pid)); pid = parent.get(pid)) root = pid;
  const descends = (pid) => {
    for (let at = pid; at && at !== '0'; at = parent.get(at)) if (at === root) return true;
    return false;
  };
  // This job and the processes that launched it (instabox exec's sshd-session on a
  // Box, whose environ is unreadable) run no session, so they never keep a home.
  const own = new Set();
  for (let at = String(process.pid); at && at !== '0'; at = parent.get(at)) own.add(at);
  const found = [];
  for (const pid of parent.keys()) {
    if (!own.has(pid) && (await sameUser(pid))) found.push([pid, descends(pid)]);
  }
  return found;
};
// HOME is matched by the original path; a working directory follows the
// directory itself.
const inUse = async (dir, byHome) => {
  for (const [pid, inTree] of await userProcesses()) {
    // No working directory: the process has exited, possibly an unreaped
    // zombie whose environ is unreadable. An unreadable process in the
    // runtime's tree counts as a user, since keeping a home is always safe;
    // one outside it (a host's systemd --user) is not a session.
    const cwd = await fs.readlink('/proc/' + pid + '/cwd').catch((err) => (err.code === 'ENOENT' || err.code === 'ESRCH' ? null : ''));
    if (cwd === null) continue;
    const env = await fs.readFile('/proc/' + pid + '/environ', 'utf8').catch(() => null);
    if (env === null || cwd === '') {
      if (!inTree) continue;
      const comm = await fs.readFile('/proc/' + pid + '/comm', 'utf8').catch(() => '?');
      unreadable = pid + ' ' + comm.trim();
      return true;
    }
    if (env.split('\0').includes('HOME=' + byHome) || cwd === dir || cwd.startsWith(dir + '/')) return true;
  }
  return false;
};
const names = await fs.readdir(homes).catch(() => []);
// A job killed during the rm, or a failed rename back, leaves a home's
// <home>.reclaim-<ms>-* behind; its next reclaim removes it once nothing uses it.
// One younger than any job may still belong to a running job, so it waits.
const leftover = new RegExp('^(' + id + '(?:\\.[0-9a-f]{64})?)\\.reclaim-([0-9]+)-');
for (const name of names) {
  const match = leftover.exec(name);
  if (!match || !(Date.now() - Number(match[2]) > 10 * 60_000)) continue;
  const left = path.join(homes, name);
  if (!(await inUse(left, path.join(homes, match[1])))) await fs.rm(left, { recursive: true, force: true }).catch(() => {});
}
const reclaim = async (home) => {
  if (!(await fs.lstat(home).catch(() => null))) return 'absent';
  if (await inUse(home, home)) return 'in_use';
  // Set aside first: a session that starts now gets a fresh home, and one that
  // started during the scan is caught by the second scan and keeps this one.
  const aside = home + '.reclaim-' + Date.now() + '-' + randomUUID();
  // Gone since the check: another backend replica's sweep took it first.
  const moved = await fs.rename(home, aside).then(() => true, (err) => (err.code === 'ENOENT' ? false : Promise.reject(err)));
  if (!moved) return 'absent';
  if (await inUse(aside, home)) { await fs.rename(aside, home).catch(() => {}); return 'in_use'; }
  await fs.rm(aside, { recursive: true, force: true });
  return 'removed';
};
const teammates = names.filter((name) => new RegExp('^' + id + '\\.[0-9a-f]{64}$').test(name));
const results = [];
for (const name of [id, ...teammates]) results.push(await reclaim(path.join(homes, name)));
done(results.includes('in_use') ? 'in_use' : results.includes('removed') ? 'removed' : 'absent');
`
