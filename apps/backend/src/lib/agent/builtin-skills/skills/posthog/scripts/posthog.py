#!/usr/bin/env python3
"""PostHog API helper for the Nuphos posthog skill.

  posthog.py scopes
  posthog.py query "SELECT event, count() FROM events GROUP BY event LIMIT 10" [--project ID] [--format table|json|csv]
  posthog.py get insights/?limit=20 [--project ID]
  posthog.py write PATCH feature_flags/12/ --data '{"active": false}' [--project ID] [--confirm]

Reads POSTHOG_HOST, POSTHOG_ACCESS_TOKEN, POSTHOG_SCOPES and POSTHOG_PROJECT_ID
from the env file written by setup-credentials.sh. A relative path is resolved
under /api/projects/<project>/. `write` only prints what it would do until it
is re-run with --confirm.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

TIMEOUT_SECONDS = 60
MAX_CELL = 80

HINTS = {
    401: "The access token expired or was revoked. Re-run setup-credentials.sh (the backend refreshes it); if that fails, a team admin must reconnect PostHog.",
    403: "The grant lacks a scope for this call (or access to this project). Report which scope is missing; do not retry.",
    404: "Not found: check the project id (POSTHOG_PROJECT_IDS lists the allowed ones) and the path.",
    429: "Rate limited by PostHog. Wait before retrying and batch work into fewer, larger HogQL queries.",
}


def fail(message: str, code: int = 1) -> None:
    print(f"posthog: {message}", file=sys.stderr)
    sys.exit(code)


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        fail(f"{name} is not set; run setup-credentials.sh and `source ~/.posthog/nuphos.env` first.", 2)
    return value


def resolve_project(requested: str | None) -> str:
    project = (os.environ.get("POSTHOG_PROJECT_ID", "") if requested is None else requested).strip()
    if not project:
        fail("no project id; pass --project or set POSTHOG_PROJECT_ID.", 2)
    allowed = [p for p in os.environ.get("POSTHOG_PROJECT_IDS", "").split(",") if p]
    if allowed and project not in allowed:
        fail(f"project {project} is not enabled for this integration (allowed: {', '.join(allowed)}).", 2)
    return project


def error_detail(body: str) -> str:
    try:
        parsed = json.loads(body)
    except ValueError:
        return body
    if isinstance(parsed, dict):
        return str(parsed.get("detail") or parsed.get("error") or body)
    return body


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        fail(f"PostHog answered {code} redirecting to {newurl}; not following it with the access token.")


OPENER = urllib.request.build_opener(NoRedirect)
CLOUD_HOSTS = {"https://us.posthog.com", "https://eu.posthog.com"}


def request(method: str, path: str, body: dict | None = None) -> object:
    host = env("POSTHOG_HOST").rstrip("/")
    if host not in CLOUD_HOSTS:
        fail(f"POSTHOG_HOST must be one of {', '.join(sorted(CLOUD_HOSTS))}; re-run setup-credentials.sh.", 2)
    url = host + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {env('POSTHOG_ACCESS_TOKEN')}")
    req.add_header("Accept", "application/json")
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with OPENER.open(req, timeout=TIMEOUT_SECONDS) as res:
            raw = res.read()
    except urllib.error.HTTPError as err:
        detail = error_detail(err.read().decode(errors="replace"))
        hint = HINTS.get(err.code, "")
        if err.code == 429 and err.headers.get("Retry-After"):
            hint += f" Retry-After: {err.headers['Retry-After']}s."
        fail(f"HTTP {err.code} from {method} {path}: {str(detail)[:500]}\n{hint}".rstrip())
    except urllib.error.URLError as err:
        fail(f"could not reach {url}: {err.reason}")
    except TimeoutError:
        fail(f"{method} {path} timed out after {TIMEOUT_SECONDS}s; narrow the time range or add a LIMIT.")
    return json.loads(raw) if raw else None


def cell(value: object) -> str:
    text = value if isinstance(value, str) else json.dumps(value, default=str)
    return text if len(text) <= MAX_CELL else text[: MAX_CELL - 1] + "…"


def print_rows(columns: list[str], rows: list[list[object]], fmt: str) -> None:
    if fmt == "csv":
        writer = csv.writer(sys.stdout)
        writer.writerow(columns)
        writer.writerows(rows)
        return
    table = [columns] + [[cell(v) for v in row] for row in rows]
    widths = [max(len(str(r[i])) for r in table) for i in range(len(columns))]
    for index, row in enumerate(table):
        print("  ".join(str(v).ljust(widths[i]) for i, v in enumerate(row)).rstrip())
        if index == 0:
            print("  ".join("-" * w for w in widths))


def run_query(args: argparse.Namespace) -> None:
    require_scope("query:read")
    project = resolve_project(args.project)
    result = request(
        "POST",
        f"/api/projects/{project}/query/",
        {"query": {"kind": "HogQLQuery", "query": args.hogql}, "name": "nuphos agent query"},
    )
    if not isinstance(result, dict):
        fail("unexpected query response")
    if result.get("error"):
        fail(f"query error: {result['error']}")
    if args.format == "json":
        json.dump(result, sys.stdout, indent=2, default=str)
        print()
        return
    columns = [str(c) for c in result.get("columns") or []]
    rows = result.get("results") or []
    print_rows(columns, rows, args.format)
    if args.format == "table":
        more = " (more rows exist; page with a timestamp keyset filter, OFFSET is rejected for API requests)" if result.get("hasMore") else ""
        print(f"\n{len(rows)} row(s){more}", file=sys.stderr)


# API collection segment -> the scope object that guards it.
RESOURCES = {
    "insights": "insight",
    "dashboards": "dashboard",
    "feature_flags": "feature_flag",
    "experiments": "experiment",
    "surveys": "survey",
    "cohorts": "cohort",
    "persons": "person",
    "session_recordings": "session_recording",
    "actions": "action",
    "event_definitions": "event_definition",
    "property_definitions": "property_definition",
    "annotations": "annotation",
    "notebooks": "notebook",
    "error_tracking": "error_tracking",
    "query": "query",
}


def granted_scopes() -> set[str]:
    return set(os.environ.get("POSTHOG_SCOPES", "").split())


def require_scope(scope: str) -> None:
    if scope not in granted_scopes():
        fail(
            f"this PostHog grant lacks {scope}. Tell the user; a team admin can add it with "
            "Edit permissions on the PostHog connector page.",
            2,
        )


def resource_of(path: str) -> str | None:
    match = re.match(r"^/api/(?:projects|environments)/[^/]+/([^/?]+)", urllib.parse.urlsplit(path).path)
    return RESOURCES.get(match.group(1)) if match else None


def check_path(path: str) -> None:
    route = urllib.parse.urlsplit(path).path
    if not route.startswith("/api/") or "%" in route or "\\" in route or any(
        part in (".", "..") for part in route.split("/")
    ):
        fail(f"refusing path {path!r}: use a plain /api/... path.", 2)
    scoped = re.match(r"^/api/(?:projects|environments)(?:/([^/]*))?", route)
    if scoped:
        resolve_project(scoped.group(1) or "")


def run_get(args: argparse.Namespace) -> None:
    path = args.path
    if not path.startswith("/"):
        path = f"/api/projects/{resolve_project(args.project)}/{path}"
    check_path(path)
    resource = resource_of(path)
    if resource:
        require_scope(f"{resource}:read")
    json.dump(request("GET", path), sys.stdout, indent=2, default=str)
    print()


def run_scopes(_args: argparse.Namespace) -> None:
    for scope in sorted(granted_scopes()):
        print(scope)


def run_write(args: argparse.Namespace) -> None:
    path = args.path
    if not path.startswith("/"):
        path = f"/api/projects/{resolve_project(args.project)}/{path}"
    check_path(path)
    resource = resource_of(path)
    if not resource or resource == "query":
        fail(f"writes are only supported on a known PostHog resource path, not {path!r}.", 2)
    require_scope(f"{resource}:write")
    body = json.loads(args.data) if args.data else None
    if not args.confirm:
        print(f"DRY RUN - nothing was changed.\nWould {args.method} {env('POSTHOG_HOST')}{path}")
        if body is not None:
            print("with body:\n" + json.dumps(body, indent=2))
        print("This changes data in PostHog. Show this to the user, and re-run with --confirm only after they approve.")
        sys.exit(3)
    result = request(args.method, path, body)
    print(f"DONE - {args.method} {path} succeeded.")
    json.dump(result, sys.stdout, indent=2, default=str)
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="PostHog API helper")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("scopes", help="list the scopes this grant carries").set_defaults(run=run_scopes)
    query = sub.add_parser("query", help="run a HogQL SELECT")
    query.add_argument("hogql")
    query.add_argument("--project")
    query.add_argument("--format", choices=["table", "json", "csv"], default="table")
    query.set_defaults(run=run_query)
    get = sub.add_parser("get", help="GET an API path")
    get.add_argument("path")
    get.add_argument("--project")
    get.set_defaults(run=run_get)
    write = sub.add_parser("write", help="POST/PATCH/DELETE a resource (dry run without --confirm)")
    write.add_argument("method", choices=["POST", "PATCH", "DELETE"])
    write.add_argument("path")
    write.add_argument("--data")
    write.add_argument("--project")
    write.add_argument("--confirm", action="store_true")
    write.set_defaults(run=run_write)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
