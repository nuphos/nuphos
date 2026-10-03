// Fixed bridge program. Only signed download references travel on job stdin;
// image bytes never pass through ACP or a shell command.
export const ATTACHMENT_RUNNER = String.raw`
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
const { files } = JSON.parse(await readFile(join(process.argv[2], 'params.json'), 'utf8'));
const dir = await mkdtemp(join(tmpdir(), 'nuphos-attachments-'));
const paths = [];
try {
  for (const [index, file] of files.entries()) {
    const folder = join(dir, String(index));
    await mkdir(folder, { mode: 0o700 });
    const name = file.name.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '_');
    const path = join(folder, !name || name === '.' || name === '..' ? 'attachment' : name);
    const response = await fetch(file.url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('Download failed');
    let size = 0;
    await pipeline(Readable.fromWeb(response.body), new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        done(size > file.size ? new Error('Attachment exceeded declared size') : null, chunk);
      }
    }), createWriteStream(path, { mode: 0o600, flags: 'wx' }));
    if (size !== file.size) throw new Error('Incomplete attachment');
    paths.push(path);
  }
  process.stdout.write(JSON.stringify({ paths }));
} catch {
  await rm(dir, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ error: 'Could not prepare attachments on the runtime' }));
  process.exitCode = 1;
}
`
