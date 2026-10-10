{
  description = "Node server-rendered application starter";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  outputs = { self, nixpkgs }:
    let systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
    in { devShells = nixpkgs.lib.genAttrs systems (system:
      let pkgs = import nixpkgs { inherit system; };
      in { default = pkgs.mkShell {
        packages = [ pkgs.nodejs_26 pkgs.pnpm pkgs.postgresql_17 pkgs.nginx pkgs.process-compose ];
        # Serve process-compose's unauthenticated control API on a socket in the repository root
        # (run it from there) rather than on TCP port 8080, which Nginx serves the app on.
        PC_SOCKET_PATH = ".process-compose.sock";
      }; }); };
}
