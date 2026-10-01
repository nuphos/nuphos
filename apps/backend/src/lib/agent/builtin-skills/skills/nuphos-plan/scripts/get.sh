#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: get.sh PLAN_ID}
exec bash "$script_dir/_request.sh" GET "/$plan_id"
