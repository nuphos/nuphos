#!/usr/bin/env python3
"""Run opt-in synthetic phases in distinct processes. Never clear/uninstall another package."""
import argparse
import pathlib
import re
import subprocess

RECEIVER = "ai.nuphos.android.sharepersist1359"
SENDER = "ai.nuphos.sharepersist1359.sender"
PHASES = [
    "seedPending", "consumeExisting", "verifyExisting", "verifyEditedAndWarmCancel",
    "consumeNew", "verifyNewAndHandoff", "verifyNoReplay",
    "seedPending", "cancelPending", "verifyCanceled",
    "seedPending", "switchAccount", "verifyCanceled",
    "seedPending", "consumeExisting", "removeTeam",
    "seedPending", "consumeExisting", "denyConversation",
    "seedPending", "consentReset", "verifyCanceled",
    "seedPending", "signOut", "verifyCanceled",
    "seedPending", "removeFile", "verifyCorrupt",
    "seedPending", "damageMetadata", "verifyCorrupt",
    "seedLegacy", "verifyLegacy",
    "seedPending", "consumeExisting", "damageDeliveredMetadata", "verifyDeliveredCorrupt",
    "seedPending", "consumeExisting", "removeDeliveredFile", "verifyDeliveredCorrupt",
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--evidence-dir", type=pathlib.Path, required=True)
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--phase", action="append", help="Run selected phases, still forcing a new process each time")
    args = parser.parse_args()
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    adb = [args.adb, "-s", args.serial]
    for package in (RECEIVER, RECEIVER + ".test", SENDER):
        installed = subprocess.check_output(adb + ["shell", "pm", "path", package], text=True)
        if not installed.startswith("package:"):
            raise SystemExit(f"Required isolated package is not installed: {package}")
    pids = []
    phases = args.phase or PHASES
    try:
        for index, phase in enumerate(phases, 1):
            if phase not in PHASES:
                raise SystemExit(f"Unknown phase {phase}")
            for package in (RECEIVER, SENDER):
                subprocess.run(adb + ["shell", "am", "force-stop", package], check=True)
                running = subprocess.run(adb + ["shell", "pidof", package], capture_output=True, text=True)
                if running.stdout.strip():
                    raise SystemExit(f"Package still running after force-stop: {package}")
            command = adb + ["shell", "am", "instrument", "-w", "-r", "-e", "persistentSharePhase", phase,
                             "-e", "captureSynthetic", "true", "-e", "class",
                             "ai.nuphos.android.PersistentShareProcessDeviceTest",
                             RECEIVER + ".test/androidx.test.runner.AndroidJUnitRunner"]
            result = subprocess.run(command, capture_output=True, text=True, timeout=90)
            output = result.stdout + result.stderr
            (args.evidence_dir / f"{index:02}-{phase}.log").write_text(output)
            if result.returncode or not re.search(r"OK \(1 test\)", output):
                raise SystemExit(f"Phase {phase} failed; inspect {args.evidence_dir}")
            match = re.search(r"PERSISTENT_SHARE_PHASE=" + re.escape(phase) + r" PID=(\d+)", output)
            if not match or int(match[1]) in pids:
                raise SystemExit("Distinct process identity was not recorded")
            pids.append(int(match[1]))
            print(f"PASS {index}/{len(phases)} {phase} pid={match[1]}", flush=True)
    finally:
        for package in (RECEIVER, SENDER):
            subprocess.run(adb + ["shell", "am", "force-stop", package], check=True)
    print(f"PASS {len(phases)} phases in distinct target processes; synthetic HTTP only", flush=True)


if __name__ == "__main__":
    main()
