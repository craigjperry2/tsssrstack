# shellcheck shell=bash
# Loads this repository's Nix dev shell (flake.nix + flake.lock) into the current bash process.
# Source it at top level, not from a function: the dev shell declares arrays that would become local.
# Sourced by .agents/setup and by the login-shell hook that setup adds to ~/.bash_profile.
# `nix print-dev-env` takes ~2s even when warm, so its output is cached per flake input hash and
# regenerated only when flake.nix or flake.lock changes.

__tsssrstack_dev_env_file() {
  local repo key cache env_file tmp nix
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  key="$(cat "$repo/flake.nix" "$repo/flake.lock" | sha256sum | cut -c1-16)"
  cache="${XDG_CACHE_HOME:-$HOME/.cache}/tsssrstack"
  env_file="$cache/dev-env-$key.sh"
  if [[ ! -f "$env_file" ]]; then
    # nix.sh only puts nix on PATH when USER is set, so fall back to the single-user profile.
    nix="$(command -v nix || echo "$HOME/.nix-profile/bin/nix")"
    mkdir -p "$cache"
    tmp="$(mktemp "$cache/dev-env.XXXXXX")"
    # --profile keeps the shell's store paths alive across `nix-collect-garbage`.
    if ! "$nix" --extra-experimental-features 'nix-command flakes' print-dev-env \
      --profile "$cache/dev-profile" "$repo" >"$tmp"; then
      rm -f "$tmp"
      return 1
    fi
    # Keep the login shell's SHELL, and don't create (and leak) a fresh TMPDIR in every shell.
    sed -i -E -e '/^SHELL=/d' -e '/^export (NIX_BUILD_TOP|TMP|TMPDIR|TEMP|TEMPDIR)=/d' "$tmp"
    rm -f "$cache"/dev-env-*.sh
    mv "$tmp" "$env_file"
  fi
  printf '%s\n' "$env_file"
}

# Guard: leave a `nix develop` shell alone. Shells that inherit this environment (marked by
# TSSSRSTACK_DEV_ENV) load it again, because /etc/profile resets PATH in nested login shells.
if [[ -n "${TSSSRSTACK_DEV_ENV:-}" || -z "${IN_NIX_SHELL:-}" ]]; then
  if __tsssrstack_dev_env_file="$(__tsssrstack_dev_env_file)"; then
    # shellcheck disable=SC1090
    source "$__tsssrstack_dev_env_file"
    export TSSSRSTACK_DEV_ENV="$__tsssrstack_dev_env_file"
  else
    echo "tsssrstack: could not load the Nix dev shell; run .agents/setup" >&2
  fi
  unset __tsssrstack_dev_env_file
fi
unset -f __tsssrstack_dev_env_file
