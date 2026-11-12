import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { getBuiltinSkillsDirectory } from '@/lib/agent/skill-store/inject'

const helper = join(getBuiltinSkillsDirectory(), 'firebase/scripts/inspect.py')

test('Firebase helper uses selected credentials per invocation and outputs metadata only', () => {
  const result = Bun.spawnSync(['python3', '-c', `
import importlib.util, contextlib, io, json, os, sys
from unittest.mock import patch
spec = importlib.util.spec_from_file_location('firebase_helper', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
calls = []
def get(url, token):
    calls.append((url, token))
    if len(calls) == 1:
        return {'projectId':'bound-project', 'accessToken':'secret-access-token'}
    return {'apps':[{'appId':'web-app', 'platform':'WEB', 'apiKeyId':'hidden'}], 'nextPageToken':'next'}
with patch.dict(os.environ, {'NUPHOS_TOKEN':'secret-session-token', 'NUPHOS_BACKEND_URL':'https://backend.invalid', 'OPENAB_CREDENTIALS_DIR':''}), patch.object(m, 'get_json', get), patch.object(sys, 'argv', ['inspect.py','team','bound-project','binding','apps']):
    output = io.StringIO()
    with contextlib.redirect_stdout(output): m.main()
assert calls == [('https://backend.invalid/teams/team/gcp-projects/bound-project/credentials?serviceAccountId=binding','secret-session-token'), ('https://firebase.googleapis.com/v1beta1/projects/bound-project:searchApps?pageSize=100','secret-access-token')]
assert json.loads(output.getvalue()) == {'apps':[{'appId':'web-app','platform':'WEB'}], 'nextPageToken':'next'}
assert 'secret' not in output.getvalue()
assert m.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://untrusted.invalid') is None
`, helper])

  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toBe('')
})

test('denied credential handout prevents every Firebase call', () => {
  const result = Bun.spawnSync(['python3', '-c', `
import importlib.util, os, sys
from unittest.mock import patch
from urllib.error import HTTPError
spec = importlib.util.spec_from_file_location('firebase_helper', sys.argv[1])
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
calls = []
def denied(url, token):
    calls.append(url)
    raise HTTPError(url,403,'denied',{},None)
with patch.dict(os.environ, {'NUPHOS_TOKEN':'fixture', 'OPENAB_CREDENTIALS_DIR':''}), patch.object(m,'get_json',denied), patch.object(sys,'argv',['inspect.py','team','bound-project','binding','project']):
    try: m.main()
    except HTTPError as e: assert e.code == 403
    else: raise AssertionError('expected denial')
assert len(calls) == 1
assert 'firebase.googleapis.com' not in calls[0]
`, helper])

  expect(result.exitCode).toBe(0)
})
