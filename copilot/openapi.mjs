const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const repository = string("Configured repository ID from listRepositories; never an absolute path.");
const path = string("Repository-relative path using / separators.");
const requestId = string("A new UUID for this mutation. Reuse the SAME ID and identical body after a network timeout; never automatically resubmit with a new ID.");
const response = { description: "Tool result. Read actual output and truncation fields; do not invent success.", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } };
function operation(operationId, description, properties, required) {
  return {
    operationId, summary: operationId, description,
    ...(properties ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", additionalProperties: false, properties, required } } } } } : {}),
    responses: { "200": response, "400": { description: "Invalid input." }, "401": { description: "Missing or invalid bearer API key." }, "403": { description: "Operation disabled or path/branch protected." }, "409": { description: "File hash changed, dirty checkout, or request ID conflict. Re-read before proceeding." }, "413": { description: "Request or file is too large." }, "500": { description: "Operation failed; inspect repository state before retrying." } }
  };
}
export function createOpenApi(baseUrl) {
  return {
    openapi: "3.0.3",
    info: { title: "Copilot Local Repository Bridge", version: "0.2.0", description: "Read and edit explicitly configured local repositories and perform structured Git operations." },
    servers: [{ url: baseUrl.replace(/\/$/, "") }],
    security: [{ BearerAuth: [] }],
    components: { securitySchemes: { BearerAuth: { type: "http", scheme: "bearer" } } },
    paths: {
      "/api/repositories": { get: operation("listRepositories", "List configured repository IDs and enabled permissions. Call this before accessing files.", null) },
      "/api/files/list": { post: operation("listFiles", "List a directory in a configured repository. Follow nextOffset if truncated and directory entries to inspect source. Sensitive paths are excluded.", { repository, path, offset: { type: "integer", minimum: 0, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 200, default: 100 } }, ["repository"]) },
      "/api/files/read": { post: operation("readFile", "Read a UTF-8 file page and its full-file SHA256 hash. Offset and limit count JavaScript UTF-16 code units. Follow nextOffset while truncated; never overwrite a file using only one page.", { repository, path, offset: { type: "integer", minimum: 0, default: 0 }, limit: { type: "integer", minimum: 1, maximum: 12000, default: 12000 } }, ["repository", "path"]) },
      "/api/files/write": { post: operation("writeFile", "Create or replace one UTF-8 file. Read existing content first and send the returned full-file hash as expectedHash, or absent for a new file. Send complete new content, not a patch. Max 128 KiB. Only perform user-requested edits; inspect git diff afterward.", { repository, path, content: string("Complete replacement file contents."), expectedHash: string("SHA256 from readFile, or absent to create a new file."), requestId }, ["repository", "path", "content", "expectedHash", "requestId"]) },
      "/api/git/read": { post: operation("gitRead", "Run a structured Git inspection without a shell. Output may be truncated. status lists current changes; diff can limit to a path or staged changes; log shows recent commits; show inspects an allowed revision.", { repository, operation: string("Inspection operation.", { enum: ["status", "diff", "log", "show"] }), path, staged: { type: "boolean", default: false }, revision: string("Commit hash or simple ref. No Git options or shell syntax.") }, ["repository", "operation"]) },
      "/api/git/write": { post: operation("gitWrite", "Run an explicitly requested Git operation. Mutations require allowGitWrite; push also requires allowPush. Protected branches block stage/commit/push. Pull is fast-forward only. No reset, clean, rebase, merge, stash, force push or arbitrary shell. Verify status/diff first. After timeout reuse the same requestId; after server restart inspect state instead of retrying blindly.", { repository, operation: string("Git mutation.", { enum: ["fetch", "pull", "switch", "createBranch", "stage", "commit", "push"] }), paths: { type: "array", items: path, description: "Explicit paths for stage; never use all-files staging." }, branch: string("Branch name for switch/createBranch/push. Use a feature branch."), message: string("Commit message for commit."), remote: string("Existing remote name; defaults to origin. No URL.", { default: "origin" }), requestId }, ["repository", "operation", "requestId"]) }
    }
  };
}
