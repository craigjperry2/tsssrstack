{
  description = "Deno server-rendered application starter";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
  outputs = { self, nixpkgs }:
    let systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
    in { devShells = nixpkgs.lib.genAttrs systems (system:
      let pkgs = import nixpkgs { inherit system; };
      in { default = pkgs.mkShell { packages = [ pkgs.deno pkgs.docker_29 pkgs.postgresql_17 ]; }; }); };
}
