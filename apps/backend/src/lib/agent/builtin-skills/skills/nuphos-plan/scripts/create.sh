#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
title=${1:?usage: create.sh TITLE [OVERVIEW]}
overview=${2-}
payload=$(jq -cn --arg title "$title" --arg overview "$overview" \
  '{title:$title} + (if $overview == "" then {} else {overview:$overview} end)')
exec bash "$script_dir/_request.sh" POST '' "$payload"
