"""Exercise the Mongo bootstrap and Railway's one-volume runtime image without creating cloud resources."""
import secrets
import subprocess
import tempfile
import time
from pathlib import Path

root = Path(__file__).parent
name = f'nuphos-railway-test-{secrets.token_hex(4)}'
volume = name + '-home'
image = name + ':test'


def docker(*args):
    return subprocess.run(['docker', *args], check=True, capture_output=True, text=True).stdout.strip()


with tempfile.TemporaryDirectory() as directory:
    env_file = Path(directory) / 'runtime.env'
    env_file.write_text('OPENAB_ACP_AUTH_KEY=' + secrets.token_hex(32) + '\n')
    env_file.chmod(0o600)
    try:
        docker('build', '-t', image, str(root / 'runtime'))
        docker('volume', 'create', volume)
        for phase in ('initial startup', 'container replacement'):
            docker('run', '-d', '--name', name, '--env-file', str(env_file),
                   '-v', f'{volume}:/home/node', image)
            for _ in range(90):
                probe = subprocess.run(['docker', 'exec', name, 'curl', '-fsS',
                                        'http://127.0.0.1:8080/'], capture_output=True)
                if probe.returncode == 0:
                    break
                time.sleep(2)
            else:
                raise RuntimeError(f'Runtime did not become ready during {phase}')
            # The app process must run as node, even though the entrypoint initializes a root-owned volume.
            assert docker('exec', name, 'sh', '-c', 'ps -o uid= -p "$(pgrep -x openab)"') == '1000'
            assert docker('exec', name, 'readlink', '-f', '/workspace') == '/home/node/workspace'
            if phase == 'initial startup':
                docker('exec', '-u', '1000:1000', name, 'sh', '-c',
                       'echo workspace > /workspace/persist-test; echo home > /home/node/persist-test')
            else:
                assert docker('exec', '-u', '1000:1000', name, 'cat', '/workspace/persist-test') == 'workspace'
                assert docker('exec', '-u', '1000:1000', name, 'cat', '/home/node/persist-test') == 'home'
            print(f'PASS: Railway runtime non-root process and persistent files, {phase}', flush=True)
            docker('rm', '-f', name)
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', volume], capture_output=True)
        subprocess.run(['docker', 'image', 'rm', image], capture_output=True)

# The Mongo bootstrap (also used by the Helm chart): keyfile auth, a one-node replica set,
# and transactions that still work after a restart.
mongo = name + '-mongo'
probe = """
const admin = db.getSiblingDB('admin');
if (!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME, process.env.MONGO_INITDB_ROOT_PASSWORD)) quit(1);
if (!db.hello().isWritablePrimary) quit(1);
const session = db.getMongo().startSession();
session.startTransaction();
session.getDatabase('smoke').items.insertOne({ok: true});
session.commitTransaction();
session.endSession();
"""
with tempfile.TemporaryDirectory() as directory:
    env_file = Path(directory) / 'mongo.env'
    password = secrets.token_hex(32)
    env_file.write_text('MONGO_INITDB_ROOT_USERNAME=nuphos\n'
                        f'MONGO_INITDB_ROOT_PASSWORD={password}\n'
                        'NUPHOS_MONGO_HOST=localhost\n'
                        'GLIBC_TUNABLES=glibc.pthread.rseq=1\n')
    env_file.chmod(0o600)
    try:
        # mongo.sh passes --ipv6, so enable IPv6 in the container as Railway's network does.
        docker('run', '-d', '--name', mongo, '--env-file', str(env_file),
               '--sysctl', 'net.ipv6.conf.all.disable_ipv6=0',
               '-v', f'{root / "mongo.sh"}:/opt/mongo.sh:ro',
               '--entrypoint', '/bin/bash', 'mongo:8.0.32', '/opt/mongo.sh')
        for phase in ('initial startup', 'restart'):
            if phase == 'restart':
                docker('restart', mongo)
            for _ in range(60):
                result = subprocess.run(['docker', 'exec', mongo, 'mongosh', '--quiet',
                                         'mongodb://127.0.0.1:27017/?directConnection=true&serverSelectionTimeoutMS=2000',
                                         '--eval', probe], capture_output=True, text=True)
                if result.returncode == 0:
                    break
                time.sleep(2)
            else:
                logs = subprocess.run(['docker', 'logs', '--tail', '50', mongo], capture_output=True, text=True)
                raise RuntimeError(f'Mongo {phase} failed: '
                                   + (logs.stdout + logs.stderr + result.stderr).replace(password, '[redacted]')[-8000:])
            print(f'PASS: Mongo authentication and transaction after {phase}', flush=True)
    finally:
        subprocess.run(['docker', 'rm', '-fv', mongo], capture_output=True)
