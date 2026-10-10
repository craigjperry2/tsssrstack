{
  description = "Node server-rendered application starter";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
        forAll = f: nixpkgs.lib.genAttrs systems (system: f (import nixpkgs { inherit system; }));
    in {
      devShells = forAll (pkgs: { default = pkgs.mkShell {
        packages = [ pkgs.nodejs_26 pkgs.pnpm pkgs.postgresql_17 pkgs.nginx pkgs.process-compose ];
        # Serve process-compose's unauthenticated control API on a socket in the repository root
        # (run it from there) rather than on TCP port 8080, which Nginx serves the app on.
        PC_SOCKET_PATH = ".process-compose.sock";
      }; });
      # The production deployment: the app package and a NixOS module that runs it behind Nginx
      # with TLS, against a local PostgreSQL (infra/nixos, docs/adr/0007).
      packages = forAll (pkgs: rec {
        tsssrstack = pkgs.callPackage ./infra/nixos/package.nix {
          version = self.shortRev or self.dirtyShortRev or "0";
        };
        default = tsssrstack;
      });
      nixosModules.default = import ./infra/nixos/module.nix self;
      checks.x86_64-linux.nixos-module =
        import ./infra/nixos/test.nix { inherit self; pkgs = import nixpkgs { system = "x86_64-linux"; }; };
    };
}
