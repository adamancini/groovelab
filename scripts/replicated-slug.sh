#!/usr/bin/env bash
# replicated-slug.sh — branch-name → Replicated channel slug normalizer.
#
# Single source of truth for slug normalization, shared between:
#   - .github/workflows/pr.yaml          (Step "Compute slug and chart version")
#   - .github/workflows/pr-cleanup.yaml  (Step "Compute slug")
#   - Makefile                           (`make pr-slug` and friends)
#
# This canonicalises a git branch name into a Replicated-friendly identifier
# used as the per-PR channel name, customer name suffix (`pr-<slug>`), CMX
# cluster name suffix (`pr-<slug>-<run-id>`), and OCI install path segment
# (`oci://registry.replicated.com/<app>/<slug>/<app>`).
#
# Algorithm (mirror of pr.yaml; see story GRO-lcva):
#   1. lowercase
#   2. translate '/' '_' '.' → '-'  (extends platform-examples
#      `tr '/_.' '-'` from wg-easy/taskfiles/utils.yml `normalize-name`)
#   3. strip anything not [a-z0-9-], collapsing runs of '-'
#   4. trim leading/trailing '-'
#   5. if length > 36: truncate to 28, append '-<sha7>' of original branch
#
# Usage:
#   normalize-slug "renovate/docker-build-push-action-7.x"
#   replicated-slug                            # uses current git branch
#   replicated-slug --branch <name>            # explicit branch
#
# Exit codes:
#   0  — slug printed to stdout
#   1  — git invocation failed (no branch given and not in a repo)
#   2  — usage error
#
# Sourcing:
#   source scripts/replicated-slug.sh
#   SLUG=$(normalize-slug "$BRANCH")

set -euo pipefail

# normalize-slug <branch-name>
#
# Prints the normalized slug to stdout. Empty input -> empty output (callers
# decide on a fallback like `pr-<PR_NUMBER>`).
normalize-slug() {
  local branch="${1:-}"
  if [ -z "$branch" ]; then
    printf ''
    return 0
  fi

  local raw
  raw=$(printf '%s' "$branch" \
    | tr '[:upper:]' '[:lower:]' \
    | tr '/_.' '-' \
    | tr -c 'a-z0-9-' '-' \
    | sed -E 's/-+/-/g; s/^-+//; s/-+$//')

  local slug
  if [ "${#raw}" -gt 36 ]; then
    local hash
    # sha256sum is GNU; macOS ships shasum. Try both.
    if command -v sha256sum >/dev/null 2>&1; then
      hash=$(printf '%s' "$branch" | sha256sum | cut -c1-7)
    else
      hash=$(printf '%s' "$branch" | shasum -a 256 | cut -c1-7)
    fi
    slug="${raw:0:28}-${hash}"
  else
    slug="$raw"
  fi

  printf '%s' "$slug"
}

# Allow direct invocation: `scripts/replicated-slug.sh [--branch <name>]`.
# When sourced (BASH_SOURCE[0] != $0), only the function is exported.
if [ "${BASH_SOURCE[0]:-$0}" = "${0}" ]; then
  branch=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch)
        branch="${2:-}"
        shift 2
        ;;
      -h|--help)
        sed -n '2,30p' "$0"
        exit 0
        ;;
      *)
        echo "ERROR: unknown argument: $1" >&2
        exit 2
        ;;
    esac
  done

  if [ -z "$branch" ]; then
    if ! branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null); then
      echo "ERROR: not in a git repo and no --branch given" >&2
      exit 1
    fi
  fi

  slug=$(normalize-slug "$branch")
  printf '%s\n' "$slug"
fi
