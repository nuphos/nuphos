"""Validate the template schema and, with --mongo, exercise its Mongo bootstrap."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.request

import jsonschema
from referencing import Registry, Resource
import yaml

root = Path(__file__).parent
spec = yaml.safe_load((root / 'template.yaml').read_text())
schemas = {}
for name in ('template', 'prebuilt'):
    with urllib.request.urlopen(f'https://schema.zeabur.app/{name}.json', timeout=30) as response:
        schema = json.load(response)
        schemas[schema['$id']] = Resource.from_contents(schema)
registry = Registry().with_resources(schemas.items())
jsonschema.Draft7Validator(schemas['https://schema.zeabur.app/template.json'].contents,
                          registry=registry).validate(spec)
services = {service['name']: service for service in spec['spec']['services']}
assert set(services) == {'mongo', 'rustfs', 'backend', 'runtime'}
backend = services['backend']['spec']['env']
assert backend['NODE_ENV']['default'] == 'production'
assert backend['ATLAS_REDIS_ENABLED']['default'] == 'false'
assert 'NUPHOS_DEV_EMAIL_OTP_LOG' not in backend
assert services['mongo']['spec']['portForwarding']['enabled'] is False
for service in services.values():
    for config in service['spec'].get('configs', []):
        subprocess.run(['bash', '-n'], input=config['template'], text=True, check=True)
print('PASS: official schemas, production defaults and startup script syntax', flush=True)

if '--mongo' in sys.argv:
    mongo = services['mongo']['spec']
    name = 'nuphos-template-mongo'
    script = mongo['configs'][0]
    with tempfile.TemporaryDirectory() as directory:
        directory = Path(directory)
        startup = directory / 'startup.sh'
        startup.write_text(script['template'])
        startup.chmod(0o644)
        env = directory / 'mongo.env'
        env.write_text('MONGO_INITDB_ROOT_USERNAME=nuphos\n'
                       f'MONGO_INITDB_ROOT_PASSWORD={secrets.token_hex(32)}\n'
                       f'MONGO_REPLICA_KEY={secrets.token_hex(32)}\n'
                       f'NUPHOS_MONGO_HOST={name}\n')
        env.chmod(0o600)
        probe = '''
const admin = db.getSiblingDB('admin');
if (!admin.auth(process.env.MONGO_INITDB_ROOT_USERNAME,process.env.MONGO_INITDB_ROOT_PASSWORD)) quit(1);
if (!db.hello().isWritablePrimary) quit(1);
const session = db.getMongo().startSession();
session.startTransaction();
session.getDatabase('smoke').items.insertOne({ok:true});
session.commitTransaction();
session.endSession();
'''
        try:
            subprocess.run(['docker', 'run', '-d', '--name', name, '--hostname', name,
                            '--env-file', str(env), '-v', f'{startup}:{script["path"]}:ro',
                            '--entrypoint', mongo['source']['command'][0],
                            mongo['source']['image'], *mongo['source']['command'][1:]],
                           check=True, stdout=subprocess.DEVNULL)
            for phase in ('initial startup', 'restart'):
                if phase == 'restart':
                    subprocess.run(['docker', 'restart', name], check=True,
                                   stdout=subprocess.DEVNULL)
                for attempt in range(120):
                    result = subprocess.run(['docker', 'exec', name, 'mongosh', '--quiet',
                                             '--eval', probe], capture_output=True, text=True)
                    if result.returncode == 0:
                        break
                    time.sleep(2)
                else:
                    raise RuntimeError(f'Mongo {phase} failed to become primary')
                print(f'PASS: template Mongo authentication and transaction after {phase}', flush=True)
        finally:
            subprocess.run(['docker', 'rm', '-fv', name], check=False,
                           stdout=subprocess.DEVNULL)
