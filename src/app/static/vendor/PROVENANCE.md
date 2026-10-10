# Vendored browser assets

| Asset               | Upstream                                   | Version / revision                                    | License |
| ------------------- | ------------------------------------------ | ----------------------------------------------------- | ------- |
| `datastar-1.0.2.js` | https://github.com/starfederation/datastar | `v1.0.2` (release tag), file `bundles/datastar.js`    | MIT     |

Files are byte-identical to upstream: oxfmt and oxlint exclude this directory, and CI verifies every
file against `SHA256SUMS`. Re-vendoring requires updating this table and `SHA256SUMS`.

Datastar is vendored because its 1.x releases are not published to npm or JSR. The weekly
`Datastar update` workflow (`.github/workflows/datastar-update.yml`) opens a pull request when a
new upstream release appears.

Bulma is not vendored: it is the npm package `bulma` in `package.json`, pinned with an integrity hash
in `pnpm-lock.yaml` and kept current by Dependabot.

The application does not make browser CDN requests.
