import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import e2e_runner as runner


class ConfigTests(unittest.TestCase):
    def config(self, **changes):
        values = {
            "NUPHOS_E2E_DEVICE_SERIAL": "emulator-5556",
            "NUPHOS_E2E_EXPECTED_EMAIL": "tester@example.invalid",
            "NUPHOS_E2E_TEAM_ID": "fixture-team",
            "NUPHOS_E2E_LOGIN_MODE": "existing-session",
        }
        values.update(changes)
        return runner.read_config(values)

    def test_requires_identity_device_and_explicit_mode(self):
        for key in ["NUPHOS_E2E_DEVICE_SERIAL", "NUPHOS_E2E_EXPECTED_EMAIL",
                    "NUPHOS_E2E_TEAM_ID", "NUPHOS_E2E_LOGIN_MODE"]:
            with self.assertRaises(runner.SetupError):
                self.config(**{key: ""})
        with self.assertRaises(runner.SetupError):
            self.config(NUPHOS_E2E_DEVICE_SERIAL="x; echo secret")

    def test_password_requires_separate_explicit_dedicated_opt_in(self):
        with self.assertRaises(runner.SetupError):
            self.config(NUPHOS_E2E_LOGIN_MODE="password", NUPHOS_E2E_PASSWORD="secret-value-123")
        c = self.config(NUPHOS_E2E_LOGIN_MODE="password", NUPHOS_E2E_PASSWORD="secret-value-123",
                        NUPHOS_E2E_ALLOW_LOGIN="true")
        self.assertNotIn("secret-value-123", repr(c))

    def test_existing_mode_rejects_unused_password(self):
        with self.assertRaises(runner.SetupError):
            self.config(NUPHOS_E2E_PASSWORD="secret-value-123")

    def test_env_file_is_literal_and_secret_files_are_private(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory) / "config"
            p.write_text("NUPHOS_E2E_PASSWORD='literal$() value'\n")
            p.chmod(0o600)
            self.assertEqual("literal$() value", runner.load_file(p)["NUPHOS_E2E_PASSWORD"])
            p.chmod(0o644)
            with self.assertRaises(runner.SetupError):
                runner.load_file(p)

    def test_transfer_uses_stdin_and_cleanup_runs_on_failure(self):
        calls = []
        def command(argv, **kwargs):
            calls.append((argv, kwargs.get("input")))
            if "instrument" in argv:
                raise runner.SetupError("Instrumentation failed.")
            return "device\n"
        c = self.config(NUPHOS_E2E_LOGIN_MODE="password", NUPHOS_E2E_PASSWORD="secret-value-123",
                        NUPHOS_E2E_ALLOW_LOGIN="true")
        with patch.object(runner, "command", command):
            with self.assertRaises(runner.SetupError):
                runner.run(c, "/sdk/adb")
        self.assertTrue(any(b"secret-value-123" in (data or b"") for _, data in calls))
        self.assertFalse(any("secret-value-123" in str(argv) for argv, _ in calls))
        self.assertIn("rm", calls[-1][0])

    def test_missing_config_fails_with_no_device_call(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True), \
                patch.object(runner, "command") as command, redirect_stdout(io.StringIO()):
            self.assertEqual(2, runner.main(["--config", str(Path(directory) / "missing"), "--validate"]))
            command.assert_not_called()

    def test_opted_in_skipped_test_is_not_a_pass(self):
        def command(argv, **kwargs):
            if "instrument" in argv:
                return "INSTRUMENTATION_STATUS_CODE: -3\nOK (1 test)"
            return "device\n"
        with patch.object(runner, "command", command):
            with self.assertRaises(runner.SetupError):
                runner.run(self.config(), "/sdk/adb")


if __name__ == "__main__":
    unittest.main()
