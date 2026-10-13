"""Exercise Railway's one-volume runtime image without creating cloud resources."""
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
