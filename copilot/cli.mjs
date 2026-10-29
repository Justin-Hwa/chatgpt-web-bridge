#!/usr/bin/env node
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initializeConfig, loadConfig } from "./config.mjs";
import { createBridgeServer } from "./server.mjs";
import { generatePackage } from "./package.mjs";

function parse(args) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith("--") || !args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Expected --option value pairs.");
    const name = args[i].slice(2);
    if (name in result) throw new Error("Duplicate option: " + name);
    result[name] = args[i + 1];
  }
  return result;
}
export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  if (!command || ["help", "--help", "-h"].includes(command)) {
    console.log("Copilot local repository bridge\n  init --config copilot.local.json\n  serve --config copilot.local.json\n  doctor --config copilot.local.json\n  package --base-url https://YOUR-TUNNEL --registration-id ID --app-id UUID --output dist/copilot\nSee docs/COPILOT.zh-CN.md.");
    return;
  }
  const options = parse(rest);
  const allowed = command === "package" ? ["base-url", "registration-id", "app-id", "output"] : ["config"];
  if (Object.keys(options).some(key => !allowed.includes(key))) throw new Error("Unknown option.");
  const filename = options.config ?? "copilot.local.json";
  if (command === "init") {
    const result = await initializeConfig(filename);
    console.log("Created " + result.filename + "\nApp ID: " + result.appId + "\nSet repositories[].path before starting. The API key is in this private file; do not paste it into chat or Git.");
  } else if (command === "serve") {
    const config = await loadConfig(filename);
    const server = await createBridgeServer({ config, logger: entry => console.log(JSON.stringify(entry)) });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", resolve); });
    console.log("Copilot bridge listening at http://127.0.0.1:" + config.port + ". Use Ctrl+C to stop.");
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
  } else if (command === "doctor") {
    const config = await loadConfig(filename);
    const base = "http://127.0.0.1:" + config.port;
    for (const endpoint of ["/healthz", "/api/repositories"]) {
      const response = await fetch(base + endpoint, { headers: { Authorization: "Bearer " + config.apiKey }, signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(endpoint + " returned HTTP " + response.status);
      console.log(endpoint + ": " + JSON.stringify(await response.json()));
    }
  } else if (command === "package") {
    const result = await generatePackage({ baseUrl: options["base-url"], registrationId: options["registration-id"], appId: options["app-id"], outputDirectory: options.output ?? "dist/copilot" });
    console.log(JSON.stringify(result, null, 2));
  } else throw new Error("Unknown command: " + command);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
