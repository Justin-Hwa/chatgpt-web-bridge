import { spawnSync } from "node:child_process";

export function detectProvider({
  browser,
  agent = globalThis.agent,
  env = process.env
} = {}) {
  if (browser) {
    return {
      provider: "sdk-browser",
      reason: "explicit_browser_injected"
    };
  }

  if (
    agent &&
    typeof agent === "object" &&
    agent.browsers
  ) {
    return {
      provider: "codex-browser-bridge",
      reason: "global_agent_browsers_available"
    };
  }

  if (
    env.ORCA_BROWSER_AVAILABLE === "1" ||
    env.ORCA_RUNTIME === "1"
  ) {
    return {
      provider: "orca-host-browser-tool",
      reason: "orca_browser_tool_hint",
      runtimeOwned: true
    };
  }

  if (commandExists("bsk")) {
    return {
      provider: "browserskill-cli",
      reason: "bsk_on_path",
      runtimeOwned: true
    };
  }

  return {
    provider: "unavailable",
    reason: "no_supported_browser_provider"
  };
}

function commandExists(command) {
  const probe = process.platform === "win32" ? "where" : "sh";
  const args =
    process.platform === "win32"
      ? [command]
      : ["-lc", `command -v ${command} >/dev/null 2>&1`];

  const result = spawnSync(probe, args, { stdio: "ignore" });
  return result.status === 0;
}
