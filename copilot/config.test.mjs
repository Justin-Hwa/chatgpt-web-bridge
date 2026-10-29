import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { initializeConfig, loadConfig, validateConfig } from "./config.mjs";

function valid() {
  return { port: 3210, apiKey: "a".repeat(43), repositories: [{ id: "fixture", path: path.resolve(os.tmpdir()), allowWrite: true, allowGitWrite: false, allowPush: false, protectedBranches: ["main"] }] };
}
async function temporary(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-config-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test("init creates independent private secrets and returns no API key", async t => {
  const dir = await temporary(t);
  const firstFile = path.join(dir, "one.json");
  const secondFile = path.join(dir, "two.json");
  const first = await initializeConfig(firstFile);
  await initializeConfig(secondFile);
  const a = JSON.parse(await fs.readFile(firstFile, "utf8"));
  const b = JSON.parse(await fs.readFile(secondFile, "utf8"));
  assert.match(a.apiKey, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.apiKey, b.apiKey);
  assert.notEqual(a.appId, b.appId);
  assert.equal(first.appId, a.appId);
  assert.equal(first.filename, firstFile);
  assert.equal(JSON.stringify(first).includes(a.apiKey), false);
  assert.equal(a.repositories[0].allowPush, false);
  assert.deepEqual(a.repositories[0].protectedBranches, ["main", "master", "release", "release2"]);
  if (process.platform !== "win32") assert.equal((await fs.stat(firstFile)).mode & 0o777, 0o600);
});
test("init refuses to overwrite an existing config", async t => {
  const file = path.join(await temporary(t), "existing.json");
  await fs.writeFile(file, "already present");
  await assert.rejects(initializeConfig(file), { code: "EEXIST" });
  assert.equal(await fs.readFile(file, "utf8"), "already present");
});
test("fresh config requires an explicit local repository before loading", async t => {
  const file = path.join(await temporary(t), "config.json");
  await initializeConfig(file);
  await assert.rejects(loadConfig(file), /absolute path/);
  const cfg = JSON.parse(await fs.readFile(file, "utf8"));
  cfg.repositories[0].path = os.tmpdir();
  await fs.writeFile(file, JSON.stringify(cfg));
  assert.deepEqual(await loadConfig(file), cfg);
});
test("configuration validates ports, credentials and repository allowlist", () => {
  assert.equal(validateConfig(valid()).repositories[0].id, "fixture");
  for (const value of [null, [], "text"]) assert.throws(() => validateConfig(value), /object/);
  for (const port of [0, 80, 65536, 3210.5, "3210"]) assert.throws(() => validateConfig({ ...valid(), port }), /port/);
  for (const apiKey of ["", "short", "a".repeat(129), " ".repeat(43), "a".repeat(42) + "\n"]) assert.throws(() => validateConfig({ ...valid(), apiKey }), /apiKey/);
  for (const repositories of [[], null, "repo", [{ id: "bad/id", path: os.tmpdir() }], [{ id: "x", path: "relative" }]]) {
    assert.throws(() => validateConfig({ ...valid(), repositories }));
  }
  const duplicate = valid();
  duplicate.repositories.push({ ...duplicate.repositories[0] });
  assert.throws(() => validateConfig(duplicate), /unique/);
  for (const key of ["allowWrite", "allowGitWrite", "allowPush"]) {
    const cfg = valid();
    cfg.repositories[0][key] = "false";
    assert.throws(() => validateConfig(cfg), /boolean/);
  }
  for (const protectedBranches of ["main", [""], [false]]) {
    const cfg = valid();
    cfg.repositories[0].protectedBranches = protectedBranches;
    assert.throws(() => validateConfig(cfg), /protectedBranches/);
  }
});
