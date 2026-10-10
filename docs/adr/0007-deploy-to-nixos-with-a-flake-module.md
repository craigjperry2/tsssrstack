# 0007: Deploy to NixOS with a flake package and module

- Status: accepted
- Date: 2026-10-10

## Context

The first production host is a NixOS machine configured from a separate flake. It already runs a
PostgreSQL cluster for other services. Public traffic reaches it through a router that forwards
public port 443 to one high port on the host; nothing reaches ports 80 or 443 on the host itself,
and there is no tunnel. Production needs what the development proxy does (SSE without buffering,
rate limits on login and registration, request ids), TLS from Let's Encrypt, an `APP_ORIGIN` equal
to the public origin, and the schema-owner / runtime-role split from ADR 0004.

## Decision

**This flake exports the app as a package and a NixOS module, and the host's flake imports the
module.** `infra/nixos/package.nix` builds with `tsc`, keeps production `node_modules` only, and
installs launchers that run Node with the same permission flags as `pnpm start` and `pnpm migrate`.
The module defaults to this flake's own package, so production runs the Node and dependencies that
CI tested, not whatever the host's nixpkgs has.

The module, `infra/nixos/module.nix`, runs three things:

- `tsssrstack-migrate`, a oneshot as system user `tsssrstack`, which peer-authenticates as the
  database owner role of the same name. Deployments that change the package rerun it before the
  app restarts.
- `tsssrstack`, the app as system user `tsssrstack-web`, which a peer map lets log in only as
  `app_web`, a member of `app_runtime`. Neither role has a password, so there is no database
  secret to manage. The session key is generated on first start in `/var/lib/tsssrstack`.
- An Nginx virtual host on the high port that mirrors `infra/nginx/nginx.conf` and gets its
  certificate from NixOS's `security.acme`.

**Certificates use the DNS-01 challenge, configured by the host.** HTTP-01 needs port 80, which is
not forwarded. TLS-ALPN-01 would work through the 443 forward, but NixOS's `security.acme` (lego)
cannot run it alongside Nginx, nginx's own ACME module is not in nixpkgs, and Caddy, which can, has
no built-in rate limiting. DNS-01 needs a DNS API credential on the host, but issuance and renewal no
longer depend on the port forward, and the module stays on the stock NixOS Nginx and ACME path.
The vhost sets `acmeRoot = null`, so evaluation fails until the host gives the certificate a
`dnsProvider`.

**Deployment is a flake input update plus `nixos-rebuild switch`.** One host does not need deploy-rs
or Colmena. `nixos-rebuild --target-host` covers remote deployment.

## Consequences

- When `pnpm-lock.yaml` changes, the `pnpmDeps` hash in `infra/nixos/package.nix` must change too,
  or the package does not build. CI builds the package on Linux, so a Dependabot pull request
  fails until someone updates the hash.
- `nix build .#checks.x86_64-linux.nixos-module` boots the module in VMs and checks the deployment
  contract. CI does not run it.
- The Nginx settings exist twice: in the development `infra/nginx/nginx.conf` and in the module.
