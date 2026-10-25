# 0008: Release by tag, and pin hosts to the tag

- Status: accepted
- Date: 2026-10-25
- Amends: [0007](0007-deploy-to-nixos-with-a-flake-module.md), whose deployment step was "a flake
  input update plus `nixos-rebuild switch`"

## Context

The production host's flake took this repository as an input that tracked `main`. Its routine
dependency update runs `nix flake update` on every input, so each nixpkgs bump also deployed
whatever had merged here since the last one, without anyone deciding to deploy it. There were no
named releases: the Nix package's version was the commit hash.

## Decision

**`version` in `package.json` is the release version, and merging a pull request that bumps it is
the release.** On every push to `main`, once both `node` jobs pass, the CI `release` job publishes
GitHub release `v<version>` on that commit, unless that release already exists. Nobody creates
tags by hand.

**Hosts pin the input to a release tag**, such as `github:craigjperry2/tsssrstack/v0.1.0`. A tag
re-resolves to the same commit, so `nix flake update` on the host leaves the app alone. Deploying a
release is a deliberate change: edit the tag, run `nix flake lock`, then `nixos-rebuild switch`.

**The Nix package takes its version from `package.json`**, like the page footer, and the commit
stays in `APP_COMMIT`. The store path names the release, and the footer shows both, such as
`Version 0.1.0 (f327f95)`.

## Consequences

- Commits on `main` reach a host only in a release. Dependabot and other merges that leave the
  version alone publish nothing.
- If the version-bump push fails CI, nothing is published until a later push with that version
  passes, and the release lands on that later commit.
- A tag that moved would be picked up silently by the host's next `nix flake update`. GitHub's
  immutable releases setting prevents that; it is a repository setting, not enforced here.
