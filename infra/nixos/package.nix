# The production build: tsc output, the files the app reads at run time, and production-only
# node_modules, plus two launchers that run Node with the same permission flags as `pnpm start` and
# `pnpm migrate`. Both run from $out/lib/tsssrstack, because the app resolves its SQL, static files
# and migrations relative to the working directory.
#
# When pnpm-lock.yaml changes, pnpmDeps.hash must change too: set it to "", run
# `nix build .#tsssrstack`, and copy the hash from the mismatch error.
{
  lib,
  stdenv,
  fetchPnpmDeps,
  pnpmConfigHook,
  pnpm,
  nodejs_26,
  nodejs-slim_26,
  version ? "0",
}:
let
  root = ../..;
  # package.json "engines" makes pnpm refuse Node < 26. fetchPnpmDeps puts pnpm.nodejs-slim on
  # PATH, and pnpm 12 (a Rust binary) runs whichever node it finds there. Changing the passthru
  # attribute alone leaves pnpm itself unchanged, so it is not rebuilt.
  pnpm' = pnpm.overrideAttrs (old: {
    passthru = old.passthru // { nodejs-slim = nodejs-slim_26; };
  });
in
stdenv.mkDerivation (finalAttrs: {
  pname = "tsssrstack";
  inherit version;

  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      (root + "/package.json")
      (root + "/pnpm-lock.yaml")
      (root + "/pnpm-workspace.yaml")
      (root + "/tsconfig.json")
      (root + "/src")
      (root + "/migrations")
    ];
  };

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs) pname version src;
    pnpm = pnpm';
    fetcherVersion = 4;
    hash = "sha256-ZKg/1YSDk4J5KZiaqfA+DPQsSqvVZk1a3INLkMTBC20=";
  };

  nativeBuildInputs = [
    nodejs_26
    pnpm'
    pnpmConfigHook
  ];

  buildPhase = ''
    runHook preBuild
    node_modules/.bin/tsc
    # Reinstall from the same offline store, without devDependencies.
    rm -rf node_modules
    pnpm install --offline --frozen-lockfile --ignore-scripts --prod
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    app=$out/lib/tsssrstack
    mkdir -p $app/src/app/adapters/persistence $out/bin
    cp -r package.json node_modules migrations $app/
    cp -r dist $app/dist
    cp -r src/app/static $app/src/app/static
    cp -r src/app/adapters/persistence/sql $app/src/app/adapters/persistence/sql

    launcher() {
      local name=$1 entry=$2
      shift 2
      local reads=""
      for dir in dist node_modules "$@"; do reads+=" --allow-fs-read=$app/$dir"; done
      cat >$out/bin/$name <<EOF
    #!${stdenv.shell}
    cd $app
    exec ${nodejs-slim_26}/bin/node --permission$reads --allow-net $app/dist/$entry "\$@"
    EOF
      chmod +x $out/bin/$name
    }
    launcher tsssrstack src/app/main.js src/app/static src/app/adapters/persistence/sql
    launcher tsssrstack-migrate src/app/adapters/persistence/migrate.js migrations
    runHook postInstall
  '';

  meta = {
    description = "tsssrstack, a server-rendered Hono and PostgreSQL task list";
    mainProgram = "tsssrstack";
    platforms = lib.platforms.unix;
  };
})
