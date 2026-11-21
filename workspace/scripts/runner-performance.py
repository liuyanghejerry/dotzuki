#!/usr/bin/env python3
"""Compare per-scenario Callgrind instruction counts to the reviewed baseline."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

WORKSPACE = Path(__file__).resolve().parents[1]
BASELINE = WORKSPACE / "ci/runner-performance/baseline.json"
SCENARIOS = ("idle_map", "scrolling", "bag", "battle", "pcm", "scene_flags")


def build(toolchain):
    cmd = ["cargo", f"+{toolchain}", "test", "--locked", "--release", "--no-run",
           "-p", "dotzuki-runner", "--no-default-features", "--test", "runner_game",
           "--message-format=json-render-diagnostics"]
    build = subprocess.run(cmd, cwd=WORKSPACE, stdout=subprocess.PIPE, text=True, check=True)
    for line in build.stdout.splitlines():
        event = json.loads(line)
        if event["reason"] == "compiler-artifact" and event["target"]["name"] == "runner_game":
            return event["executable"]
    raise RuntimeError("Cargo did not emit the runner_game test executable")


def measure(executable, scenario, profile):
    subprocess.run(["valgrind", "--quiet", "--tool=callgrind", "--collect-atstart=no",
                    "--toggle-collect=dotzuki_measure_workload", f"--callgrind-out-file={profile}",
                    executable, "--ignored", "--exact", "performance::scenario", "--test-threads=1"],
                   cwd=WORKSPACE, check=True, env={**os.environ, "DOTZUKI_PERF_SCENARIO": scenario})
    fields = dict(line.split(": ", 1) for line in profile.read_text().splitlines()
                  if line.startswith(("events: ", "totals: ")))
    if fields.get("events") != "Ir" or int(fields["totals"]) <= 0:
        raise ValueError(f"missing instruction count for {scenario}")
    return int(fields["totals"])


def compare(values, baseline):
    reference = baseline["instructions"]
    if set(values) != set(reference) or set(values) != set(SCENARIOS):
        raise ValueError("scenario set does not match the baseline")
    passed = True
    for name, count in values.items():
        old = reference[name]
        if old <= 0 or count <= 0:
            raise ValueError(f"invalid instruction count for {name}")
        change = 100 * (count - old) / old
        ok = change <= baseline["tolerance_percent"]
        print(f"{name:12} {old:>12,} -> {count:>12,}  {change:+6.1f}%  {'PASS' if ok else 'FAIL'}")
        passed &= ok
    return passed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="write a candidate snapshot for review")
    args = parser.parse_args()
    baseline = json.loads(BASELINE.read_text())
    executable = build(baseline["rust"])
    with tempfile.TemporaryDirectory() as directory:
        values = {s: measure(executable, s, Path(directory) / s) for s in SCENARIOS}
    if args.output:
        args.output.write_text(json.dumps({**baseline, "instructions": values}, indent=2) + "\n")
    return 0 if compare(values, baseline) else 1


if __name__ == "__main__":
    sys.exit(main())
