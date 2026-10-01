#!/usr/bin/env bash
set -euo pipefail
if [[ -n "${OPENAB_CREDENTIALS_DIR:-}" ]]; then
  NUPHOS_TOKEN=$(cat "$OPENAB_CREDENTIALS_DIR/NUPHOS_TOKEN" 2>/dev/null || true)
  export NUPHOS_TOKEN
fi

usage() {
  cat <<'EOF'
Usage: openapi.sh [--summary] [--path TEXT] [--operation OPERATION_ID] [--raw] [--no-refresh]

Fetch the current Nuphos OpenAPI document and print a compact view.

Options:
  --summary                List method, path, operationId, and summary. Default.
  --path TEXT              List operations whose path, operationId, or summary contains TEXT.
  --operation OPERATION_ID Print one operation with path/method/schema details.
  --raw                    Print the full OpenAPI JSON.
  --no-refresh             Use the existing cache without fetching.
  --help                   Show this help.

Environment:
  NUPHOS_BACKEND_URL       Defaults to https://api.nuphos.ai
  NUPHOS_TOKEN             Sent as bearer auth when set.
  NUPHOS_OPENAPI_CACHE     Defaults to /tmp/nuphos-openapi.json
EOF
}

mode="summary"
filter=""
operation_id=""
refresh=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --summary)
      mode="summary"
      shift
      ;;
    --path)
      mode="path"
      filter="${2:-}"
      if [ -z "$filter" ]; then
        echo "--path requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --operation)
      mode="operation"
      operation_id="${2:-}"
      if [ -z "$operation_id" ]; then
        echo "--operation requires a value" >&2
        exit 2
      fi
      shift 2
      ;;
    --raw)
      mode="raw"
      shift
      ;;
    --no-refresh)
      refresh=0
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

base_url="${NUPHOS_BACKEND_URL:-https://api.nuphos.ai}"
base_url="${base_url%/}"
cache_path="${NUPHOS_OPENAPI_CACHE:-/tmp/nuphos-openapi.json}"

curl_args=(-fsS)
if [ -n "${NUPHOS_TOKEN:-}" ]; then
  curl_args+=(-H "Authorization: Bearer ${NUPHOS_TOKEN}")
fi

if [ "$refresh" -eq 1 ]; then
  tmp_path="${cache_path}.$$"
  if curl "${curl_args[@]}" "${base_url}/openapi.json" -o "${tmp_path}"; then
    mv "${tmp_path}" "${cache_path}"
  else
    rm -f "${tmp_path}"
    if [ -s "${cache_path}" ]; then
      echo "Warning: failed to refresh ${base_url}/openapi.json; using cached ${cache_path}" >&2
    else
      echo "Error: failed to fetch ${base_url}/openapi.json and no cache exists at ${cache_path}" >&2
      exit 1
    fi
  fi
elif [ ! -s "${cache_path}" ]; then
  echo "Error: --no-refresh requested but no cache exists at ${cache_path}" >&2
  exit 1
fi

if [ "$mode" = "raw" ]; then
  cat "${cache_path}"
  printf '\n'
  exit 0
fi

python3 - "${cache_path}" "${mode}" "${filter}" "${operation_id}" <<'PY'
import json
import sys

path, mode, filter_text, operation_id = sys.argv[1:5]
with open(path, "r", encoding="utf-8") as f:
    doc = json.load(f)

operations = []
for api_path, methods in sorted(doc.get("paths", {}).items()):
    if not isinstance(methods, dict):
        continue
    for method, operation in sorted(methods.items()):
        if not isinstance(operation, dict):
            continue
        op_id = operation.get("operationId", "")
        summary = operation.get("summary", "")
        operations.append({
            "method": method.upper(),
            "path": api_path,
            "operationId": op_id,
            "summary": summary,
            "operation": operation,
        })

def print_summary(items):
    print(f"OpenAPI: {doc.get('info', {}).get('title', 'Nuphos API')} {doc.get('info', {}).get('version', '')}".rstrip())
    print(f"Cached: {path}")
    print("")
    for item in items:
        op_id = item["operationId"] or "-"
        summary = f" - {item['summary']}" if item["summary"] else ""
        print(f"{item['method']:6} {item['path']}  ({op_id}){summary}")

if mode == "operation":
    for item in operations:
        if item["operationId"] == operation_id:
            payload = {
                "method": item["method"],
                "path": item["path"],
                "operationId": item["operationId"],
                **item["operation"],
            }
            print(json.dumps(payload, indent=2, ensure_ascii=False))
            break
    else:
        print(f"Operation not found: {operation_id}", file=sys.stderr)
        sys.exit(1)
elif mode == "path":
    needle = filter_text.lower()
    matches = [
        item for item in operations
        if needle in item["path"].lower()
        or needle in item["operationId"].lower()
        or needle in item["summary"].lower()
    ]
    print_summary(matches)
    if not matches:
        sys.exit(1)
else:
    print_summary(operations)
PY
