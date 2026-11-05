import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { createBridgeServer } from "./server.mjs";

const apiKey = "transport-test-key-" + "x".repeat(43);
async function fixture(t, overrides = {}) {
  const logs = [];
  const calls = [];
  const tools = Object.fromEntries(["listRepositories", "listFiles", "readFile", "writeFile", "gitRead", "gitWrite"].map(name => [
    name, async args => { calls.push({ name, args }); return { ok: true, tool: name, args }; }
  ]));
  Object.assign(tools, overrides);
  const server = await createBridgeServer({
    config: { port: 3210, apiKey, repositories: [{ id: "test", path: os.tmpdir() }] },
    repositoryTools: tools,
    logger: entry => logs.push(entry)
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  async function request(endpoint, { body, headers = {}, method = body === undefined ? "GET" : "POST", authenticated = true, raw = false } = {}) {
    const response = await fetch(base + endpoint, {
      method,
      headers: { ...(authenticated ? { Authorization: "Bearer " + apiKey } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      ...(body === undefined ? {} : { body: raw ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(5000)
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { request, calls, logs, tools, server, base };
}
function mutation(extra = {}) {
  return { repository: "test", path: "file.txt", content: "content", expectedHash: "absent", requestId: randomUUID(), ...extra };
}
test("public health/schema disclose no repository configuration or API key", async t => {
  const f = await fixture(t);
  const health = await f.request("/healthz", { authenticated: false });
  const schema = await f.request("/openapi.json", { authenticated: false });
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(schema.status, 200);
  assert.equal(schema.body.openapi, "3.0.3");
  assert.equal(schema.body.components.securitySchemes.BearerAuth.scheme, "bearer");
  assert.deepEqual(schema.body.security, [{ BearerAuth: [] }]);
  const text = JSON.stringify([health.body, schema.body]);
  assert.equal(text.includes(apiKey), false);
  assert.equal(text.includes(os.tmpdir()), false);
  assert.equal(f.calls.length, 0);
});
test("every tool requires exact bearer authentication and browser requests are denied", async t => {
  const f = await fixture(t);
  for (const headers of [{}, { Authorization: "Bearer wrong" }, { Authorization: apiKey }]) {
    const result = await f.request("/api/repositories", { authenticated: false, headers });
    assert.equal(result.status, 401);
    assert.equal(result.headers.get("www-authenticate"), "Bearer");
  }
  const good = await f.request("/api/repositories");
  assert.equal(good.status, 200);
  assert.equal(good.headers.get("cache-control"), "no-store");
  assert.equal(good.headers.get("access-control-allow-origin"), null);
  for (const endpoint of ["/healthz", "/openapi.json", "/api/repositories"]) {
    assert.equal((await f.request(endpoint, { headers: { Origin: "https://evil.example" } })).status, 403);
  }
  assert.equal(f.calls.length, 1);
  assert.equal(JSON.stringify(f.logs).includes(apiKey), false);
});
test("unknown methods, paths and query strings cannot reach tools", async t => {
  const f = await fixture(t);
  for (const [endpoint, method] of [["/api/repositories?path=secret", "GET"], ["/api/files/read", "GET"], ["/api/repositories", "DELETE"], ["/unknown", "GET"]]) {
    assert.equal((await f.request(endpoint, { method })).status, 404);
  }
  assert.equal(f.calls.length, 0);
});
test("invalid JSON, body types, content types, extra fields and oversize requests fail before execution", async t => {
  const f = await fixture(t);
  for (const body of ["{broken", "[]", "null", '"text"']) {
    assert.equal((await f.request("/api/files/read", { body, raw: true })).status, 400);
  }
  assert.equal((await f.request("/api/files/read", { body: {}, headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await f.request("/api/files/read", { body: { repository: "test", path: "file.txt", unexpected: true } })).status, 400);
  assert.equal((await f.request("/api/files/read", { body: { content: "x".repeat(260 * 1024) } })).status, 413);
  assert.equal(f.calls.length, 0);
});
test("read requests are executed independently with their arguments", async t => {
  const f = await fixture(t);
  const args = { repository: "test", path: "source.js", offset: 12, limit: 50 };
  for (let i = 0; i < 2; i++) assert.equal((await f.request("/api/files/read", { body: args })).status, 200);
  assert.deepEqual(f.calls, [{ name: "readFile", args }, { name: "readFile", args }]);
});
test("mutations require a UUID and duplicate concurrent requests execute exactly once", async t => {
  let resolveOperation;
  let callCount = 0;
  const pending = new Promise(resolve => { resolveOperation = resolve; });
  const f = await fixture(t, { writeFile: async args => { callCount++; assert.equal("requestId" in args, false); return pending; } });
  for (const requestId of [undefined, "bad-id", "", 123]) {
    assert.equal((await f.request("/api/files/write", { body: mutation({ requestId }) })).status, 400);
  }
  const body = mutation();
  const first = f.request("/api/files/write", { body });
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  const second = f.request("/api/files/write", { body: reordered });
  await new Promise(resolve => setTimeout(resolve, 30));
  resolveOperation({ hash: "done", written: true });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal(callCount, 1);
  assert.equal((await f.request("/api/files/write", { body })).status, 200);
  assert.equal(callCount, 1);
});
test("request IDs cannot be reused across different content or operation routes", async t => {
  const f = await fixture(t);
  const body = mutation();
  assert.equal((await f.request("/api/files/write", { body })).status, 200);
  assert.equal((await f.request("/api/files/write", { body: { ...body, content: "different" } })).status, 409);
  assert.equal((await f.request("/api/git/write", { body: { repository: "test", operation: "commit", message: "hello", requestId: body.requestId } })).status, 409);
  assert.equal(f.calls.length, 1);
});
test("failed mutations are cached and internal errors do not leak secret details", async t => {
  let count = 0;
  const f = await fixture(t, { gitWrite: async () => { count++; throw new Error("internal " + apiKey); } });
  const body = { repository: "test", operation: "commit", message: "message", requestId: randomUUID() };
  const first = await f.request("/api/git/write", { body });
  const second = await f.request("/api/git/write", { body });
  assert.equal(first.status, 500);
  assert.equal(second.status, 500);
  assert.equal(count, 1);
  assert.equal(JSON.stringify([first, second, f.logs]).includes(apiKey), false);
});
test("real HTTP bridge reads, edits and commits a temporary repository exactly once", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "copilot-http-git-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const exec = promisify(execFile);
  async function git(...args) {
    return (await exec("git", ["-C", directory, ...args], { windowsHide: true })).stdout.trim();
  }
  await git("init", "--initial-branch=feature/http-test");
  await git("config", "user.name", "Bridge Test");
  await git("config", "user.email", "bridge-test@example.invalid");
  await git("config", "commit.gpgsign", "false");
  await fs.writeFile(path.join(directory, "code.js"), "export const value = 1;\n");
  await git("add", "--", "code.js");
  await git("commit", "-m", "Initial test fixture");
  const server = await createBridgeServer({
    config: { port: 3210, apiKey, repositories: [{ id: "fixture", path: directory, allowWrite: true, allowGitWrite: true, allowPush: false }] }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = "http://127.0.0.1:" + server.address().port;
  async function post(endpoint, data) {
    const response = await fetch(base + endpoint, {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ repository: "fixture", ...data }),
      signal: AbortSignal.timeout(10000)
    });
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    return result;
  }
  const before = await post("/api/files/read", { path: "code.js" });
  assert.equal(before.content, "export const value = 1;\n");
  const written = await post("/api/files/write", {
    path: "code.js", expectedHash: before.hash, content: "export const value = 2;\n", requestId: randomUUID()
  });
  assert.notEqual(written.hash, before.hash);
  const diff = await post("/api/git/read", { operation: "diff", path: "code.js" });
  assert.match(diff.output, /\+export const value = 2/);
  await post("/api/git/write", { operation: "stage", paths: ["code.js"], requestId: randomUUID() });
  const commit = { operation: "commit", message: "Change value over HTTP", requestId: randomUUID() };
  const first = await post("/api/git/write", commit);
  const duplicate = await post("/api/git/write", commit);
  assert.deepEqual(duplicate, first);
  assert.equal(await git("rev-list", "--count", "HEAD"), "2");
  assert.equal(await git("status", "--porcelain"), "");
  assert.equal(await fs.readFile(path.join(directory, "code.js"), "utf8"), "export const value = 2;\n");
});

test("expected operation failures preserve useful status codes", async t => {
  const f = await fixture(t, { readFile: async () => { throw Object.assign(new Error("File changed"), { status: 409 }); } });
  const result = await f.request("/api/files/read", { body: { repository: "test", path: "x" } });
  assert.equal(result.status, 409);
  assert.deepEqual(result.body, { error: "File changed" });
});
