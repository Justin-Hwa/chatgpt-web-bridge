import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { crc32, createPackageFiles, createZip, generatePackage, validateBaseUrl } from "./package.mjs";

const options = {
  baseUrl: "https://repo-4813.jpe.devtunnels.ms",
  registrationId: "test-registration-id",
  appId: "96f8db62-8ddc-4e37-bab1-73182df7e743"
};

test("package rejects local, insecure, credential-bearing, or ambiguous service URLs", () => {
  for (const value of [
    "http://repo.example.com", "https://localhost", "https://127.0.0.1", "https://[::1]",
    "https://10.2.3.4", "https://repo.local", "https://repo.internal",
    "https://repo.example.com/path", "https://repo.example.com?token=secret",
    "https://repo.example.com/#fragment", "https://secret@repo.example.com",
    "https://repo.example.com:8443", "https://repo", "not a URL", undefined
  ]) assert.throws(() => validateBaseUrl(value), /public HTTPS origin/);
  assert.equal(validateBaseUrl(options.baseUrl + "/"), options.baseUrl);
});

test("package validates registration IDs and stable app UUIDs before generating", () => {
  assert.throws(() => createPackageFiles({ ...options, registrationId: "" }), /registrationId/);
  assert.throws(() => createPackageFiles({ ...options, registrationId: "Bearer secret" }), /registrationId/);
  assert.throws(() => createPackageFiles({ ...options, appId: "not-a-uuid" }), /appId/);
});

test("package references are complete and only the vault registration ID is embedded", () => {
  const files = createPackageFiles(options);
  assert.equal(files.size, 6);
  const parse = path => JSON.parse(files.get(path).toString());
  const app = parse("manifest.json");
  const agent = parse(app.copilotAgents.declarativeAgents[0].file);
  const plugin = parse(agent.actions[0].file);
  const runtime = plugin.runtimes[0];
  const api = parse(runtime.spec.url);
  assert.equal(app.id, options.appId);
  assert.deepEqual(app.validDomains, [new URL(options.baseUrl).hostname]);
  assert.equal(runtime.type, "OpenApi");
  assert.deepEqual(runtime.auth, { type: "ApiKeyPluginVault", reference_id: options.registrationId });
  assert.equal(api.servers[0].url, options.baseUrl);
  assert.ok(files.has(app.icons.color));
  assert.ok(files.has(app.icons.outline));
  const operations = Object.values(api.paths).flatMap(path =>
    Object.values(path).filter(value => value && typeof value === "object").map(value => value.operationId).filter(Boolean));
  const functions = plugin.functions.map(item => item.name);
  assert.deepEqual(functions, ["listRepositories", "listFiles", "readFile", "writeFile", "gitRead", "gitWrite"]);
  assert.deepEqual(runtime.run_for_functions, functions);
  for (const name of functions) assert.ok(operations.includes(name), name);
  for (const value of files.values()) {
    const text = value.toString();
    assert.ok(!text.includes("copilot.local.json"));
    assert.ok(!text.includes("C:\\work"));
  }
  assert.ok(agent.instructions.length <= 8000);
  assert.ok(app.name.short.length <= 30);
  assert.ok(app.description.short.length <= 80);
  assert.ok(plugin.name_for_human.length <= 20);
});

test("PNG icons have valid checksums, proper sizes and a transparent outline", () => {
  const files = createPackageFiles(options);
  for (const [name, size] of [["color.png", 192], ["outline.png", 32]]) {
    const bytes = files.get(name);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    let position = 8;
    let compressed;
    while (position < bytes.length) {
      const length = bytes.readUInt32BE(position);
      const type = bytes.toString("ascii", position + 4, position + 8);
      const data = bytes.subarray(position + 8, position + 8 + length);
      assert.equal(bytes.readUInt32BE(position + 8 + length), crc32(bytes.subarray(position + 4, position + 8 + length)));
      if (type === "IHDR") {
        assert.equal(data.readUInt32BE(0), size);
        assert.equal(data.readUInt32BE(4), size);
        assert.equal(data[9], 6);
      }
      if (type === "IDAT") compressed = data;
      position += 12 + length;
    }
    const rgba = inflateSync(compressed);
    assert.equal(rgba.length, size * (size * 4 + 1));
    assert.equal(rgba[4], name === "outline.png" ? 0 : 255);
  }
});

function inspectZip(bytes) {
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let central = bytes.readUInt32LE(end + 16);
  assert.equal(central + directorySize, end);
  const extracted = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(bytes.readUInt32LE(central), 0x02014b50);
    const nameLength = bytes.readUInt16LE(central + 28);
    const name = bytes.toString("utf8", central + 46, central + 46 + nameLength);
    const offset = bytes.readUInt32LE(central + 42);
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50);
    assert.equal(bytes.readUInt16LE(offset + 8), 0);
    const localNameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const length = bytes.readUInt32LE(offset + 22);
    const start = offset + 30 + localNameLength + extraLength;
    const content = bytes.subarray(start, start + length);
    assert.equal(bytes.toString("utf8", offset + 30, offset + 30 + localNameLength), name);
    assert.equal(crc32(content), bytes.readUInt32LE(offset + 14));
    assert.equal(crc32(content), bytes.readUInt32LE(central + 16));
    assert.equal(length, bytes.readUInt32LE(central + 24));
    extracted.set(name, content);
    central += 46 + nameLength + bytes.readUInt16LE(central + 30) + bytes.readUInt16LE(central + 32);
  }
  return extracted;
}

test("ZIP round-trips all package entries and has consistent local/central records", () => {
  const files = createPackageFiles(options);
  const zip = createZip(files);
  const extracted = inspectZip(zip);
  assert.deepEqual([...extracted.keys()], [...files.keys()]);
  for (const [name, bytes] of files) assert.deepEqual(extracted.get(name), bytes);
  assert.deepEqual(createZip(files), zip);
  assert.equal(crc32(Buffer.from("123456789")), 0xcbf43926);
});

test("generator writes a ready-to-upload ZIP without an extra top-level folder", async () => {
  const directory = await mkdtemp(join(tmpdir(), "copilot-package-test-"));
  try {
    const result = await generatePackage({ ...options, outputDirectory: directory });
    const extracted = inspectZip(await readFile(result.zipPath));
    assert.ok(extracted.has("manifest.json"));
    assert.ok([...extracted.keys()].every(path => !path.includes("/")));
    for (const name of result.files) assert.deepEqual(await readFile(join(directory, name)), extracted.get(name));
    await assert.rejects(generatePackage({ ...options }), /outputDirectory/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
