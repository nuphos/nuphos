"""Check deployable wiring, disk coverage and runtime network separation."""
from pathlib import Path
import shlex
import subprocess
import yaml

root = Path(__file__).parent
stack = yaml.safe_load((root / 'render.yaml').read_text())['services']
runtime = yaml.safe_load((root / 'runtime.yaml').read_text())['services'][0]
services = {s['name']: s for s in stack}
assert set(services) == {'nuphos-mongo', 'nuphos-storage', 'nuphos-backend'}
assert runtime['region'] != services['nuphos-mongo']['region']
assert runtime['disk']['mountPath'] == '/home/node'
assert {v['key'] for v in runtime['envVars']} == {'PORT', 'OPENAB_STREAM_EDIT_INTERVAL_MS', 'OPENAB_ACP_AUTH_KEY'}
assert services['nuphos-mongo']['type'] == 'pserv'
assert services['nuphos-mongo']['disk']['mountPath'] == '/data'
assert services['nuphos-storage']['disk']['mountPath'] == '/data'
for s in stack:
    assert s['region'] == 'oregon'
    assert s['plan'] != 'free' and s['numInstances'] == 1
    keys = [v['key'] for v in s['envVars']]
    assert len(keys) == len(set(keys))
    for v in s['envVars']:
        if 'fromService' in v:
            ref = v['fromService']
            target = services[ref['name']]
            assert ref['type'] == target['type']
            if 'envVarKey' in ref and not ref['envVarKey'].startswith('RENDER_'):
                assert ref['envVarKey'] in {v['key'] for v in target['envVars']}
    if 'dockerCommand' in s:
        shell, flag, script = shlex.split(s['dockerCommand'])
        assert flag == '-c'
        subprocess.run([shell, '-n'], input=script, text=True, check=True)
backend = {v['key']: v for v in services['nuphos-backend']['envVars']}
assert backend['ATLAS_REDIS_ENABLED']['value'] == 'false'
assert 'NUPHOS_DEV_EMAIL_OTP_LOG' not in backend
assert backend['ZSEND_API_KEY']['sync'] is False
assert backend['NUPHOS_EMAIL_FROM']['sync'] is False
subprocess.run(['sh', '-n', str(root / 'start.sh')], check=True)
print('PASS: Blueprint references, persistent disks, private Mongo and isolated runtime')
