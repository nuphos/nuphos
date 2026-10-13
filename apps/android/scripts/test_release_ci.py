"""Exercise release inputs and the exact isolated signing step with disposable keys."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import unittest
import zipfile

import release_metadata

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = ROOT / '.github/workflows/android-release.yml'
ANDROID = '{http://schemas.android.com/apk/res/android}'


def signing_script():
    text = WORKFLOW.read_text()
    start = text.index('      - name: Sign and verify bundle\n')
    block = text[start:].split('        run: |\n', 1)[1].split('\n      - ', 1)[0]
    return textwrap.dedent(block)


class ReleaseMetadataTest(unittest.TestCase):
    def test_version_boundaries(self):
        for code in ('1', '2100000000'):
            self.assertEqual(release_metadata.validate_version(code, '1.2.3-rc.1'), int(code))
        for code in ('0', '-1', '2100000001', '01', '1;echo secret', '1.0', ''):
            with self.subTest(code=code), self.assertRaises(ValueError):
                release_metadata.validate_version(code, '1.2.3')
        for name in ('', '../1', '1\n2', 'x' * 65, '1 $(id)'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                release_metadata.validate_version('2', name)

    def test_actual_manifest_must_match(self):
        xml = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="ai.nuphos.android" android:versionCode="2" android:versionName="1.2.3"><uses-sdk android:minSdkVersion="33" android:targetSdkVersion="36"/></manifest>'
        release_metadata.validate_manifest(xml, '2', '1.2.3')
        for old, new in (('ai.nuphos.android', 'com.other'), ('Code="2"', 'Code="3"'), ('1.2.3', '1.2.4'), ('"33"', '"34"'), ('"36"', '"35"')):
            with self.subTest(new=new), self.assertRaises(ValueError):
                release_metadata.validate_manifest(xml.replace(old, new), '2', '1.2.3')

    def test_presigned_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            bundle = Path(directory) / 'input.aab'
            with zipfile.ZipFile(bundle, 'w') as archive:
                archive.writestr('base/manifest/AndroidManifest.xml', 'manifest')
                archive.writestr('META-INF/KEY.RSA', 'certificate')
            with self.assertRaises(ValueError):
                release_metadata.validate_unsigned(bundle)


class SigningTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.shared = tempfile.TemporaryDirectory()
        cls.key = Path(cls.shared.name) / 'test.jks'
        env = {**os.environ, 'TEST_PASSWORD': 'disposable-test-password'}
        subprocess.run(['keytool', '-genkeypair', '-alias', 'upload', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '2', '-dname', 'CN=Disposable CI Test', '-keystore', str(cls.key), '-storetype', 'JKS', '-storepass:env', 'TEST_PASSWORD', '-keypass:env', 'TEST_PASSWORD'], env=env, check=True, capture_output=True)
        cert = subprocess.run(['keytool', '-exportcert', '-alias', 'upload', '-keystore', str(cls.key), '-storepass:env', 'TEST_PASSWORD'], env=env, check=True, capture_output=True).stdout
        cls.fingerprint = hashlib.sha256(cert).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.shared.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        source = self.directory / 'android-unsigned'
        source.mkdir()
        self.bundle = source / 'unsigned.aab'
        with zipfile.ZipFile(self.bundle, 'w') as archive:
            archive.writestr('base/manifest/AndroidManifest.xml', b'test manifest')
            archive.writestr('base/dex/classes.dex', b'test payload')
        self.metadata = {'source_commit': 'a' * 40, 'repository': 'nuphos/nuphos', 'run_id': '42', 'run_attempt': '1', 'package_id': 'ai.nuphos.android', 'version_code': 2, 'version_name': '1.2.3', 'min_sdk': 33, 'target_sdk': 36, 'unsigned_sha256': hashlib.sha256(self.bundle.read_bytes()).hexdigest(), 'signed': False}
        (source / 'metadata.json').write_text(json.dumps(self.metadata))
        self.env = {**os.environ, 'RUNNER_TEMP': str(self.directory), 'GITHUB_SHA': 'a' * 40, 'GITHUB_REPOSITORY': 'nuphos/nuphos', 'GITHUB_RUN_ID': '42', 'GITHUB_RUN_ATTEMPT': '1', 'VERSION_CODE': '2', 'VERSION_NAME': '1.2.3', 'ANDROID_UPLOAD_KEYSTORE_BASE64': base64.b64encode(self.key.read_bytes()).decode(), 'ANDROID_UPLOAD_STORE_PASSWORD': 'disposable-test-password', 'ANDROID_UPLOAD_KEY_PASSWORD': 'disposable-test-password', 'ANDROID_UPLOAD_KEY_ALIAS': 'upload', 'ANDROID_UPLOAD_CERT_SHA256': self.fingerprint}

    def run_sign(self):
        result = subprocess.run(['bash', '-c', signing_script()], env=self.env, capture_output=True, text=True, timeout=60)
        self.assertNotIn(self.env['ANDROID_UPLOAD_STORE_PASSWORD'], result.stdout + result.stderr)
        self.assertEqual(list(self.directory.glob('android-sign-*')), [], 'Temporary signing material must be removed')
        return result

    def test_success_has_only_public_output(self):
        result = self.run_sign()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        output = self.directory / 'android-signed'
        self.assertEqual(sorted(p.suffix for p in output.iterdir()), ['.aab', '.json', '.txt'])
        metadata = json.loads((output / 'metadata.json').read_text())
        signed = next(output.glob('*.aab'))
        self.assertEqual(metadata['upload_certificate_sha256'], self.fingerprint)
        self.assertEqual(metadata['signed_sha256'], hashlib.sha256(signed.read_bytes()).hexdigest())
        self.assertTrue(metadata['signed'])
        self.assertEqual(metadata['source_commit'], self.metadata['source_commit'])

    def test_missing_secrets_wrong_password_and_fingerprint_fail_closed(self):
        for field, value in (('ANDROID_UPLOAD_KEY_ALIAS', ''), ('ANDROID_UPLOAD_KEYSTORE_BASE64', 'invalid'), ('ANDROID_UPLOAD_STORE_PASSWORD', 'wrong-password'), ('ANDROID_UPLOAD_KEY_PASSWORD', 'wrong-password'), ('ANDROID_UPLOAD_CERT_SHA256', '0' * 64)):
            with self.subTest(field=field):
                old = self.env[field]
                self.env[field] = value
                self.assertNotEqual(self.run_sign().returncode, 0)
                self.assertFalse((self.directory / 'android-signed').exists())
                self.env[field] = old

    def test_changed_input_or_provenance_fails(self):
        original = self.bundle.read_bytes()
        with zipfile.ZipFile(self.bundle, 'a') as archive:
            archive.writestr('extra', 'changed')
        self.assertNotEqual(self.run_sign().returncode, 0)
        self.assertFalse((self.directory / 'android-signed').exists())
        self.bundle.write_bytes(original)
        for field, value in (('GITHUB_SHA', 'b' * 40), ('GITHUB_RUN_ATTEMPT', '2')):
            with self.subTest(field=field):
                old = self.env[field]
                self.env[field] = value
                self.assertNotEqual(self.run_sign().returncode, 0)
                self.assertFalse((self.directory / 'android-signed').exists())
                self.env[field] = old

    def test_verifier_rejects_tampering_and_unsigned_additions(self):
        self.assertEqual(self.run_sign().returncode, 0)
        signed = next((self.directory / 'android-signed').glob('*.aab'))
        script = signing_script()
        java = script.split('verifier.write_text(r\'\'\'\n', 1)[1].split("\n'''", 1)[0]
        verifier = self.directory / 'VerifyBundle.java'
        verifier.write_text(java)
        for mode in ('append', 'replace'):
            with self.subTest(mode=mode):
                candidate = self.directory / f'{mode}.aab'
                with zipfile.ZipFile(signed) as original, zipfile.ZipFile(candidate, 'w') as modified:
                    for item in original.infolist():
                        data = original.read(item)
                        if mode == 'replace' and item.filename == 'base/dex/classes.dex':
                            data = b'tampered'
                        modified.writestr(item, data)
                    if mode == 'append':
                        modified.writestr('base/dex/unsigned.dex', b'unsigned')
                result = subprocess.run(['java', str(verifier), str(candidate), self.fingerprint], capture_output=True)
                self.assertNotEqual(result.returncode, 0)


class WorkflowBoundaryTest(unittest.TestCase):
    def test_release_is_manual_canonical_main_and_secrets_are_isolated(self):
        text = WORKFLOW.read_text()
        guard = "github.event_name == 'workflow_dispatch' && github.repository == 'nuphos/nuphos' && github.ref == 'refs/heads/main'"
        self.assertEqual(text.count('if: ' + guard), 2)
        self.assertNotIn('pull_request:', text)
        build, sign = text.split('\n  sign:\n', 1)
        self.assertNotIn('secrets.', build)
        self.assertNotIn('actions/checkout', sign)
        self.assertIn('environment: android-release', sign)
        self.assertIn('needs: build', sign)
        self.assertIn('artifact-ids: ${{ needs.build.outputs.artifact_id }}', sign)
        self.assertIn('if: always()', sign)
        self.assertNotIn('packages: write', text)
        for ref in re.findall(r'uses: (\S+)', text):
            self.assertRegex(ref, r'@([a-f0-9]{40})$')


if __name__ == '__main__':
    unittest.main()
