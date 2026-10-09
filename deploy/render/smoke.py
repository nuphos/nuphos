"""Exercise startup interpolation in the released backend image without cloud resources."""
from pathlib import Path
import json
import subprocess
import tempfile

root = Path(__file__).parent
with tempfile.TemporaryDirectory() as directory:
    directory = Path(directory)
    stub = directory / 'index.ts'
    stub.write_text('console.log(JSON.stringify(process.env))')
    values = {
        'MONGO_HOST': 'mongo-private', 'MONGO_PASSWORD': 'test:@/?# secret',
        'STORAGE_HOST': 'storage-example.onrender.com',
        'RENDER_EXTERNAL_URL': 'https://backend-example.onrender.com',
    }
    env = directory / 'test.env'
    env.write_text(''.join(f'{k}={v}\n' for k, v in values.items()))
    env.chmod(0o600)
    args = ['docker', 'run', '--rm', '--env-file', str(env),
            '-v', f'{root / "start.sh"}:/app/render-start.sh:ro',
            '-v', f'{stub}:/app/src/index.ts:ro',
            'ghcr.io/nuphos/backend:v0.85.0', 'sh', '/app/render-start.sh']
    result = subprocess.run(args, check=True, capture_output=True, text=True)
    mapped = json.loads(result.stdout.strip().splitlines()[-1])
    assert mapped['MONGODB_URI'] == ('mongodb://nuphos:test%3A%40%2F%3F%23%20secret@'
                                   'mongo-private:27017/nuphos?authSource=admin&replicaSet=rs0&directConnection=true')
    for key in ['NUPHOS_AUTH_BASE_URL', 'NUPHOS_BACKEND_URL', 'NUPHOS_PUBLIC_BACKEND_URL']:
        assert mapped[key] == values['RENDER_EXTERNAL_URL']
    for key in ['NUPHOS_FILE_TRANSFER_S3_ENDPOINT', 'ATLAS_SKILLS_S3_ENDPOINT']:
        assert mapped[key] == 'https://storage-example.onrender.com'
    # Missing service wiring must fail immediately rather than starting against an invalid URI.
    missing = subprocess.run(['docker', 'run', '--rm',
                              '-v', f'{root / "start.sh"}:/app/render-start.sh:ro',
                              'ghcr.io/nuphos/backend:v0.85.0', 'sh', '/app/render-start.sh'],
                             capture_output=True)
    assert missing.returncode != 0
print('PASS: Render startup encodes credentials, maps HTTPS URLs and rejects missing wiring')

# Translate the actual Blueprint's commands, references and disks into a local Compose stack.
import secrets
import shutil
import shlex
import time
import yaml

blueprint = yaml.safe_load((root / 'render.yaml').read_text())['services']
values = {}
for service in blueprint:
    values[service['name']] = {v['key']: v.get('value', secrets.token_hex(32))
                               for v in service['envVars'] if 'fromService' not in v}
    values[service['name']]['RENDER_EXTERNAL_HOSTNAME'] = service['name'] + '.onrender.com'
    values[service['name']]['RENDER_EXTERNAL_URL'] = 'https://' + service['name'] + '.onrender.com'
for service in blueprint:
    for var in service['envVars']:
        if 'fromService' in var:
            ref = var['fromService']
            values[service['name']][var['key']] = (ref['name'] if ref.get('property') == 'host'
                                                  else values[ref['name']][ref['envVarKey']])
local = {'services': {}, 'volumes': {}}
for service in blueprint:
    name = service['name']
    # Render automatically restarts crashed services, including during Mongo initialization.
    spec = {'environment': values[name], 'restart': 'unless-stopped'}
    if service['runtime'] == 'image':
        spec['image'] = service['image']['url']
    else:
        spec['build'] = {'context': str(root.parent.parent), 'dockerfile': service['dockerfilePath']}
    if 'dockerCommand' in service:
        spec['command'] = [arg.replace('$', '$$') for arg in shlex.split(service['dockerCommand'])]
    if 'disk' in service:
        disk = service['disk']
        spec['volumes'] = [disk['name'] + ':' + disk['mountPath']]
        local['volumes'][disk['name']] = {}
    local['services'][name] = spec
with tempfile.TemporaryDirectory() as directory:
    config = Path(directory) / 'compose.yaml'
    config.write_text(yaml.safe_dump(local))
    config.chmod(0o600)
    project = 'nuphos-render-test-' + secrets.token_hex(4)
    compose_cli = ['docker', 'compose']
    if subprocess.run(compose_cli + ['version'], capture_output=True).returncode != 0:
        compose_cli = [shutil.which('docker-compose') or 'docker-compose']
    cmd = compose_cli + ['-p', project, '-f', str(config)]
    def compose(*args):
        result = subprocess.run(cmd + list(args), capture_output=True, text=True)
        if result.returncode:
            # Do not print the generated environment or database URI on failure.
            detail = result.stdout + result.stderr
            for env in values.values():
                for value in env.values():
                    if len(value) >= 16: detail = detail.replace(value, '[redacted]')
            raise RuntimeError(f'Render local stack command failed: {args[0]}: {detail[-2000:]}')
        return result.stdout.strip()
    mongo_probe = '''
const admin=db.getSiblingDB('admin');
if(!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME,process.env.MONGO_INITDB_ROOT_PASSWORD)) quit(1);
if(!db.hello().isWritablePrimary) quit(1);
const session=db.getMongo().startSession(); session.startTransaction();
session.getDatabase('render_smoke').items.updateOne({_id:1},{$set:{ok:true}},{upsert:true});
session.commitTransaction(); session.endSession();
if(db.getSiblingDB('render_smoke').items.findOne({_id:1}).ok!==true) quit(1);
'''
    storage_probe = '''set -eu
url=http://127.0.0.1:9000/nuphos-file-transfers/render-smoke
if [ "$1" = write ]; then
  curl -fsS --aws-sigv4 aws:amz:us-east-1:s3 --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" -X PUT --data render-persist "$url"
else
  test "$(curl -fsS --aws-sigv4 aws:amz:us-east-1:s3 --user "$S3_ACCESS_KEY:$S3_SECRET_KEY" "$url")" = render-persist
fi
'''
    backend_storage_probe = """
import {storageConfig} from './src/config/storage.ts';
import {makeS3Client} from './src/lib/storage/s3-client.ts';
import {PutObjectCommand,GetObjectCommand} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
const stores=storageConfig();
for (const opts of [stores.fileTransfer.s3,stores.skillsStore.s3]) {
  if (!opts.bucket || !opts.accessKeyId || !opts.secretAccessKey) throw Error('Missing backend S3 configuration');
  const client=makeS3Client({...opts,endpoint:'http://nuphos-storage:9000',requestChecksumCalculation:'WHEN_REQUIRED'});
  const input={Bucket:opts.bucket,Key:'backend-client-smoke'};
  if(process.env.RENDER_TEST_PHASE==='startup') {
    const put=await getSignedUrl(client,new PutObjectCommand(input),{expiresIn:60});
    if(!(await fetch(put,{method:'PUT',body:'backend-persist'})).ok)throw Error('Backend signed upload failed');
  }
  const get=await getSignedUrl(client,new GetObjectCommand(input),{expiresIn:60});
  if(await (await fetch(get)).text()!=='backend-persist')throw Error('Backend signed download/persistence failed');
}
"""
    try:
        compose('up', '-d', '--build')
        for phase in ('startup', 'replacement'):
            if phase == 'replacement':
                compose('up', '-d', '--force-recreate')
            for _ in range(90):
                probe = subprocess.run(cmd + ['exec', '-T', 'nuphos-backend', 'bun', '-e',
                      "const r=await fetch('http://127.0.0.1:3000/health/ready');if(r.status!==200)process.exit(1)"],
                      capture_output=True)
                if probe.returncode == 0:
                    break
                time.sleep(2)
            else:
                raise RuntimeError('Render local backend readiness timed out')
            if phase == 'replacement':
                compose('exec', '-T', 'nuphos-mongo', 'mongosh',
                        'mongodb://localhost:27017/?directConnection=true', '--quiet', '--eval',
                        "const a=db.getSiblingDB('admin');a.auth(process.env.MONGO_INITDB_ROOT_USERNAME,process.env.MONGO_INITDB_ROOT_PASSWORD);if(db.getSiblingDB('render_smoke').items.findOne({_id:1})?.ok!==true)quit(1)")
            compose('exec', '-T', 'nuphos-mongo', 'mongosh',
                    'mongodb://localhost:27017/?directConnection=true', '--quiet', '--eval', mongo_probe)
            for _ in range(60):
                ready = subprocess.run(cmd + ['exec', '-T', 'nuphos-storage', 'test', '-f', '/tmp/buckets-ready'],
                                       capture_output=True)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Render storage bucket initialization timed out')
            if phase == 'startup':
                compose('exec', '-T', 'nuphos-storage', 'sh', '-c', storage_probe, 'probe', 'write')
            compose('exec', '-T', 'nuphos-storage', 'sh', '-c', storage_probe, 'probe', 'read')
            compose('exec', '-T', '-e', f'RENDER_TEST_PHASE={phase}', 'nuphos-backend', 'bun', '-e', backend_storage_probe)
            redis = compose('exec', '-T', 'nuphos-backend', 'bun', '-e',
                            "console.log(JSON.stringify(await (await fetch('http://127.0.0.1:3000/health/redis')).json()))")
            assert json.loads(redis)['status'] == 'disabled'
            print(f'PASS: Render backend readiness, authenticated Mongo transactions, signed S3 and persistence after {phase}', flush=True)
    finally:
        subprocess.run(cmd + ['down', '-v', '--remove-orphans'], capture_output=True)
