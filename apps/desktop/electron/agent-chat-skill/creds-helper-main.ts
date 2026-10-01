export const SHORT_LIVED_CREDS_HELPER_MAIN = `case "$kind" in
  list)
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    case "$list_target" in
      teams)
        fetch "\${base}/teams" 'application/json' "$tmp"
        ;;
      aws-accounts)
        if [ -z "$team_id" ]; then echo "--team-id is required for list aws-accounts" >&2; usage; fi
        fetch "\${base}/teams/$(urlencode "$team_id")/aws-accounts" 'application/json' "$tmp"
        ;;
      gcp-projects)
        if [ -z "$team_id" ]; then echo "--team-id is required for list gcp-projects" >&2; usage; fi
        fetch "\${base}/teams/$(urlencode "$team_id")/gcp-projects" 'application/json' "$tmp"
        ;;
      aws-clusters)
        if [ -z "$team_id" ]; then echo "--team-id is required for list aws-clusters" >&2; usage; fi
        if [ -z "$account_id" ]; then echo "--account-id is required for list aws-clusters" >&2; usage; fi
        path="/teams/$(urlencode "$team_id")/aws-accounts/$(urlencode "$account_id")/clusters"
        if [ -n "$role_id" ]; then path="\${path}?roleId=$(urlencode "$role_id")"; fi
        fetch "\${base}\${path}" 'application/json' "$tmp"
        ;;
      gcp-clusters)
        if [ -z "$team_id" ]; then echo "--team-id is required for list gcp-clusters" >&2; usage; fi
        if [ -z "$project_id" ]; then echo "--project-id is required for list gcp-clusters" >&2; usage; fi
        path="/teams/$(urlencode "$team_id")/gcp-projects/$(urlencode "$project_id")/clusters"
        if [ -n "$service_account_id" ]; then path="\${path}?serviceAccountId=$(urlencode "$service_account_id")"; fi
        fetch "\${base}\${path}" 'application/json' "$tmp"
        ;;
      *)
        echo "unknown list target: $list_target" >&2
        usage ;;
    esac
    print_json "$tmp"
    ;;
  aws)
    if [ -z "$team_id" ]; then echo "--team-id is required for aws" >&2; usage; fi
    if [ -z "$account_id" ]; then echo "--account-id is required for aws" >&2; usage; fi
    region="\${region:-us-east-1}"
    path="$(agent_or_team_path "/teams/$(urlencode "$team_id")/aws-accounts/$(urlencode "$account_id")/credentials")"
    if [ -n "$role_id" ]; then path="\${path}?roleId=$(urlencode "$role_id")"; fi
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    fetch "\${base}\${path}" 'application/json' "$tmp"
    parsed="$(python3 -c '
import json, sys, shlex
d = json.load(open(sys.argv[1]))
for k in ("accessKeyId", "secretAccessKey", "sessionToken", "expiresAt"):
    print(f"{k}={shlex.quote(d[k])}")
' "$tmp")"
    eval "$parsed"
    if [ "$format" = "env" ]; then
      printf 'export AWS_ACCESS_KEY_ID=%s\\n' "$(printf '%s' "$accessKeyId" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      printf 'export AWS_SECRET_ACCESS_KEY=%s\\n' "$(printf '%s' "$secretAccessKey" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      printf 'export AWS_SESSION_TOKEN=%s\\n' "$(printf '%s' "$sessionToken" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      printf 'export AWS_DEFAULT_REGION=%s\\n' "$(printf '%s' "$region" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      echo "# expires at: \${expiresAt}"
    else
      mkdir -p "$HOME/.aws"
      chmod 700 "$HOME/.aws"
      umask 077
      cat > "$HOME/.aws/credentials" <<EOF
[default]
aws_access_key_id = \${accessKeyId}
aws_secret_access_key = \${secretAccessKey}
aws_session_token = \${sessionToken}
EOF
      cat > "$HOME/.aws/config" <<EOF
[default]
region = \${region}
output = json
EOF
      echo "Wrote AWS credentials to ~/.aws/credentials"
      echo "  region:     \${region}"
      echo "  expires at: \${expiresAt}"
    fi
    ;;
  gcp)
    if [ -z "$team_id" ]; then echo "--team-id is required for gcp" >&2; usage; fi
    if [ -z "$project_id" ]; then echo "--project-id is required for gcp" >&2; usage; fi
    path="$(agent_or_team_path "/teams/$(urlencode "$team_id")/gcp-projects/$(urlencode "$project_id")/credentials")"
    if [ -n "$service_account_id" ]; then path="\${path}?serviceAccountId=$(urlencode "$service_account_id")"; fi
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    fetch "\${base}\${path}" 'application/json' "$tmp"
    parsed="$(python3 -c '
import json, sys, shlex
d = json.load(open(sys.argv[1]))
for k in ("accessToken", "projectId", "serviceAccountEmail", "expiresAt"):
    print(f"{k}={shlex.quote(d[k])}")
' "$tmp")"
    eval "$parsed"
    if [ "$format" = "env" ]; then
      printf 'export CLOUDSDK_AUTH_ACCESS_TOKEN=%s\\n' "$(printf '%s' "$accessToken" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      printf 'export GOOGLE_OAUTH_ACCESS_TOKEN=%s\\n' "$(printf '%s' "$accessToken" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      printf 'export CLOUDSDK_CORE_PROJECT=%s\\n' "$(printf '%s' "$projectId" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
      echo "# service account: \${serviceAccountEmail}"
      echo "# expires at: \${expiresAt}"
    else
      token_dir="$HOME/.config/gcloud"
      config_dir="$token_dir/configurations"
      mkdir -p "$token_dir" "$config_dir"
      chmod 700 "$token_dir"
      safe_config_name="$(printf '%s' "\${service_account_id:-\${projectId}-\${serviceAccountEmail}}" | tr -c 'A-Za-z0-9_.-' '-' | cut -c1-80)"
      [ -n "$safe_config_name" ] || safe_config_name="default"
      config_name="nuphos-\${safe_config_name}"
      token_path="$token_dir/nuphos-access-token-\${safe_config_name}"
      config_path="$config_dir/config_\${config_name}"
      umask 077
      printf '%s' "$accessToken" > "$token_path"
      printf '%s\\n' "$config_name" > "$token_dir/active_config"
      cat > "$config_path" <<EOF
[auth]
access_token_file = $token_path

[component_manager]
disable_update_check = true

[core]
account = $serviceAccountEmail
disable_prompts = true
disable_usage_reporting = true
project = $projectId
EOF
      echo "Configured gcloud with Nuphos-managed token"
      echo "  project:         \${projectId}"
      echo "  service account: \${serviceAccountEmail}"
      echo "  expires at:      \${expiresAt}"
    fi
    ;;
  k8s|kubernetes)
    if [ -z "$team_id" ]; then echo "--team-id is required for k8s" >&2; usage; fi
    if [ -z "$provider" ]; then echo "--provider is required for k8s" >&2; usage; fi
    if [ -z "$cluster" ]; then echo "--cluster is required for k8s" >&2; usage; fi
    case "$provider" in
      aws)
        if [ -z "$account_id" ]; then echo "--account-id is required for aws k8s" >&2; usage; fi
        path="$(agent_or_team_path "/teams/$(urlencode "$team_id")/aws-accounts/$(urlencode "$account_id")/clusters/$(urlencode "$cluster")/kubeconfig")"
        if [ -n "$region" ]; then path="\${path}?region=$(urlencode "$region")"; fi
        ;;
      gcp)
        if [ -z "$project_id" ]; then echo "--project-id is required for gcp k8s" >&2; usage; fi
        path="$(agent_or_team_path "/teams/$(urlencode "$team_id")/gcp-projects/$(urlencode "$project_id")/clusters/$(urlencode "$cluster")/kubeconfig")"
        loc="\${location:-$region}"
        if [ -n "$loc" ]; then path="\${path}?location=$(urlencode "$loc")"; fi
        ;;
      *)
        echo "--provider must be aws or gcp for k8s" >&2
        usage ;;
    esac
    output_path="\${output_path:-$HOME/.kube/config}"
    mkdir -p "$(dirname "$output_path")"
    tmp="$(mktemp)"
    trap 'rm -f "$tmp"' EXIT
    fetch "\${base}\${path}" 'application/yaml' "$tmp"
    mv "$tmp" "$output_path"
    chmod 600 "$output_path"
    echo "Wrote kubeconfig to \${output_path}"
    echo "export KUBECONFIG=$(printf '%s' "$output_path" | python3 -c 'import sys, shlex; print(shlex.quote(sys.stdin.read()))')"
    ;;
  *)
    echo "unknown mode: $kind" >&2
    usage ;;
esac
`
