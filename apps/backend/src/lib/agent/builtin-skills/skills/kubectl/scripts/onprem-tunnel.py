#!/usr/bin/env python3
"""Local port-forward to any TCP address inside an on-prem cluster's network.

kubectl reaches those clusters through the relay because a kubeconfig can carry
a `proxy-url`. Tools like psql, redis-cli and mongosh cannot: they have no proxy
support at all. This bridges that gap — it listens on 127.0.0.1 and tunnels each
connection through the same relay proxy, so those tools connect to localhost and
need to know nothing.

    onprem-tunnel.py open onprem/acme-dc1/cluster 10.0.0.5:5432
    onprem-tunnel.py list
    onprem-tunnel.py close 15432 | all

The credential comes from the kubeconfig entry for the named context, so there is
nothing extra to configure and the tunnel is scoped to this session exactly like
kubectl is.
"""

import base64
import json
import os
import socket
import ssl
import subprocess
import sys
import threading
import urllib.parse

STATE_DIR = os.path.expanduser("~/.nuphos/tunnels")
BUFFER_BYTES = 64 * 1024
CONNECT_TIMEOUT_SEC = 15


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def proxy_for_context(context):
    """Read the context's proxy-url out of the kubeconfig.

    Shells out to kubectl rather than parsing the YAML: the sandbox has no YAML
    module, and kubectl is the thing that owns the format anyway.
    """
    query = '{.clusters[?(@.name=="%s")].cluster.proxy-url}' % context
    try:
        result = subprocess.run(
            ["kubectl", "config", "view", "--raw", "-o", f"jsonpath={query}"],
            capture_output=True, text=True, timeout=30,
        )
    except FileNotFoundError:
        fail("kubectl is not on PATH")
    except subprocess.TimeoutExpired:
        fail("kubectl config view timed out")
    if result.returncode != 0:
        fail(f"kubectl config view failed: {result.stderr.strip()}")

    raw = result.stdout.strip()
    if not raw:
        fail(
            f"context {context!r} has no proxy-url, so it is not a relayed on-prem "
            "cluster. Run `kubectl config get-contexts` — only onprem/… contexts "
            "are reached this way; anything else is reachable directly."
        )
    parsed = urllib.parse.urlparse(raw)
    if not parsed.hostname or not parsed.port:
        fail(f"proxy-url {raw!r} is not host:port")
    return {
        "tls": parsed.scheme == "https",
        "host": parsed.hostname,
        "port": parsed.port,
        "credential": base64.b64encode(
            f"{urllib.parse.unquote(parsed.username or '')}:"
            f"{urllib.parse.unquote(parsed.password or '')}".encode()
        ).decode(),
    }


def open_tunnelled_socket(proxy, target):
    """One CONNECT through the relay, returning a socket wired to `target`."""
    sock = socket.create_connection((proxy["host"], proxy["port"]), CONNECT_TIMEOUT_SEC)
    try:
        if proxy["tls"]:
            sock = ssl.create_default_context().wrap_socket(
                sock, server_hostname=proxy["host"]
            )
        request = (
            f"CONNECT {target} HTTP/1.1\r\n"
            f"Host: {target}\r\n"
            f"Proxy-Authorization: Basic {proxy['credential']}\r\n"
            f"\r\n"
        )
        sock.sendall(request.encode())
        status, _ = read_proxy_response(sock)
        if status != 200:
            raise ConnectionError(describe_status(status))
        return sock
    except Exception:
        sock.close()
        raise


def read_proxy_response(sock):
    """Read the response head only — anything after it belongs to the stream."""
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = sock.recv(1)
        if not chunk:
            raise ConnectionError("the relay closed the connection during CONNECT")
        head += chunk
        if len(head) > 8192:
            raise ConnectionError("the relay sent an oversized CONNECT response")
    first = head.split(b"\r\n", 1)[0].decode("latin-1").split()
    if len(first) < 2 or not first[1].isdigit():
        raise ConnectionError(f"malformed CONNECT response: {first!r}")
    return int(first[1]), head


def describe_status(status):
    if status == 503:
        return (
            "the cluster's relay agent is not connected — the pod in the customer's "
            "cluster is down, scaled to zero, or blocked by their egress rules. The "
            "relay already waited out a reconnect window before saying this, so it is "
            "not a blip: say so rather than retrying."
        )
    if status == 502:
        return "the relay agent could not reach that address inside the cluster"
    if status == 407:
        return "the relay rejected this session's credential (it may have expired — re-sync the kubeconfig)"
    return f"the relay refused the tunnel (HTTP {status})"


def pump(source, sink):
    try:
        while True:
            chunk = source.recv(BUFFER_BYTES)
            if not chunk:
                break
            sink.sendall(chunk)
    except OSError:
        pass
    finally:
        # Half-close so a protocol that ends by shutting one direction down does
        # not leave the other side waiting.
        try:
            sink.shutdown(socket.SHUT_WR)
        except OSError:
            pass


def serve(listener, proxy, target):
    while True:
        try:
            client, _ = listener.accept()
        except OSError:
            return
        try:
            upstream = open_tunnelled_socket(proxy, target)
        except Exception as err:
            print(f"tunnel to {target} failed: {err}", file=sys.stderr, flush=True)
            client.close()
            continue
        for source, sink in ((client, upstream), (upstream, client)):
            threading.Thread(target=pump, args=(source, sink), daemon=True).start()


def state_path(port):
    return os.path.join(STATE_DIR, f"{port}.json")


def cmd_open(argv):
    if len(argv) < 2:
        fail("usage: onprem-tunnel.py open <context> <host:port> [local-port]")
    context, target = argv[0], argv[1]
    if ":" not in target:
        fail(f"target {target!r} must be host:port")
    requested_port = int(argv[2]) if len(argv) > 2 else 0

    proxy = proxy_for_context(context)
    # Prove the path works before backgrounding: a tunnel that only fails on
    # first use surfaces as a mysterious timeout inside psql instead of an error
    # here, where the reason can be reported.
    try:
        open_tunnelled_socket(proxy, target).close()
    except Exception as err:
        fail(str(err))

    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        # Loopback only. This is a hole into someone's private network; nothing
        # outside this sandbox should be able to reach it.
        listener.bind(("127.0.0.1", requested_port))
    except OSError as err:
        fail(f"cannot listen on 127.0.0.1:{requested_port}: {err}")
    listener.listen(128)
    local_port = listener.getsockname()[1]

    os.makedirs(STATE_DIR, exist_ok=True)
    if os.fork() != 0:
        # Parent: the agent gets the address to use and its prompt back.
        print(f"127.0.0.1:{local_port} -> {target} via {context}")
        print(f"per-connection errors: {os.path.join(STATE_DIR, f'{local_port}.log')}")
        return
    os.setsid()
    log_file = os.path.join(STATE_DIR, f"{local_port}.log")
    with open(state_path(local_port), "w") as handle:
        json.dump(
            {
                "pid": os.getpid(),
                "localPort": local_port,
                "target": target,
                "context": context,
                "log": log_file,
            },
            handle,
        )
    # Detach every stream. The parent has already returned to the shell, so a
    # later per-connection error written to the inherited stdout would land on a
    # closed pipe and kill the forwarder; the log is where to look instead.
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    log_fd = os.open(log_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    serve(listener, proxy, target)


def cmd_list(_argv):
    if not os.path.isdir(STATE_DIR):
        return
    for name in sorted(os.listdir(STATE_DIR)):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(STATE_DIR, name)) as handle:
                entry = json.load(handle)
        except (OSError, ValueError):
            continue
        alive = process_alive(entry.get("pid"))
        if not alive:
            os.unlink(os.path.join(STATE_DIR, name))
            continue
        print(f"127.0.0.1:{entry['localPort']} -> {entry['target']} via {entry['context']}")


def process_alive(pid):
    if not pid:
        return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def cmd_close(argv):
    if not argv:
        fail("usage: onprem-tunnel.py close <local-port|all>")
    if not os.path.isdir(STATE_DIR):
        return
    wanted = argv[0]
    for name in sorted(os.listdir(STATE_DIR)):
        if not name.endswith(".json"):
            continue
        port = name[: -len(".json")]
        if wanted not in ("all", port):
            continue
        path = os.path.join(STATE_DIR, name)
        try:
            with open(path) as handle:
                entry = json.load(handle)
            os.kill(entry["pid"], 15)
        except (OSError, ValueError, KeyError):
            pass
        try:
            os.unlink(path)
        except OSError:
            pass
        print(f"closed 127.0.0.1:{port}")


COMMANDS = {"open": cmd_open, "list": cmd_list, "close": cmd_close}


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        fail("usage: onprem-tunnel.py <open|list|close> [...]")
    COMMANDS[sys.argv[1]](sys.argv[2:])


if __name__ == "__main__":
    main()
