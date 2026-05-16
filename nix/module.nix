{
  config,
  lib,
  pkgs,
  ...
}:

with lib;

let
  cfg = config.services.quota-tracker;
in
{
  options.services.quota-tracker = {
    enable = mkEnableOption "Quota Tracker daemon";

    package = mkOption {
      type = types.package;
      default = pkgs.quota-tracker;
      defaultText = literalExpression "pkgs.quota-tracker";
      description = "The quota-tracker package to use.";
    };

    host = mkOption {
      type = types.str;
      default = "127.0.0.1";
      description = "Host to bind the quota-tracker daemon to.";
    };

    port = mkOption {
      type = types.port;
      default = 8787;
      description = "Port to bind the quota-tracker daemon to.";
    };

    extraArgs = mkOption {
      type = types.listOf types.str;
      default = [ ];
      example = [
        "--log-level"
        "DEBUG"
      ];
      description = "Extra arguments to pass to the quota-tracker daemon.";
    };

    environment = mkOption {
      type = types.attrsOf types.str;
      default = { };
      example = {
        QUOTA_TRACKER_LOG_LEVEL = "DEBUG";
      };
      description = "Environment variables for the quota-tracker service.";
    };
  };

  config = mkIf cfg.enable {
    systemd.user.services.quota-tracker = {
      description = "Quota Tracker Daemon";
      wantedBy = [ "default.target" ];
      after = [ "network.target" ];

      serviceConfig = {
        ExecStart = lib.escapeShellArgs (
          [
            (lib.getExe cfg.package)
            "daemon"
            "--host"
            cfg.host
            "--port"
            (toString cfg.port)
          ]
          ++ cfg.extraArgs
        );
        Restart = "on-failure";
      };

      inherit (cfg) environment;
    };
  };
}
