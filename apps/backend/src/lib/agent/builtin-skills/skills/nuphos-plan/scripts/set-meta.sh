#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
plan_id=${1:?usage: set-meta.sh PLAN_ID TITLE OVERVIEW}
title=${2:?usage: set-meta.sh PLAN_ID TITLE OVERVIEW}
overview=${3-}
payload=$(jq -cn --arg title "$title" --arg overview "$overview" \
  '{title:$title,overview:$overview}')
exec bash "$script_dir/_request.sh" PATCH "/$plan_id" "$payload"
