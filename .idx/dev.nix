
{ pkgs, ... }: {
  # See https://www.jetpack.io/devbox/docs/configuration/ for more details
  # on how to configure your development environment.
  packages = [
    pkgs.nodejs_20
    pkgs.git
  ];
}
