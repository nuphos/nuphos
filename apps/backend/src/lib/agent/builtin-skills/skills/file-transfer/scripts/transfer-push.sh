#!/usr/bin/env bash
# Push sandbox files out to the Nuphos transfer store as a download group so
# the user can download them (ZEA-9910).
# Usage: transfer-push.sh <teamId> <path> [<path>...]
#   <path> may be a file or a directory (directories are walked, preserving
#   relative structure). For very large trees, zip first and push the zip.
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

if [ "$#" -lt 2 ]; then
  echo "Usage: transfer-push.sh <teamId> <path> [<path>...]" >&2
  exit 2
fi

team_id="$1"; shift
base="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base="${base%/}"
token="${NUPHOS_TOKEN:-}"
session="${NUPHOS_SESSION_ID:-}"
if [ -z "$token" ] || [ -z "$session" ]; then
  echo "NUPHOS_TOKEN and NUPHOS_SESSION_ID must be set" >&2
  exit 1
fi
api="${base}/agent-sessions/${session}/teams/${team_id}/file-transfers"

# 1. Build the file manifest: { localPath, relPath, size, contentType } for
#    every file under the given paths.
manifest_json="$(python3 - "$@" <<'PY'
import json, os, sys, mimetypes
items = []
for root in sys.argv[1:]:
    if os.path.isdir(root):
        base = os.path.basename(os.path.normpath(root))
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                lp = os.path.join(dirpath, name)
                rel = os.path.join(base, os.path.relpath(lp, root))
                items.append((lp, rel))
    elif os.path.isfile(root):
        items.append((root, os.path.basename(root)))
    else:
        print(f"skip (not found): {root}", file=sys.stderr)
files = []
for lp, rel in items:
    size = os.path.getsize(lp)
    ctype = mimetypes.guess_type(lp)[0]
    files.append({"localPath": lp, "relPath": rel.replace(os.sep, "/"),
                  "fileName": os.path.basename(rel), "size": size,
                  "contentType": ctype})
json.dump(files, sys.stdout)
PY
)"

count="$(echo "$manifest_json" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
if [ "$count" -eq 0 ]; then
  echo "No files to push" >&2; exit 1
fi

# 2. Create the download transfer group (presigned PUT URLs come back).
create_body="$(echo "$manifest_json" | python3 -c '
import json, sys
files = json.load(sys.stdin)
out = {"direction": "download",
       "files": [{"fileName": f["fileName"], "relPath": f["relPath"],
                  "size": f["size"], "contentType": f["contentType"]} for f in files]}
json.dump(out, sys.stdout)')"

create_resp="$(curl -fsSL -X POST -H "Authorization: Bearer ${token}" \
  -H "Content-Type: application/json" -d "$create_body" "${api}")"
group_id="$(echo "$create_resp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["groupId"])')"

# 3. PUT each file directly to its presigned URL (sandbox → S3, no backend in
#    the path). Match upload URLs to local files by relPath.
python3 - "$create_resp" "$manifest_json" <<'PY'
import json, sys, subprocess
created = json.loads(sys.argv[1])
manifest = json.loads(sys.argv[2])
by_rel = {m["relPath"]: m for m in manifest}
ok = 0
for f in created.get("files", []):
    m = by_rel.get(f["relPath"])
    if not m:
        print(f"  no local match for {f['relPath']}", file=sys.stderr); continue
    headers = []
    if m.get("contentType"):
        headers = ["-H", f"Content-Type: {m['contentType']}"]
    rc = subprocess.run(["curl", "-fsSL", "-X", "PUT", *headers,
                         "--upload-file", m["localPath"], f["uploadUrl"]]).returncode
    if rc == 0:
        ok += 1; print(f"  pushed {f['relPath']}")
    else:
        print(f"  FAILED {f['relPath']}", file=sys.stderr)
print(f"Uploaded {ok}/{len(created.get('files', []))} file(s)")
PY

# 4. Finalize — backend HEADs each object and sets the group ready/partial.
final_resp="$(curl -fsSL -X POST -H "Authorization: Bearer ${token}" "${api}/${group_id}/finalize")"
status="$(echo "$final_resp" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')"

echo "Transfer group ${group_id} is ${status} (${count} file(s))."
if [ "$status" != "ready" ]; then
  echo "Some files did not finalize (status: ${status}). Re-push the missing file(s) and finalize again before telling the user." >&2
  exit 1
fi
echo "Tell the user the file(s) are ready to download in the conversation."
