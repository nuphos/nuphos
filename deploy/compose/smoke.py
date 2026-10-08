#!/usr/bin/env python3
"""Exercise an already running local stack; creates a disposable test user/team.

Run from deploy/compose with Python 3. No cloud or model credentials required.
"""
import json
import re
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit, urlunsplit


def compose(*args):
    return subprocess.check_output(['docker', 'compose', *args], text=True)


settings = json.loads(compose('config', '--format', 'json'))
services = settings['services']
backend_port = services['backend']['ports'][0]['published']
storage_port = services['rustfs']['ports'][0]['published']
base = f'http://127.0.0.1:{backend_port}'
# Ignore host proxy settings: every request in this test is local.
http = urllib.request.build_opener(urllib.request.ProxyHandler({}))
token = None


def api(path, body=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(base + path,
                                    data=json.dumps(body).encode() if body is not None else None,
                                    headers=headers)
    with http.open(request, timeout=60) as response:
        return json.load(response)


def transfer(url, data=None):
    # Match the documented hosts mapping without modifying the test machine.
    # Preserve the signed Host header; custom published ports work here too.
    parsed = urlsplit(url)
    if parsed.hostname != 'rustfs':
        raise RuntimeError('Expected the local RustFS endpoint')
    local = urlunsplit(parsed._replace(netloc=f'127.0.0.1:{storage_port}'))
    request = urllib.request.Request(local, data=data,
                                    headers={'Host': parsed.netloc, 'Content-Type': 'text/plain'},
                                    method='PUT' if data is not None else 'GET')
    with http.open(request, timeout=30) as response:
        return response.read()


assert api('/health/ready')['status'] == 'ok'
assert api('/health/redis')['status'] == 'ok'
print('PASS: backend, MongoDB and Redis are ready', flush=True)

email = f'compose-smoke-{time.time_ns()}@example.com'
api('/auth/email/request-code', {'email': email})
logs = compose('logs', '--no-color', 'backend')
code = None
for line in logs.splitlines():
    if email in line and 'auth.email_otp.dev_code' in line:
        match = re.search(r'"sign_in_code"\s*:\s*"(\d{6})"', line)
        if match:
            code = match.group(1)
assert code, 'The development OTP was not logged'
token = api('/auth/email/verify-code', {'email': email, 'code': code})['token']
team_id = api('/teams', {'name': 'Compose smoke test'})['team']['id']
root = f'/teams/{team_id}'
assert api(root + '/agent-triggers/scheduler-status')['cronEnabled']
print('PASS: email sign-in, team creation and cron availability', flush=True)
# Exercise the same S3 SDK and retention headers the journal sealer uses.
compose('exec', '-T', 'backend', 'bun', '-e', '''
import { PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { makeS3Client } from './src/lib/storage/s3-client';
import { config } from './src/config';
const j = config.journal;
const s3 = makeS3Client({region:j.s3Region, endpoint:j.s3Endpoint,
  accessKeyId:j.awsAccessKeyId, secretAccessKey:j.awsSecretAccessKey});
const Key = 'compose-smoke/' + Date.now();
await s3.send(new PutObjectCommand({Bucket:j.s3Bucket, Key, Body:'smoke',
  ObjectLockMode:'GOVERNANCE', ObjectLockRetainUntilDate:new Date(Date.now()+3600000)}));
const head = await s3.send(new HeadObjectCommand({Bucket:j.s3Bucket, Key}));
if (head.ObjectLockMode !== 'GOVERNANCE') throw new Error('Journal retention missing');
''')
print('PASS: journal object retention', flush=True)

password = compose('exec', '-T', 'runtime', 'cat', '/home/node/.nuphos-runtime/auth-key').strip()
runtime = api(root + '/agent-runtimes/external', {
    'url': 'ws://runtime:8080/acp', 'authKey': password, 'label': 'Compose smoke runtime',
})
assert runtime['provider'] == 'claude-code', 'Provider detection failed'
status = api(root + f"/agent-runtimes/{runtime['id']}/status")
assert status.get('online'), 'Backend cannot reach the runtime'
print('PASS: runtime registration, provider detection and authenticated status', flush=True)

payload = b'Compose storage round trip\n'
group = api(root + '/file-transfers', {
    'direction': 'upload',
    'files': [{'fileName': 'smoke.txt', 'size': len(payload), 'contentType': 'text/plain'}],
})
transfer(group['files'][0]['uploadUrl'], payload)
api(root + f"/file-transfers/{group['groupId']}/finalize", {})
download = api(root + f"/file-transfers/{group['groupId']}/download")
assert transfer(download['files'][0]['downloadUrl']) == payload
print('PASS: presigned upload, backend finalization and download', flush=True)
# Restart the stack and reuse the SAME token, team, runtime and object. A new
# user after restart would not prove the original data survived.
compose('restart')
compose('up', '-d', '--wait', '--wait-timeout', '300')
assert api('/health/ready')['status'] == 'ok'
assert api('/health/redis')['status'] == 'ok'
status = api(root + f"/agent-runtimes/{runtime['id']}/status")
assert status.get('online'), 'Runtime/password did not survive restart'
download = api(root + f"/file-transfers/{group['groupId']}/download")
assert transfer(download['files'][0]['downloadUrl']) == payload
print('PASS: sign-in, team, runtime credentials and stored file survive restart', flush=True)
print('PASS: local stack smoke test (model sign-in/inference is a separate operator step)')
