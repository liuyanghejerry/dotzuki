"""Validate editor release provenance and emit GitHub Actions job outputs."""
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib


def metadata(version, event, preview, requested_tag, ref_name, sha, run_id, attempt):
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Workspace version must be a stable X.Y.Z version")
    if preview:
        if event != "workflow_dispatch" or requested_tag:
            raise ValueError("Preview requires manual dispatch and an empty tag input")
        if not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise ValueError("Preview requires a full source commit SHA")
        if not all(re.fullmatch(r"[1-9][0-9]*", n) for n in (run_id, attempt)):
            raise ValueError("Preview requires positive run ID and attempt")
        suffix = f"{run_id}.{attempt}.g{sha[:12]}"
        return {"tag": f"editor-preview-{suffix}",
                "version": f"{version}-preview.{suffix}", "preview": "true"}
    tag = (requested_tag or f"v{version}") if event == "workflow_dispatch" else ref_name
    if tag != f"v{version}":
        raise ValueError(f"Tag {tag} does not match workspace version {version}")
    return {"tag": tag, "version": version, "preview": "false"}


def gh(*args):
    return subprocess.check_output(["gh", *args], text=True).strip()


def main():
    env = os.environ
    version = tomllib.loads(Path("workspace/Cargo.toml").read_text())["workspace"]["package"]["version"]
    result = metadata(version, env["GITHUB_EVENT_NAME"], env.get("PREVIEW") == "true",
                      env.get("REQUESTED_TAG", ""), env["GITHUB_REF_NAME"], env["GITHUB_SHA"],
                      env["GITHUB_RUN_ID"], env["GITHUB_RUN_ATTEMPT"])
    tag = result["tag"]
    if result["preview"] == "false":
        # Peel annotated tags, too. Never attach a different branch's binaries
        # to an existing stable release with the same workspace version.
        subprocess.run(["git", "fetch", "--no-tags", "origin", f"refs/tags/{tag}"], check=True)
        commit = subprocess.check_output(["git", "rev-parse", "FETCH_HEAD^{commit}"], text=True).strip()
        if commit != env["GITHUB_SHA"]:
            raise ValueError("Release tag does not point to the checked-out source commit")
    # Listing releases fails on API/auth errors instead of treating them as absence.
    releases = json.loads(gh("release", "list", "--repo", env["GITHUB_REPOSITORY"],
                             "--limit", "1000", "--json", "tagName"))
    exists = any(release["tagName"] == tag for release in releases)
    if result["preview"] == "true" and exists:
        raise ValueError("Preview tag already published; rerun with a new run attempt")
    result["release_exists"] = str(exists).lower()
    with open(env["GITHUB_OUTPUT"], "a") as output:
        for key, value in result.items():
            output.write(f"{key}={value}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
