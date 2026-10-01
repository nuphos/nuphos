#!/usr/bin/env bash
# Pull a Nuphos upload transfer group into the sandbox (ZEA-9910).
# Usage: transfer-pull.sh <teamId> <groupId> <dest-dir> [--extract]
#
# Pass --extract when the upload is a folder archive (a single .zip the desktop
# produced from a directory / multi-file selection). Each pulled .zip is then
# unpacked in place via python's zipfile (no `unzip` binary needed) and removed,
# so the agent sees the original directory structure.
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then
  echo "Usage: transfer-pull.sh <teamId> <groupId> <dest-dir> [--extract]" >&2
  exit 2
fi

team_id="$1"
group_id="$2"
dest_dir="$3"
extract=0
if [ "$#" -eq 4 ]; then
  if [ "$4" = "--extract" ]; then
    extract=1
  else
    echo "Unknown argument: $4 (expected --extract)" >&2
    exit 2
  fi
fi

base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base="${base%/}"
token="${NUPHOS_TOKEN:-}"
session="${NUPHOS_SESSION_ID:-}"

if [ -z "$token" ] || [ -z "$session" ]; then
  echo "NUPHOS_TOKEN and NUPHOS_SESSION_ID must be set" >&2
  exit 1
fi

mkdir -p "$dest_dir"
url="${base}/agent-sessions/${session}/teams/${team_id}/file-transfers/${group_id}/download"
resp="$(curl -fsSL -H "Authorization: Bearer ${token}" "$url")"

# Parse the file list, download each ready file (preserving relPath), and
# optionally unpack any pulled .zip archives.
python3 - "$dest_dir" "$resp" "$extract" <<'PY'
import json, os, sys, subprocess, zipfile
dest = sys.argv[1]
data = json.loads(sys.argv[2])
extract = sys.argv[3] == "1"
dest_abs = os.path.abspath(dest)
files = data.get("files", [])
ready = [f for f in files if f.get("status") == "ready" and f.get("downloadUrl")]
pending = [f for f in files if f.get("status") != "ready"]

def safe_rel(rel):
    rel = os.path.normpath(rel).lstrip("/")
    return None if rel.startswith("..") else rel

ok = 0
failed = 0
pulled_paths = []
for f in ready:
    rel = safe_rel(f.get("relPath") or f.get("fileName"))
    if rel is None:
        failed += 1
        print(f"  skip unsafe path: {f.get('relPath')}", file=sys.stderr); continue
    out = os.path.join(dest, rel)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    rc = subprocess.run(["curl", "-fsSL", f["downloadUrl"], "-o", out]).returncode
    if rc == 0:
        ok += 1
        pulled_paths.append(out)
        print(f"  pulled {rel}")
    else:
        failed += 1
        print(f"  FAILED {rel}", file=sys.stderr)
print(f"Pulled {ok}/{len(files)} file(s) into {dest}")

if extract:
    for out in pulled_paths:
        if not out.lower().endswith(".zip"):
            continue
        try:
            with zipfile.ZipFile(out) as z:
                for m in z.infolist():
                    tgt = os.path.abspath(os.path.join(dest, m.filename))
                    # Reject zip-slip entries that escape the destination.
                    if tgt != dest_abs and not tgt.startswith(dest_abs + os.sep):
                        print(f"  skip unsafe zip entry: {m.filename}", file=sys.stderr); continue
                    z.extract(m, dest)
            os.remove(out)
            print(f"  extracted {os.path.relpath(out, dest)}")
        except Exception as e:
            failed += 1
            print(f"  extract FAILED {os.path.relpath(out, dest)}: {e}", file=sys.stderr)

if pending:
    names = ", ".join(p.get("fileName","?") for p in pending)
    print(f"Not ready yet ({len(pending)}): {names} — re-run to retry", file=sys.stderr)

# Non-zero exit if anything failed or is still pending, so the agent doesn't
# continue a workflow with missing inputs.
if failed > 0 or pending:
    sys.exit(1)
PY
