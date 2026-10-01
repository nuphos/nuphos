#!/usr/bin/env python3
"""Call a Huawei Cloud API with SDK-HMAC-SHA256 signing.

There is no Huawei CLI in the sandbox, so this signs and sends the request
directly, exactly as Huawei's official SDKs do (huaweicloudsdkcore
signer.Signer in huaweicloud-sdk-python-v3, core/auth/signer in
huaweicloud-sdk-go-v3). Temporary credentials use the same signature; they
only add the signed X-Security-Token header.

Credentials come from the environment `setup-credentials.sh` writes
(HUAWEICLOUD_SDK_AK / _SK / _SECURITY_TOKEN), so:

    source ~/.huawei/credentials.env
    python3 skills/huawei/scripts/hw-api.py GET \\
      "https://iam.$HUAWEICLOUD_SDK_REGION.myhuaweicloud.com/v3/projects?name=$HUAWEICLOUD_SDK_REGION"
    python3 skills/huawei/scripts/hw-api.py POST https://... --body '{"k":"v"}'

Prints the response body; exits non-zero (with the body on stderr) on HTTP >=400.
"""

import argparse
import hashlib
import hmac
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

ALGORITHM = "SDK-HMAC-SHA256"
DATE_FORMAT = "%Y%m%dT%H%M%SZ"
# Every signed request carries usable temporary credentials, so it may only ever
# leave for Huawei Cloud itself — never a host an argument or a redirect picked.
API_SUFFIXES = (".myhuaweicloud.com", ".myhuaweicloud.eu")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    """Refuse redirects: the signed credentials must not follow one."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def check_destination(url):
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    if parts.scheme != "https":
        sys.exit(f"refusing to sign a non-HTTPS request: {url}")
    if parts.username or parts.password:
        sys.exit("refusing to sign a URL carrying userinfo")
    if parts.port not in (None, 443):
        sys.exit(f"refusing to sign a request to port {parts.port}")
    if not host.endswith(API_SUFFIXES):
        sys.exit(f"{host} is not a Huawei Cloud API host — refusing to sign for it")


def encode(value):
    return urllib.parse.quote(value, safe="~")


def canonical_uri(path):
    uri = "/".join(encode(segment) for segment in urllib.parse.unquote(path or "/").split("/"))
    return uri if uri.endswith("/") else uri + "/"


def canonical_query(query):
    pairs = sorted(urllib.parse.parse_qsl(query, keep_blank_values=True))
    return "&".join(f"{encode(k)}={encode(v)}" for k, v in pairs)


def signed_header_names(headers):
    return sorted(name.lower() for name in headers if "_" not in name)


def canonical_request(method, url, headers, payload):
    parts = urllib.parse.urlsplit(url)
    values = {name.lower(): str(value).strip() for name, value in headers.items()}
    names = signed_header_names(headers)
    canonical_headers = "".join(f"{name}:{values[name]}\n" for name in names)
    body_hash = values.get("x-sdk-content-sha256") or hashlib.sha256(payload).hexdigest()

    return "\n".join(
        [
            method.upper(),
            canonical_uri(parts.path),
            canonical_query(parts.query),
            canonical_headers,
            ";".join(names),
            body_hash,
        ]
    )


def authorization(method, url, headers, payload, ak, sk):
    """The Authorization value for a request whose headers already hold X-Sdk-Date."""
    stamp = next(v for k, v in headers.items() if k.lower() == "x-sdk-date")
    creq = canonical_request(method, url, headers, payload)
    to_sign = f"{ALGORITHM}\n{stamp}\n{hashlib.sha256(creq.encode()).hexdigest()}"
    signature = hmac.new(sk.encode(), to_sign.encode(), hashlib.sha256).hexdigest()

    return (
        f"{ALGORITHM} Access={ak}, SignedHeaders={';'.join(signed_header_names(headers))}, "
        f"Signature={signature}"
    )


def sign(method, url, body, ak, sk, token, content_type, now=None):
    payload = body.encode() if body else b""
    stamp = (now or datetime.now(timezone.utc)).strftime(DATE_FORMAT)
    headers = {"Host": urllib.parse.urlsplit(url).netloc, "X-Sdk-Date": stamp}
    if body:
        headers["Content-Type"] = content_type
        if not content_type.startswith(("application/json", "application/bson")):
            headers["X-Sdk-Content-Sha256"] = "UNSIGNED-PAYLOAD"
    if token:
        headers["X-Security-Token"] = token

    headers["Authorization"] = authorization(method, url, headers, payload, ak, sk)

    return headers, payload


def main():
    parser = argparse.ArgumentParser(description="Signed Huawei Cloud API request")
    parser.add_argument("method")
    parser.add_argument("url")
    parser.add_argument("--body", default="")
    parser.add_argument("--content-type", default="application/json")
    args = parser.parse_args()

    check_destination(args.url)

    ak = os.environ.get("HUAWEICLOUD_SDK_AK")
    sk = os.environ.get("HUAWEICLOUD_SDK_SK")
    if not ak or not sk:
        sys.exit("HUAWEICLOUD_SDK_AK / HUAWEICLOUD_SDK_SK are not set — source ~/.huawei/credentials.env")

    headers, payload = sign(
        args.method.upper(),
        args.url,
        args.body,
        ak,
        sk,
        os.environ.get("HUAWEICLOUD_SDK_SECURITY_TOKEN", ""),
        args.content_type,
    )
    request = urllib.request.Request(
        args.url, data=payload or None, headers=headers, method=args.method.upper()
    )

    try:
        with urllib.request.build_opener(NoRedirects).open(request, timeout=30) as response:
            print(response.read().decode())
    except urllib.error.HTTPError as e:
        print(e.read().decode(), file=sys.stderr)
        sys.exit(f"HTTP {e.code} from {args.url}")


if __name__ == "__main__":
    main()
