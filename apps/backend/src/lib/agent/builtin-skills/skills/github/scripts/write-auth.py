#!/usr/bin/env python3
"""Store a GitHub installation response in gh's session config, without keyring calls."""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

target = Path(sys.argv[1]) / "hosts.yml"
credential = json.load(sys.stdin)
token = credential.get("token")
if not isinstance(token, str) or not token:
    raise SystemExit("Nuphos backend returned no GitHub installation token")
# Installation tokens have no human /user identity. Use the conventional Git
# token username rather than pretending that the installation owner is a user.
entry = {"user": "x-access-token", "oauth_token": token, "git_protocol": "https",
         "users": {"x-access-token": {"oauth_token": token}}}
# A fresh session already uses the multi-account schema. Without its version,
# gh 2.x attempts a /user lookup for every host, including installation tokens
# which cannot call that endpoint. Never replace existing user preferences.
try:
    config_fd = os.open(target.parent / "config.yml", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    pass
else:
    with os.fdopen(config_fd, "w") as config:
        config.write('version: "1"\n')
existing = target.read_text() if target.exists() else ""

if existing.lstrip().startswith("{"):
    # JSON is valid YAML; preserve other hosts if this file is already JSON.
    hosts = json.loads(existing)
    hosts["github.com"] = entry
    output = json.dumps(hosts, indent=2) + "\n"
else:
    # gh writes a block YAML map. Replace only the github.com block, preserving
    # other hosts byte-for-byte without requiring PyYAML on the user's desktop.
    lines = existing.splitlines(keepends=True)
    kept = []
    in_github = False
    for line in lines:
        if line.strip() and not line[0].isspace() and not line.startswith("#"):
            match = re.fullmatch(r'''(?:([\w.-]+)|"([\w.-]+)"|'([\w.-]+)'):[ \t]*(?:#.*)?\n?''', line)
            # Also accept the flow-style github entry this helper writes.
            if line.startswith("github.com: {"):
                in_github = True
                continue
            if not match:
                raise SystemExit("Unsupported gh hosts.yml format; refusing to overwrite it")
            in_github = next(value for value in match.groups() if value) == "github.com"
        if not in_github:
            kept.append(line)
    output = "".join(kept).rstrip() + "\n" if kept else ""
    output += "github.com: " + json.dumps(entry) + "\n"

# Replace atomically; concurrent readers see either the previous or fresh token.
fd, temporary = tempfile.mkstemp(prefix=".nuphos-auth-", dir=target.parent)
try:
    with os.fdopen(fd, "w") as stream:
        stream.write(output)
    os.replace(temporary, target)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
