# Boots the NixOS module with PostgreSQL 16 (what a host with stateVersion < 25.11 runs) and checks
# the deployment contract from a second machine: TLS on the high port, CSRF against the public
# origin, rate limiting, request ids, and the database role split.
# Run: nix build .#checks.x86_64-linux.nixos-module -L
#
# The VMs have no internet, so the ACME order fails and Nginx keeps serving NixOS's self-signed
# placeholder certificate, hence curl -k.
{ self, pkgs }:
pkgs.testers.runNixOSTest {
  name = "tsssrstack-nixos-module";
  nodes.server =
    { pkgs, ... }:
    {
      imports = [ self.nixosModules.default ];
      services.tsssrstack = {
        enable = true;
        domain = "tsssrstack.test";
        openFirewall = true;
      };
      services.postgresql.package = pkgs.postgresql_16;
      security.acme = {
        acceptTerms = true;
        defaults.email = "admin@tsssrstack.test";
        certs."tsssrstack.test" = {
          dnsProvider = "spaceship";
          environmentFile = pkgs.writeText "fake-dns-credentials" ''
            SPACESHIP_API_KEY=test
            SPACESHIP_API_SECRET=test
          '';
        };
      };
      virtualisation.memorySize = 2048;
    };
  nodes.client = { };
  testScript = ''
    start_all()
    server.wait_for_unit("tsssrstack.service")
    server.wait_for_unit("nginx.service")
    server.wait_for_open_port(8443)

    # Simulates the router: the public name on port 443 reaches the server's port 8443.
    curl = "curl -sk --connect-to tsssrstack.test:443:server:8443 "
    url = "https://tsssrstack.test"
    origin = "-H 'Origin: https://tsssrstack.test' "
    form = "--data 'email=owner@example.com&password=correct-horse-battery' "

    client.wait_until_succeeds(curl + url + "/readyz | grep -x ready")

    with subtest("nginx assigns a request id"):
        client.succeed(curl + "-D - -o /dev/null " + url + "/healthz | grep -iE '^x-request-id: [0-9a-f]{32}'")

    with subtest("APP_ORIGIN is the public origin"):
        status = curl + "-o /dev/null -w '%{http_code}' -X POST "
        assert client.succeed(status + origin + form + url + "/register") == "303"
        assert client.succeed(status + "-H 'Origin: https://tsssrstack.test:8443' " + form + url + "/register") == "403"

    with subtest("the app connects as app_web; migrations ran as the owner"):
        assert server.succeed("runuser -u postgres -- psql -d tsssrstack -tAc \"SELECT tableowner FROM pg_tables WHERE tablename = 'users'\"").strip() == "tsssrstack"
        assert server.succeed("runuser -u postgres -- psql -d tsssrstack -tAc \"SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = 'tsssrstack' AND backend_type = 'client backend' AND usename <> 'postgres'\"").strip() == "app_web"
        assert server.succeed("runuser -u postgres -- psql -d tsssrstack -tAc 'SELECT count(*) FROM app.users'").strip() == "1"

    with subtest("the web user cannot act as the owner or change the schema"):
        server.fail("runuser -u tsssrstack-web -- psql -U tsssrstack -d tsssrstack -c 'SELECT 1'")
        server.fail("runuser -u tsssrstack-web -- psql -U app_web -d tsssrstack -c 'CREATE TABLE app.x ()'")
        server.fail("runuser -u tsssrstack-web -- psql -w -h 127.0.0.1 -U app_web -d tsssrstack -c 'SELECT 1'")

    with subtest("the session secret stays out of the store"):
        server.succeed("test \"$(stat -c '%U %a' /var/lib/tsssrstack/session-secret)\" = 'tsssrstack-web 600'")

    with subtest("login and register are rate limited"):
        codes = client.succeed("for i in $(seq 10); do " + curl + "-o /dev/null -w '%{http_code} ' " + url + "/login; done")
        assert "503" in codes, codes
        assert client.succeed(curl + "-o /dev/null -w '%{http_code}' " + url + "/healthz") == "200"
  '';
}
