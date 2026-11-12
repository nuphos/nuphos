"""Bounded Firebase Management reads using the selected Nuphos GCP binding."""
import argparse
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def get_json(url, token):
    request = Request(url, headers={"Authorization": "Bearer " + token})
    with build_opener(NoRedirect).open(request, timeout=30) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("team_id")
    parser.add_argument("project_id")
    parser.add_argument("service_account_id")
    parser.add_argument("operation", choices=("project", "apps"))
    parser.add_argument("--page-token")
    args = parser.parse_args()
    token = os.environ.get("NUPHOS_TOKEN", "")
    credential_dir = os.environ.get("OPENAB_CREDENTIALS_DIR")
    if credential_dir:
        token = (Path(credential_dir) / "NUPHOS_TOKEN").read_text().strip()
    if not token:
        raise ValueError("Nuphos session credential is unavailable")
    base = os.environ.get("NUPHOS_BACKEND_URL", "https://api.nuphos.ai").rstrip("/")
    parts = urlsplit(base)
    if parts.scheme not in ("http", "https") or parts.username or parts.password:
        raise ValueError("Invalid Nuphos backend URL")
    path = "/teams/{}/gcp-projects/{}/credentials".format(
        quote(args.team_id, safe=""), quote(args.project_id, safe=""))
    credentials = get_json(base + path + "?" + urlencode({
        "serviceAccountId": args.service_account_id}), token)
    if credentials["projectId"] != args.project_id:
        raise ValueError("Credential project mismatch")
    path = "https://firebase.googleapis.com/v1beta1/projects/" + quote(args.project_id, safe="")
    if args.operation == "apps":
        query = {"pageSize": "100"}
        if args.page_token:
            query["pageToken"] = args.page_token
        path += ":searchApps?" + urlencode(query)
    data = get_json(path, credentials["accessToken"])
    if args.operation == "project":
        result = {key: data[key] for key in (
            "projectId", "projectNumber", "displayName", "state") if key in data}
    else:
        result = {"apps": [{key: app[key] for key in (
            "appId", "displayName", "platform") if key in app}
            for app in data.get("apps", [])]}
        if data.get("nextPageToken"):
            result["nextPageToken"] = data["nextPageToken"]
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except HTTPError as error:
        print("Request failed (HTTP {}). Stop; check selection, Firebase enablement, API status and IAM. No credentials or upstream body printed.".format(error.code), file=sys.stderr)
        sys.exit(1)
    except (ValueError, KeyError, OSError, URLError):
        print("Firebase inspection failed; check setup and connectivity. No credentials printed.", file=sys.stderr)
        sys.exit(1)
