"""Validate release inputs against the actual bundle manifest; record public provenance."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

ANDROID = '{http://schemas.android.com/apk/res/android}'


def validate_version(code, name):
    if not re.fullmatch(r'[1-9][0-9]{0,9}', code) or int(code) > 2100000000:
        raise ValueError('Version code must be an integer from 1 to 2100000000 without leading zeros')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}', name):
        raise ValueError('Version name must contain 1-64 filename-safe characters')
    return int(code)


def validate_manifest(xml, code, name):
    validate_version(code, name)
    manifest = ET.fromstring(xml)
    sdk = manifest.find('uses-sdk')
    if (manifest.get('package') != 'ai.nuphos.android'
            or manifest.get(ANDROID + 'versionCode') != code
            or manifest.get(ANDROID + 'versionName') != name
            or sdk is None or sdk.get(ANDROID + 'minSdkVersion') != '33'
            or sdk.get(ANDROID + 'targetSdkVersion') != '36'):
        raise ValueError('Built manifest does not match approved package, version or SDK values')


def validate_unsigned(bundle):
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
        if 'base/manifest/AndroidManifest.xml' not in names or len(names) != len(set(names)):
            raise ValueError('Invalid bundle structure')
        if any(re.fullmatch(r'META-INF/[^/]+\.(SF|RSA|DSA|EC)', name.upper()) for name in names):
            raise ValueError('Build input must be unsigned')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version-code', required=True)
    parser.add_argument('--version-name', required=True)
    parser.add_argument('--manifest', type=Path)
    parser.add_argument('--bundle', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    code = validate_version(args.version_code, args.version_name)
    if not any((args.manifest, args.bundle, args.output)):
        return
    if not all((args.manifest, args.bundle, args.output)):
        parser.error('manifest, bundle and output are required together')
    validate_manifest(args.manifest.read_text(), args.version_code, args.version_name)
    validate_unsigned(args.bundle)
    metadata = {
        'source_commit': os.environ['GITHUB_SHA'],
        'repository': os.environ['GITHUB_REPOSITORY'],
        'run_id': os.environ['GITHUB_RUN_ID'],
        'run_attempt': os.environ['GITHUB_RUN_ATTEMPT'],
        'package_id': 'ai.nuphos.android',
        'version_code': code, 'version_name': args.version_name,
        'min_sdk': 33, 'target_sdk': 36, 'signed': False,
        'unsigned_sha256': hashlib.sha256(args.bundle.read_bytes()).hexdigest(),
    }
    args.output.write_text(json.dumps(metadata, indent=2) + '\n')


if __name__ == '__main__':
    main()
