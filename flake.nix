{
  description = "Linkarr Chrome extension development environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    inputs@{ flake-parts, treefmt-nix, ... }:
    flake-parts.lib.mkFlake { inherit inputs; } {
      imports = [ treefmt-nix.flakeModule ];
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      perSystem =
        { pkgs, config, ... }:
        {
          devShells.default = pkgs.mkShellNoCC {
            packages =
              with pkgs;
              [
                nodejs_24
                pnpm_10
                typescript-language-server
                actionlint
                agent-browser
              ]
              ++ [ config.treefmt.build.wrapper ]
              ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.chromium ];
            env = pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
              PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = "${pkgs.chromium}/bin/chromium";
            };
          };
          treefmt = {
            projectRootFile = "flake.nix";
            programs = {
              nixfmt.enable = true;
              actionlint.enable = true;
              biome = {
                enable = true;
                includes = [
                  "*.ts"
                  "*.js"
                  "*.mjs"
                  "*.json"
                  "*.css"
                ];
              };
              prettier = {
                enable = true;
                includes = [
                  "*.md"
                  "*.yml"
                  "*.yaml"
                  "*.html"
                ];
              };
            };
            settings.formatter.biome.options = pkgs.lib.mkForce [
              "format"
              "--write"
              "--no-errors-on-unmatched"
              "--config-path"
              "${./biome.json}"
            ];
          };
        };
    };
}
