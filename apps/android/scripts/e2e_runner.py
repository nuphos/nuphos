"""Opt-in live tests. Credentials reach the debug app through stdin only."""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path

PACKAGE = "ai.nuphos.android"
TEST_CLASS = "ai.nuphos.android.LiveReadOnlyDeviceTest"


class SetupError(Exception):
    pass


@dataclass
class Config:
    serial: str
    email: str
    team: str
    mode: str
    allow_login: bool
    password: str | None = field(default=None, repr=False)

    def payload(self):
        return json.dumps({"expectedEmail": self.email, "teamId": self.team,
                           "mode": self.mode, "allowLogin": self.allow_login,
                           "password": self.password}).encode()


def read_config(values):
    def required(key):
        value = values.get(key, "").strip()
        if not value:
            raise SetupError(f"Set {key}.")
        return value
    serial = required("NUPHOS_E2E_DEVICE_SERIAL")
    email = required("NUPHOS_E2E_EXPECTED_EMAIL")
    team = required("NUPHOS_E2E_TEAM_ID")
    mode = required("NUPHOS_E2E_LOGIN_MODE")
    password = values.get("NUPHOS_E2E_PASSWORD") or None
    allow = values.get("NUPHOS_E2E_ALLOW_LOGIN", "false")
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+", serial):
        raise SetupError("Invalid device serial.")
    if "@" not in email or not re.fullmatch(r"[A-Za-z0-9_-]+", team):
        raise SetupError("Invalid expected account or team.")
    if mode not in ("existing-session", "password") or allow not in ("true", "false"):
        raise SetupError("Invalid login mode or allow-login flag.")
    if mode == "password" and (allow != "true" or not password or not 12 <= len(password) <= 128):
        raise SetupError("Password mode needs a dedicated device, allow-login=true and a valid password.")
    if mode == "existing-session" and (password is not None or allow != "false"):
        raise SetupError("Existing-session mode cannot accept login credentials.")
    return Config(serial, email, team, mode, allow == "true", password)


def load_file(path):
    try:
        text = path.read_text()
        values = {}
        for line in text.splitlines():
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            if not re.fullmatch(r"NUPHOS_E2E_[A-Z_]+", key) or key in values:
                raise ValueError()
            tokens = shlex.split(value, comments=False)
            if len(tokens) > 1:
                raise ValueError()
            values[key] = tokens[0] if tokens else ""
        if values.get("NUPHOS_E2E_PASSWORD") and path.stat().st_mode & 0o077:
            raise SetupError("A config file with a password must have mode 0600.")
        return values
    except SetupError:
        raise
    except (OSError, ValueError):
        raise SetupError("Cannot read a valid local test config.") from None


def command(argv, input=None):
    try:
        result = subprocess.run(argv, input=input, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, timeout=180)
    except (OSError, subprocess.TimeoutExpired):
        raise SetupError("Device command could not complete.") from None
    if result.returncode:
        raise SetupError("Device command failed; check debug app, test APK and device access.")
    return result.stdout.decode(errors="replace")


def run(config, adb):
    prefix = [adb, "-s", config.serial]
    name = "e2e-" + uuid.uuid4().hex + ".json"
    config_path = "files/" + name
    if command(prefix + ["get-state"]).strip() != "device":
        raise SetupError("Selected device is not ready.")
    # run-as admits debuggable apps only. No exported app component is added.
    command(prefix + ["shell", "run-as", PACKAGE, "mkdir", "-p", "files"])
    try:
        command(prefix + ["shell", "run-as", PACKAGE, "sh", "-c",
                          "'umask 077; cat > " + config_path + "'"], input=config.payload())
        result = command(prefix + ["shell", "am", "instrument", "-w", "-r",
                                   "-e", "e2eLive", "true", "-e", "e2eConfig", name,
                                   "-e", "class", TEST_CLASS,
                                   PACKAGE + ".test/androidx.test.runner.AndroidJUnitRunner"])
        if not re.search(r"OK \(1 test\)", result) or any(
                flag in result for flag in ("FAILURES!!!", "INSTRUMENTATION_FAILED", "Process crashed",
                                            "INSTRUMENTATION_STATUS_CODE: -3", "INSTRUMENTATION_STATUS_CODE: -4")):
            raise SetupError("Live test failed; verify account, team, consent and test data.")
    finally:
        try:
            command(prefix + ["shell", "run-as", PACKAGE, "rm", "-f", config_path])
        except SetupError:
            raise SetupError("Temporary config cleanup failed; remove the test config on the selected device.") from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=Path(".env.e2e.local"))
    parser.add_argument("--validate", action="store_true", help="Validate configuration without device access")
    args = parser.parse_args(argv)
    try:
        values = load_file(args.config)
        values.update({k: v for k, v in os.environ.items() if k.startswith("NUPHOS_E2E_")})
        config = read_config(values)
        if args.validate:
            print("Configuration valid. No device access or login performed.")
            return 0
        sdk = os.environ.get("ANDROID_HOME")
        if not sdk:
            raise SetupError("Set ANDROID_HOME.")
        run(config, str(Path(sdk) / "platform-tools/adb"))
        print("PASS: live read-only test. Temporary configuration removed.")
        return 0
    except SetupError as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
