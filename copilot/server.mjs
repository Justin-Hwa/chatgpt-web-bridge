import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { createRepositoryTools } from "./tools.mjs";
import { createOpenApi } from "./openapi.mjs";
import { validateConfig } from "./config.mjs";

const MAX_BODY = 256 * 1024;
const routes = new Map([
  ["GET /api/repositories", "listRepositories"],
  ["POST /api/files/list", "listFiles"],
  ["POST /api/files/read", "readFile"],
  ["POST /api/files/write", "writeFile"],
  ["POST /api/git/read", "gitRead"],
  ["POST /api/git/write", "gitWrite"]
]);
const mutations = new Set(["writeFile", "gitWrite"]);
const allowedFields = {
  listFiles: ["repository", "path", "offset", "limit"],
  readFile: ["repository", "path", "offset", "limit"],
  writeFile: ["repository", "path", "content", "expectedHash", "requestId"],
  gitRead: ["repository", "operation", "path", "staged", "revision"],
  gitWrite: ["repository", "operation", "paths", "branch", "message", "remote", "requestId"]
};
function fail(status, message) { return Object.assign(new Error(message), { status }); }
function digest(value) { return createHash("sha256").update(value).digest(); }
function authorized(req, apiKey) {
  const supplied = req.headers.authorization;
  return typeof supplied === "string" && supplied.length <= 256 && timingSafeEqual(digest(supplied), digest("Bearer " + apiKey));
}
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] ?? "")) throw fail(415, "Use application/json.");
  if (Number(req.headers["content-length"]) > MAX_BODY) throw fail(413, "Request body too large.");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY) throw fail(413, "Request body too large.");
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw fail(400, "Invalid JSON."); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail(400, "Body must be a JSON object.");
  return body;
}
export async function createBridgeServer({ config, repositoryTools, logger = () => {} }) {
  validateConfig(config);
  const repoTools = repositoryTools ?? await createRepositoryTools(config);
  // Keep outcomes (including failures) for this process lifetime. Never evict a mutation
  // and accidentally execute a delayed duplicate. Restart requires inspecting state.
  const requests = new Map();
  const server = http.createServer(async (req, res) => {
    const route = routes.get(req.method + " " + req.url);
    const send = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(value));
      logger({ method: req.method, route: route ?? "public-or-unknown", status });
    };
    try {
      // No browser origin is accepted. Copilot's server-to-server plugin sends no Origin.
      if (req.headers.origin) throw fail(403, "Browser-origin requests are not accepted.");
      if (req.method === "GET" && req.url === "/healthz") return send(200, { ok: true, service: "copilot-local-repository-bridge", version: "0.2.0" });
      if (req.method === "GET" && req.url === "/openapi.json") return send(200, createOpenApi("http://127.0.0.1:" + config.port));
      if (!authorized(req, config.apiKey)) { res.setHeader("WWW-Authenticate", "Bearer"); throw fail(401, "Unauthorized."); }
      if (!route) throw fail(404, "Unknown endpoint or method.");
      const body = req.method === "POST" ? await readBody(req) : {};
      if (allowedFields[route] && Object.keys(body).some(k => !allowedFields[route].includes(k))) throw fail(400, "Unknown request field.");
      let promise;
      if (mutations.has(route)) {
        if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId)) throw fail(400, "Mutation requestId must be a UUID.");
        const canonical = Object.fromEntries(Object.keys(body).sort().map(k => [k, body[k]]));
        const fingerprint = digest(route + JSON.stringify(canonical)).toString("hex");
        const previous = requests.get(body.requestId);
        if (previous && previous.fingerprint !== fingerprint) throw fail(409, "requestId already belongs to a different request.");
        if (previous) promise = previous.promise;
        else {
          if (requests.size >= 1000) throw fail(503, "Mutation ledger full. Finish pending requests, inspect repository state, then restart the bridge.");
          const { requestId, ...args } = body;
          promise = Promise.resolve().then(() => repoTools[route](args));
          requests.set(requestId, { fingerprint, promise });
        }
      } else promise = repoTools[route](body);
      return send(200, await promise);
    } catch (error) {
      const status = [400, 401, 403, 404, 409, 413, 415, 422, 503, 504].includes(error.status) ? error.status : 500;
      return send(status, { error: status === 500 ? "Operation failed. Inspect local repository state before retrying." : error.message });
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.setTimeout(30_000, socket => socket.destroy());
  return server;
}
