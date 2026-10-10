# NixOS module for a production tsssrstack: Nginx terminates TLS on a high port and proxies to the
# Node server on loopback, which talks to the host's PostgreSQL over its Unix socket. See
# docs/adr/0007 for the choices.
#
# Database access keeps the repository's role split, with peer authentication and no passwords:
#   system user tsssrstack      → role tsssrstack, owner of database tsssrstack; runs migrations
#   system user tsssrstack-web  → role app_web, a login that is a member of app_runtime; runs the app
#
# The certificate comes from security.acme.certs.<domain>, which the host configures with a DNS-01
# provider (the vhost sets acmeRoot = null, so there is no HTTP-01 webroot).
self:
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.services.tsssrstack;
  inherit (lib) mkOption types;
  upstream = "http://127.0.0.1:${toString cfg.port}";
  pgEnv = {
    PGHOST = "/run/postgresql";
    PGPORT = toString config.services.postgresql.settings.port;
  };
  # Mirrors the development roles in infra/postgres/dev-roles.sql, minus the well-known password:
  # app_web can log in only through the peer map below. Re-asserted on every run.
  runtimeRoles = pkgs.writeText "tsssrstack-roles.sql" ''
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_runtime') THEN
        CREATE ROLE app_runtime NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_web') THEN
        CREATE ROLE app_web LOGIN;
      END IF;
    END
    $$;
    ALTER ROLE app_web WITH LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD NULL;
    GRANT app_runtime TO app_web;
  '';
  hardening = {
    CapabilityBoundingSet = "";
    LockPersonality = true;
    NoNewPrivileges = true;
    PrivateDevices = true;
    PrivateTmp = true;
    ProtectClock = true;
    ProtectControlGroups = true;
    ProtectHome = true;
    ProtectHostname = true;
    ProtectKernelLogs = true;
    ProtectKernelModules = true;
    ProtectKernelTunables = true;
    ProtectProc = "invisible";
    ProcSubset = "pid";
    ProtectSystem = "strict";
    RemoveIPC = true;
    RestrictAddressFamilies = [
      "AF_INET"
      "AF_INET6"
      "AF_UNIX"
    ];
    RestrictNamespaces = true;
    RestrictRealtime = true;
    RestrictSUIDSGID = true;
    SystemCallArchitectures = "native";
    SystemCallFilter = [
      "@system-service"
      "~@privileged"
    ];
    UMask = "0077";
    # MemoryDenyWriteExecute stays off: V8's JIT needs writable and executable memory.
  };
in
{
  options.services.tsssrstack = {
    enable = lib.mkEnableOption "tsssrstack";
    package = mkOption {
      type = types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.tsssrstack;
      defaultText = lib.literalMD "the package from the tsssrstack flake";
      description = "The tsssrstack package.";
    };
    domain = mkOption {
      type = types.str;
      example = "tsssrstack.example.com";
      description = "Public host name: the Nginx server name and the ACME certificate name.";
    };
    origin = mkOption {
      type = types.str;
      default = "https://${cfg.domain}";
      defaultText = lib.literalExpression ''"https://''${config.services.tsssrstack.domain}"'';
      description = ''
        The origin browsers see (APP_ORIGIN). The CSRF check rejects state-changing requests whose
        Origin differs, so include a port only if the public URL has one.
      '';
    };
    port = mkOption {
      type = types.port;
      default = 8000;
      description = "Loopback port of the Node server.";
    };
    httpsPort = mkOption {
      type = types.port;
      default = 8443;
      description = "Port Nginx serves HTTPS on. Forward public traffic for port 443 here.";
    };
    openFirewall = mkOption {
      type = types.bool;
      default = false;
      description = "Open httpsPort in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.tsssrstack = {
      isSystemUser = true;
      group = "tsssrstack";
    };
    users.users.tsssrstack-web = {
      isSystemUser = true;
      group = "tsssrstack";
    };
    users.groups.tsssrstack = { };

    services.postgresql = {
      enable = true;
      ensureDatabases = [ "tsssrstack" ];
      ensureUsers = [
        {
          name = "tsssrstack";
          ensureDBOwnership = true;
        }
      ];
      # Before the module's default `local all all peer`, which would refuse the name mismatch.
      authentication = ''
        local tsssrstack app_web peer map=tsssrstack
      '';
      identMap = ''
        tsssrstack tsssrstack-web app_web
      '';
    };
    # Runs as the postgres superuser, after ensureDatabases and ensureUsers. Creating app_runtime
    # here means the schema owner needs no CREATEROLE (migration 003 reuses it).
    systemd.services.postgresql-setup.script = lib.mkAfter ''
      psql -d postgres -v ON_ERROR_STOP=1 -f ${runtimeRoles}
    '';

    systemd.services.tsssrstack-migrate = {
      description = "tsssrstack database migrations";
      requires = [ "postgresql-setup.service" ];
      after = [ "postgresql-setup.service" ];
      environment = pgEnv // {
        PGUSER = "tsssrstack";
        MIGRATION_DATABASE_URL = "postgres:///tsssrstack";
      };
      serviceConfig = hardening // {
        Type = "oneshot";
        # Stays active, so a deployment that changes the package reruns it before the app restarts.
        RemainAfterExit = true;
        User = "tsssrstack";
        Group = "tsssrstack";
        ExecStart = lib.getExe' cfg.package "tsssrstack-migrate";
      };
    };

    systemd.services.tsssrstack = {
      description = "tsssrstack";
      wantedBy = [ "multi-user.target" ];
      requires = [ "tsssrstack-migrate.service" ];
      after = [
        "network.target"
        "tsssrstack-migrate.service"
      ];
      # postgres.js reads the socket directory and user from PGHOST and PGUSER: its URL parser
      # cannot express a socket path.
      environment = pgEnv // {
        PGUSER = "app_web";
        ENV = "production";
        APP_ORIGIN = cfg.origin;
        DATABASE_URL = "postgres:///tsssrstack";
        HOST = "127.0.0.1";
        PORT = toString cfg.port;
      };
      # The session signing key is generated on first start and kept in the state directory, out
      # of the Nix store. Deleting it signs everyone out.
      script = ''
        secret="$STATE_DIRECTORY/session-secret"
        if [ ! -s "$secret" ]; then
          head -c 48 /dev/urandom | base64 -w0 >"$secret.new"
          mv "$secret.new" "$secret"
        fi
        SESSION_SECRET="$(cat "$secret")" exec ${lib.getExe cfg.package}
      '';
      serviceConfig = hardening // {
        User = "tsssrstack-web";
        Group = "tsssrstack";
        StateDirectory = "tsssrstack";
        StateDirectoryMode = "0700";
        Restart = "on-failure";
        RestartSec = 5;
      };
    };

    services.nginx = {
      enable = true;
      # Production counterpart of infra/nginx/nginx.conf; keep the two in step.
      commonHttpConfig = ''
        limit_req_zone $binary_remote_addr zone=tsssrstack_auth:10m rate=10r/m;
        log_format tsssrstack_json escape=json '{"request_id":"$request_id","method":"$request_method","path":"$uri","status":$status,"duration":$request_time,"bytes":$body_bytes_sent,"user_agent":"$http_user_agent"}';
      '';
      virtualHosts.${cfg.domain} = {
        onlySSL = true;
        enableACME = lib.mkDefault true;
        acmeRoot = lib.mkDefault null;
        listen = [
          {
            addr = "0.0.0.0";
            port = cfg.httpsPort;
            ssl = true;
          }
          {
            addr = "[::]";
            port = cfg.httpsPort;
            ssl = true;
          }
        ];
        extraConfig = ''
          access_log /var/log/nginx/tsssrstack.log tsssrstack_json;
        '';
        locations."~ ^/(login|register)$" = {
          proxyPass = upstream;
          recommendedProxySettings = true;
          extraConfig = ''
            limit_req zone=tsssrstack_auth burst=5 nodelay;
            proxy_http_version 1.1;
            proxy_set_header X-Request-ID $request_id;
          '';
        };
        # Commands answer with finite SSE responses: pass each event through as it is written.
        locations."/" = {
          proxyPass = upstream;
          recommendedProxySettings = true;
          extraConfig = ''
            proxy_buffering off;
            proxy_http_version 1.1;
            proxy_set_header X-Request-ID $request_id;
          '';
        };
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.httpsPort ];
  };
}
