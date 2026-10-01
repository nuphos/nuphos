export function complianceReadme(): string {
  return `Nuphos compliance audit export
================================

audit-events.csv is the human-readable record of who acted, when, which
identity/authorization was used, and which resource or operation was involved.

evidence/sessions/*.json contains the complete redacted event chain for every
selected Session. Each event's payloadHash covers its payload. entryHash covers
the event header and prevHash links it to the previous event. Any edit, deletion,
insertion, or reordering invalidates verification from that point onward.

Integrity levels:
- live: chain verified against the queryable journal.
- sealed: the complete chain is covered by immutable sealed storage.
- anchored: sealed and covered by a newer external anchor.
- violated: chain verification or displayed-copy verification failed.

resource-events.* contains direct skill/resource mutations. These records are
supplementary append-only audit records and are not part of a Session hash chain.

SHA256SUMS.txt covers every other file in this ZIP. Hash-exempt conversation
display copies and secrets are intentionally not exported.

Trust boundary: this export is currently unsigned and self-contained. Passing
verification proves that the package is internally consistent and complete
against its manifest; it does not authenticate Nuphos as the origin or prevent
someone with rewrite access from rebuilding the entire package. Trusted KMS
signatures and historical anchor proofs are tracked in NUPS-436.

To verify after extracting the ZIP (Node.js 20+):
  node verify.mjs
`
}

export function verifierScript(): string {
  return `import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const canonical = (value) => {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
};
const entryHeader = (event) => ({
  v: event.v,
  eventId: event.eventId,
  seq: event.seq,
  ts: event.ts,
  type: event.type,
  actor: { userId: event.actor.userId, teamId: event.actor.teamId },
  session: {
    conversationId: event.session.conversationId,
    requestId: event.session.requestId,
    streamId: event.session.streamId,
    toolCallId: event.session.toolCallId,
    modelId: event.session.modelId,
  },
  payloadHash: event.payloadHash,
  prevHash: event.prevHash,
});

let failures = 0;
const fail = (message) => { failures += 1; console.error('FAIL ' + message); };
const isSafeArchivePath = (name) => {
  if (typeof name !== 'string' || !name || name.includes('\\0') || name.includes('\\\\')) return false;
  if (path.isAbsolute(name) || path.win32.isAbsolute(name)) return false;
  return name.split('/').every((segment) => segment && segment !== '.' && segment !== '..');
};

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
if (!Array.isArray(manifest.files)) fail('manifest files inventory is missing');
if (!Array.isArray(manifest.sessions)) fail('manifest session inventory is missing');
const inventory = new Map();
for (const file of manifest.files ?? []) {
  if (!file || typeof file.name !== 'string' || typeof file.sha256 !== 'string' || typeof file.bytes !== 'number') {
    fail('malformed manifest file entry');
    continue;
  }
  if (!isSafeArchivePath(file.name)) {
    fail('unsafe inventory path: ' + file.name);
    continue;
  }
  if (inventory.has(file.name)) fail('duplicate inventory path: ' + file.name);
  inventory.set(file.name, file);
}

const sums = (await readFile('SHA256SUMS.txt', 'utf8')).trim().split('\\n').filter(Boolean);
const checksums = new Map();
for (const line of sums) {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) { fail('malformed checksum line: ' + line); continue; }
  if (!isSafeArchivePath(match[2])) {
    fail('unsafe checksum path: ' + match[2]);
    continue;
  }
  if (checksums.has(match[2])) fail('duplicate checksum path: ' + match[2]);
  checksums.set(match[2], match[1]);
}

const expectedChecksums = new Set([...inventory.keys(), 'manifest.json']);
for (const name of expectedChecksums) {
  if (!checksums.has(name)) fail('checksum entry missing: ' + name);
}
for (const name of checksums.keys()) {
  if (!expectedChecksums.has(name)) fail('unexpected checksum entry: ' + name);
}
for (const [name, expected] of checksums) {
  // Unexpected checksum entries are already a verification failure. Never
  // read them: a modified package must not turn the verifier into a local
  // file existence or content oracle.
  if (!expectedChecksums.has(name)) continue;
  try {
    const content = await readFile(name, 'utf8');
    if (sha256(content) !== expected) fail('checksum mismatch: ' + name);
  } catch { fail('listed file missing: ' + name); }
}
for (const [name, expected] of inventory) {
  try {
    const content = await readFile(name, 'utf8');
    if (sha256(content) !== expected.sha256) fail('manifest digest mismatch: ' + name);
    if (Buffer.byteLength(content, 'utf8') !== expected.bytes) fail('manifest size mismatch: ' + name);
  } catch { fail('inventory file missing: ' + name); }
}

const walk = async (dir = '', result = []) => {
  for (const entry of await readdir(dir || '.', { withFileTypes: true })) {
    const name = dir ? path.posix.join(dir, entry.name) : entry.name;
    if (entry.isDirectory()) await walk(name, result);
    else result.push(name);
  }
  return result;
};
const expectedFiles = new Set([...inventory.keys(), 'manifest.json', 'SHA256SUMS.txt']);
for (const name of await walk()) {
  if (!expectedFiles.has(name)) fail('unexpected file not in manifest: ' + name);
  expectedFiles.delete(name);
}
for (const name of expectedFiles) fail('expected file missing: ' + name);

if (manifest.selection?.sessionCount !== manifest.sessions.length) {
  fail('manifest session count does not match session inventory');
}
for (const summary of manifest.sessions) {
  const name = summary.evidenceFile;
  if (typeof name !== 'string' || !inventory.has(name)) {
    fail('session evidence file missing from inventory: ' + summary.sessionId);
    continue;
  }
  const session = JSON.parse(await readFile(name, 'utf8'));
  if (session.sessionId !== summary.sessionId) fail(name + ': sessionId does not match manifest');
  if (session.integrity?.headHash !== summary.integrity?.headHash) fail(name + ': head hash does not match manifest');
  let previous = '0'.repeat(64);
  let expectedSeq = 1;
  const eventIds = new Set();
  for (const event of session.events) {
    if (event.seq !== expectedSeq) fail(name + ': expected seq ' + expectedSeq + ', got ' + event.seq);
    if (event.prevHash !== previous) fail(name + ': broken previous hash at seq ' + event.seq);
    if (eventIds.has(event.eventId)) fail(name + ': duplicate eventId at seq ' + event.seq);
    eventIds.add(event.eventId);
    if (sha256(canonical(event.payload)) !== event.payloadHash) fail(name + ': payload hash mismatch at seq ' + event.seq);
    if (sha256(canonical(entryHeader(event))) !== event.entryHash) fail(name + ': entry hash mismatch at seq ' + event.seq);
    previous = event.entryHash;
    expectedSeq += 1;
  }
  if (previous !== (session.integrity.headHash ?? '0'.repeat(64))) fail(name + ': manifest head hash mismatch');
}

if (failures) {
  console.error('Verification failed with ' + failures + ' issue(s).');
  process.exit(1);
}
console.log('OK: exact inventory, checksums, and ' + manifest.sessions.length + ' complete session chain(s) verified.');
`
}
