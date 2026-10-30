# Vendored browser assets

| Asset               | Upstream                                   | Version / revision                                    | License |
| ------------------- | ------------------------------------------ | ----------------------------------------------------- | ------- |
| `datastar-1.0.4.js` | https://github.com/starfederation/datastar | `v1.0.4` (release tag), file `bundles/datastar.js`    | MIT     |
| `oat-1.0.0.min.css` | https://github.com/knadh/oat               | `1.0.0` (npm `@knadh/oat`), file `oat.min.css`        | MIT     |
| `oat-1.0.0.min.js`  | https://github.com/knadh/oat               | `1.0.0` (npm `@knadh/oat`), file `oat.min.js`         | MIT     |

Files are byte-identical to upstream: oxfmt and oxlint exclude this directory, and CI verifies every
file against `SHA256SUMS`. Re-vendoring requires updating this table and `SHA256SUMS`.

Datastar is vendored because its 1.x releases are not published to npm or JSR. The weekly
`Datastar update` workflow (`.github/workflows/datastar-update.yml`) opens a pull request when a
new upstream release appears.

Oat is published to npm, but its built files are not in its Git tags, so they are copied from the
npm release tarball (the same files upstream serves from its `gh-pages` branch). It is vendored
rather than installed so the browser assets live in one place with one verification path. The
weekly `Oat update` workflow (`.github/workflows/oat-update.yml`) opens a pull request when a new
version appears on npm.

The application does not make browser CDN requests.
