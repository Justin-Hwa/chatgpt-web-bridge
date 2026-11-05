import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";

export function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Configuration must be an object.");
  if (typeof value.apiKey !== "string" || !/^[A-Za-z0-9_-]{43,128}$/.test(value.apiKey)) throw new Error("apiKey must be a random base64url secret of at least 43 characters. Use init.");
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error("port must be an integer between 1024 and 65535.");
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) throw new Error("Configure at least one repository.");
  const ids = new Set();
  for (const repo of value.repositories) {
    if (!repo || typeof repo.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(repo.id) || ids.has(repo.id)) throw new Error("Repository IDs must be unique simple names.");
    ids.add(repo.id);
    if (typeof repo.path !== "string" || !path.isAbsolute(repo.path)) throw new Error("Each repository needs an absolute path on this computer.");
    for (const key of ["allowWrite", "allowGitWrite", "allowPush"]) if (repo[key] !== undefined && typeof repo[key] !== "boolean") throw new Error(key + " must be boolean.");
    if (repo.protectedBranches !== undefined && (!Array.isArray(repo.protectedBranches) || !repo.protectedBranches.every(v => typeof v === "string" && v.length > 0))) throw new Error("protectedBranches must be a string array.");
  }
  return value;
}
export async function loadConfig(filename) {
  const config = validateConfig(JSON.parse(await fs.readFile(filename, "utf8")));
  Object.defineProperty(config, "configFilePath", { value: await fs.realpath(filename), enumerable: false });
  return config;
}
export async function initializeConfig(filename) {
  const config = {
    port: 3210,
    appId: randomUUID(),
    apiKey: randomBytes(32).toString("base64url"),
    repositories: [{ id: "my-project", path: "", allowWrite: true, allowGitWrite: true, allowPush: false, protectedBranches: ["main", "master", "release", "release2"] }]
  };
  await fs.writeFile(filename, JSON.stringify(config, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { filename: path.resolve(filename), appId: config.appId };
}
