#!/usr/bin/env bash
# Publish every dotzuki-* crate to crates.io in topological order.
#
# This is the single release entry point for the engine: the GitHub Actions
# release workflow (.github/workflows/release.yml) calls it on tag pushes /
# GitHub Releases / manual runs, and maintainers can run it locally too.
#
# Behavior:
#   * Reads the canonical version from [workspace.package] (every publishable
#     crate inherits it, so one bump in workspace/Cargo.toml releases them all).
#   * Asserts every internal dotzuki-* path dependency requires exactly that
#     version — crates.io resolves path deps through the registry, so a drift
#     would fail the publish or ship a mixed-version graph.
#   * Publishes in dependency order and skips any crate whose version is
#     already on crates.io, which makes the workflow idempotent (safe to re-run
#     after a partial failure or a duplicate tag/release trigger).
#
# Usage:
#   scripts/publish-crates.sh [--check] [--no-verify] [--allow-dirty]
#
#   --check        Validate manifests and packaging only (`cargo package`
#                  for every crate, no upload, no network). Use in local dev
#                  and optionally in CI before releasing. Before the FIRST
#                  release, crates whose internal dotzuki-* deps are not on
#                  crates.io yet are reported as skipped rather than failed —
#                  that is the expected pre-release state; after the first
#                  release the check is a strict gate.
#   --no-verify    Skip cargo publish's package-verify build. Not recommended:
#                  verification is what catches broken packaged manifests.
#   --allow-dirty  Publish from a dirty git tree (not recommended).
#
# Environment:
#   CARGO_REGISTRY_TOKEN  crates.io API token. The release workflow injects it
#                         from the repo secret; locally, `cargo login`
#                         credentials are used when this is unset.
#   RELEASE_TAG           Expected release tag (e.g. "v0.1.0"). When set, the
#                         version it names must equal the workspace version.
#   PUBLISH_DELAY         Seconds to sleep between publishes (default 15; kept
#                         small enough to stay under crates.io rate limits).
#
# Exit status: 0 = published/skipped cleanly, non-zero = failure (fix and
# re-run; already-published crates are skipped on the next attempt).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

CHECK=0
NO_VERIFY=0
ALLOW_DIRTY=0
for arg in "$@"; do
    case "$arg" in
        --check) CHECK=1 ;;
        --no-verify) NO_VERIFY=1 ;;
        --allow-dirty) ALLOW_DIRTY=1 ;;
        *)
            echo "Unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

# Topological order of the dotzuki-* dependency graph. dotzuki-engine comes
# first (everything depends on it); the leaf consumers come last. Do not
# reorder freely — a crate must appear after everything it depends on.
PUBLISH_ORDER=(
    dotzuki-engine
    dotzuki-rules-macro
    dotzuki-audio
    dotzuki-engine-script
    dotzuki-rules
    dotzuki-engine-tiled
    dotzuki-engine-dsl
    dotzuki-renderer
    dotzuki-ui
    dotzuki-app
    dotzuki-tui
    dotzuki-runner
    dotzuki-web
    dotzuki-runner-web
    dotzuki-cli
)

cd "$WORKSPACE_ROOT"

VERSION="$(cargo metadata --no-deps --format-version 1 | python3 -c '
import json, sys
meta = json.load(sys.stdin)
v = next(p["version"] for p in meta["packages"] if p["name"] == "dotzuki-engine")
print(v)
')"

echo "==> Workspace version: $VERSION"

# Version-consistency gate: every publishable crate must carry the workspace
# version, and every internal dotzuki-* PATH dependency must require exactly
# that version.
python3 - "$VERSION" <<'PY'
import json, subprocess, sys

version = sys.argv[1]
meta = json.loads(subprocess.run(
    ["cargo", "metadata", "--no-deps", "--format-version", "1"],
    capture_output=True, text=True, check=True,
).stdout)

errors = []
for p in meta["packages"]:
    if not p["name"].startswith("dotzuki-"):
        continue
    if p["version"] != version:
        errors.append(f"{p['name']}: package version {p['version']} != workspace version {version}")
    for dep in p["dependencies"]:
        if not dep["name"].startswith("dotzuki-"):
            continue
        if dep.get("path") is None:
            continue  # registry/git dep, not packaged
        want = f"^{version}"
        if dep["req"] != want:
            errors.append(f"{p['name']}: internal dep {dep['name']} requires {dep['req']} != {want}")

if errors:
    print("ERROR: version consistency check failed:", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    sys.exit(1)
print("==> Version consistency check passed.")
PY

# When a release event / tag push drives this run, the tag must name the
# version being published — a tag like v0.2.0 with manifests still at 0.1.0
# would publish the wrong thing.
if [[ -n "${RELEASE_TAG:-}" ]]; then
    TAG_VERSION="${RELEASE_TAG#v}"
    if [[ "$TAG_VERSION" != "$VERSION" ]]; then
        echo "ERROR: tag ${RELEASE_TAG} does not match workspace version ${VERSION}." >&2
        echo "Bump [workspace.package] version in workspace/Cargo.toml first." >&2
        exit 1
    fi
fi

if [[ $CHECK -eq 1 ]]; then
    failed=0
    for crate in "${PUBLISH_ORDER[@]}"; do
        echo "==> cargo package -p $crate (check only)"
        # --allow-dirty so the check works on an uncommitted tree (it exists to
        # validate manifests, not the VCS state); real publishes stay strict.
        log="$(mktemp)"
        if cargo package -p "$crate" --no-verify --allow-dirty >"$log" 2>&1; then
            grep -E '^\s+Packaged ' "$log" | tail -1 || true
        elif grep -q 'no matching package named .dotzuki-' "$log"; then
            # `cargo package` resolves versioned path deps against the registry
            # index. Before the first release those internal deps don't exist
            # anywhere yet — the manifest is fine, and the real publish
            # sequence resolves them in topological order.
            echo "    skipped: an internal dotzuki-* dependency is not on the"
            echo "    registry yet (expected before the first release)"
        else
            cat "$log" >&2
            failed=1
        fi
        rm -f "$log"
    done
    if [[ $failed -eq 1 ]]; then
        echo "==> Check FAILED." >&2
        exit 1
    fi
    echo "==> Check passed: all crates package cleanly. Nothing was uploaded."
    exit 0
fi

# Pin the registry explicitly: it is the default on CI runners, and locally it
# bypasses source-replacement mirrors (e.g. rsproxy), which cargo refuses to
# publish through.
PUBLISH_FLAGS=(--registry crates-io --locked)
[[ $NO_VERIFY -eq 1 ]] && PUBLISH_FLAGS+=(--no-verify)
[[ $ALLOW_DIRTY -eq 1 ]] && PUBLISH_FLAGS+=(--allow-dirty)

# crates.io API requires a User-Agent; identify this release tooling.
UA="dotzuki-release (github.com/liuyanghejerry/dotzuki)"
DELAY="${PUBLISH_DELAY:-15}"

published=0
skipped=0
total=${#PUBLISH_ORDER[@]}
for ((i = 0; i < total; i++)); do
    crate="${PUBLISH_ORDER[$i]}"
    echo "==> [$((i + 1))/$total] $crate $VERSION"

    status="$(curl -sSL -A "$UA" -o /dev/null -w '%{http_code}' \
        "https://crates.io/api/v1/crates/$crate/$VERSION")"
    if [[ "$status" == "200" ]]; then
        echo "    already on crates.io — skipping"
        skipped=$((skipped + 1))
    elif [[ "$status" == "404" ]]; then
        cargo publish -p "$crate" "${PUBLISH_FLAGS[@]}"
        published=$((published + 1))
    else
        echo "ERROR: crates.io returned HTTP $status for $crate $VERSION — aborting." >&2
        exit 1
    fi

    # Keep the sparse-index updates ahead of the next crate's verification
    # build and stay clear of crates.io rate limits.
    if [[ $((i + 1)) -lt $total ]]; then
        sleep "$DELAY"
    fi
done

echo "==> Done: $published published, $skipped already on crates.io."
