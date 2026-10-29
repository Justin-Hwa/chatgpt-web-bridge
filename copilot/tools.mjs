import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_FILE_BYTES = 128 * 1024;
const MAX_OUTPUT = 12000;
const DEFAULT_PROTECTED = ['main', 'master', 'release', 'release2'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
function fail(message, status = 400) { const error = new Error(message); error.status = status; throw error; }
function text(value, name, max = 4096) {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f]/u.test(value)) fail(`Invalid ${name}`);
  return value;
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`Expected integer from ${min} to ${max}`);
  return value;
}
function partsOf(value, allowRoot = false) {
  if (allowRoot && (value === undefined || value === '')) return [];
  text(value, 'relative path');
  if (path.isAbsolute(value) || /^[\\/]/u.test(value) || value.includes('\\') || value.includes(':')) fail('Use a repository-relative path with forward slashes');
  const parts = value.split('/');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /[. ]$/u.test(part) || /[<>"|?*]/u.test(part) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(part) || /~[0-9]/u.test(part)) fail('Invalid path component');
    if (blocked(part)) fail('This path is not exposed by the bridge', 403);
  }
  return parts;
}
function blocked(name) {
  return /^\.git$/iu.test(name) || /^\.env(?:\.|$)/iu.test(name) || /\.(pem|key|p12|pfx)$/iu.test(name) || /^(id_rsa|id_ed25519|id_ecdsa|copilot\.local\.json)$/iu.test(name);
}
function inside(root, target) { const relative = path.relative(root, target); return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)); }
async function inspect(root, relative, { rootAllowed = false, missing = false, createParents = false } = {}) {
  const parts = partsOf(relative, rootAllowed);
  let current = root;
  let stat = await fs.lstat(root);
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      if (i < parts.length - 1 && createParents) { await fs.mkdir(current); stat = await fs.lstat(current); }
      else if (missing) return { absolute: path.join(root, ...parts), stat: null };
      else fail('Path does not exist', 404);
    }
    if (stat.isSymbolicLink()) fail('Symbolic links and junctions are not exposed', 403);
    if (!inside(root, await fs.realpath(current))) fail('Path is outside the configured repository', 403);
    if (i < parts.length - 1 && !stat.isDirectory()) fail('A path parent is not a directory');
  }
  if (stat.isFile() && stat.nlink > 1) fail('Hard-linked files are not exposed', 403);
  return { absolute: current, stat };
}
function gitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_/u.test(key)) delete env[key];
  return { ...env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never', GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' };
}
async function git(root, args, { timeoutMs = 20000, maxBytes = 512 * 1024 } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', '-c', 'core.hooksPath=' + path.join(root, '.git', 'copilot-disabled-hooks'), '-C', root, ...args], { shell: false, windowsHide: true, env: gitEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = [], stderr = [], count = 0, failure;
    const stop = message => { failure ??= Object.assign(new Error(message), { status: 504 }); child.kill(); };
    const timer = setTimeout(() => stop('Git timed out; inspect repository status before retrying a write'), timeoutMs);
    for (const [stream, chunks] of [[child.stdout, stdout], [child.stderr, stderr]]) stream.on('data', chunk => { count += chunk.length; if (count > maxBytes) stop('Git output exceeded the limit; narrow the request'); else chunks.push(chunk); });
    child.on('error', error => { clearTimeout(timer); reject(Object.assign(new Error(error.code === 'ENOENT' ? 'Git is not installed or not on PATH' : 'Unable to start Git'), { status: 500 })); });
    child.on('close', code => {
      clearTimeout(timer);
      if (failure) { reject(failure); return; }
      if (code !== 0) { reject(Object.assign(new Error(`Git ${args[0]} failed (exit ${code}); inspect locally for details`), { status: 409 })); return; }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
function output(value) { return { output: value.slice(0, MAX_OUTPUT), truncated: value.length > MAX_OUTPUT }; }
function validateRevision(value = 'HEAD') {
  text(value, 'revision', 200);
  if (!/^(?:HEAD|[A-Za-z0-9][A-Za-z0-9_./-]*)(?:[~^][0-9]*)*$/u.test(value) || value.includes('..') || value.includes('@{') || value.endsWith('.lock')) fail('Invalid revision');
  return value;
}
async function readBytes(entry) {
  if (!entry.stat?.isFile()) fail('Expected a regular file');
  if (entry.stat.size > MAX_FILE_BYTES) fail('File exceeds 128 KiB; use local tools for larger files', 413);
  const bytes = await fs.readFile(entry.absolute);
  if (bytes.length > MAX_FILE_BYTES) fail('File exceeds 128 KiB', 413);
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('Only UTF-8 text files are supported', 415); }
  if (content.includes('\0')) fail('Binary files are not supported', 415);
  return { bytes, content, hash: sha256(bytes) };
}

export async function createRepositoryTools(config) {
  if (!Array.isArray(config?.repositories) || !config.repositories.length) fail('Configure at least one repository');
  const repos = new Map();
  const roots = new Set();
  for (const item of config.repositories) {
    const id = text(item.id, 'repository id', 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(id) || repos.has(id)) fail('Repository ids must be unique letters, digits, underscore or hyphen');
    if (typeof item.path !== 'string' || !path.isAbsolute(item.path)) fail('Repository path must be absolute');
    const root = await fs.realpath(item.path);
    if (config.configFilePath && inside(root, await fs.realpath(config.configFilePath))) fail('Move the bridge config outside every exposed repository before starting', 403);
    const rootKey = process.platform === 'win32' ? root.toLowerCase() : root;
    if (roots.has(rootKey)) fail('Do not register the same repository under multiple ids');
    roots.add(rootKey);
    if (!(await fs.stat(root)).isDirectory()) fail('Repository path must be a directory');
    const top = await git(root, ['rev-parse', '--show-toplevel']);
    if (await fs.realpath(top.trim()) !== root) fail('Register the Git working-tree root, not a subdirectory');
    const protectedBranches = item.protectedBranches ?? DEFAULT_PROTECTED;
    if (!Array.isArray(protectedBranches) || protectedBranches.some(branch => typeof branch !== 'string' || !branch)) fail('Invalid protectedBranches');
    repos.set(id, { id, root, allowWrite: item.allowWrite === true, allowGitWrite: item.allowGitWrite === true, allowPush: item.allowPush === true, protectedBranches, queue: Promise.resolve() });
  }
  function repo(args) { const value = repos.get(args?.repository); if (!value) fail('Unknown repository', 404); return value; }
  function serial(r, task) { const result = r.queue.then(task, task); r.queue = result.catch(() => {}); return result; }
  async function currentBranch(r) { const branch = (await git(r.root, ['branch', '--show-current'])).trim(); if (!branch) fail('Detached HEAD is read-only', 409); return branch; }
  async function writableBranch(r) { const branch = await currentBranch(r); if (r.protectedBranches.includes(branch)) fail('Switch to a feature branch before this operation', 403); return branch; }
  async function requireClean(r) { if ((await git(r.root, ['status', '--porcelain'])).trim()) fail('Working tree must be clean for this operation', 409); }
  async function branchName(r, value) {
    text(value, 'branch', 200);
    if (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(value) || value.includes('..')) fail('Use an explicit branch name');
    await git(r.root, ['check-ref-format', '--branch', value]);
    return value;
  }
  async function remoteName(r, value = 'origin') {
    text(value, 'remote', 80);
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u.test(value)) fail('Use a configured remote name, not a URL');
    if (!(await git(r.root, ['remote'])).split(/\r?\n/u).includes(value)) fail('Unknown configured Git remote');
    return value;
  }
  return {
    async listRepositories() { return { repositories: [...repos.values()].map(r => ({ id: r.id, allowWrite: r.allowWrite, allowGitWrite: r.allowGitWrite, allowPush: r.allowPush, protectedBranches: r.protectedBranches })) }; },
    async listFiles(args) {
      const r = repo(args);
      return serial(r, async () => {
        const entry = await inspect(r.root, args.path, { rootAllowed: true });
        if (!entry.stat.isDirectory()) fail('Expected a directory');
        const limit = integer(args.limit, 100, 1, 200);
        const entries = [];
        for (const name of (await fs.readdir(entry.absolute)).sort()) {
          const relative = args.path ? `${args.path}/${name}` : name;
          try { const child = await inspect(r.root, relative); if (child.stat.isDirectory() || child.stat.isFile()) entries.push({ name, path: relative, type: child.stat.isDirectory() ? 'directory' : 'file' }); }
          catch (error) { if (![400, 403, 404].includes(error.status)) throw error; }
        }
        const offset = integer(args.offset, 0, 0, entries.length);
        const nextOffset = Math.min(offset + limit, entries.length);
        return { entries: entries.slice(offset, nextOffset), offset, nextOffset, totalEntries: entries.length, truncated: nextOffset < entries.length };
      });
    },
    async readFile(args) {
      const r = repo(args);
      return serial(r, async () => {
        const value = await readBytes(await inspect(r.root, args.path));
        const offset = integer(args.offset, 0, 0, value.content.length);
        const limit = integer(args.limit, MAX_OUTPUT, 1, MAX_OUTPUT);
        const nextOffset = Math.min(offset + limit, value.content.length);
        return { path: args.path, content: value.content.slice(offset, nextOffset), hash: value.hash, offset, nextOffset, totalChars: value.content.length, truncated: nextOffset < value.content.length };
      });
    },
    async writeFile(args) {
      const r = repo(args);
      return serial(r, async () => {
        if (!r.allowWrite) fail('File writes are disabled for this repository', 403);
        if (typeof args.content !== 'string' || args.content.includes('\0')) fail('content must be UTF-8 text');
        if (Buffer.byteLength(args.content) > MAX_FILE_BYTES) fail('File exceeds 128 KiB', 413);
        if (args.expectedHash !== 'absent' && !/^[a-f0-9]{64}$/u.test(args.expectedHash ?? '')) fail('expectedHash must be the hash returned by readFile, or absent for a new file');
        let entry = await inspect(r.root, args.path, { missing: true });
        if (entry.stat) {
          const previous = await readBytes(entry);
          if (args.expectedHash !== previous.hash) fail('File changed; read it again before writing', 409);
        } else if (args.expectedHash !== 'absent') fail('File is absent; read/list again before writing', 409);
        entry = await inspect(r.root, args.path, { missing: true, createParents: true });
        const temporary = path.join(path.dirname(entry.absolute), `.copilot-${randomUUID()}.tmp`);
        try {
          await fs.writeFile(temporary, args.content, { flag: 'wx', mode: entry.stat ? entry.stat.mode & 0o777 : 0o600 });
          const latest = await inspect(r.root, args.path, { missing: true });
          if (latest.stat) {
            if ((await readBytes(latest)).hash !== args.expectedHash) fail('File changed while preparing the write; read it again', 409);
          } else if (args.expectedHash !== 'absent') fail('File disappeared while preparing the write', 409);
          await fs.rename(temporary, entry.absolute);
        } finally { await fs.rm(temporary, { force: true }); }
        return { path: args.path, hash: sha256(Buffer.from(args.content)), bytes: Buffer.byteLength(args.content) };
      });
    },
    async gitRead(args) {
      const r = repo(args);
      return serial(r, async () => {
        if (args.staged !== undefined && typeof args.staged !== 'boolean') fail('staged must be boolean');
        if (args.path !== undefined) await inspect(r.root, args.path, { missing: true });
        switch (args.operation) {
          case 'status': return output(await git(r.root, ['status', '--short', '--branch']));
          case 'log': return output(await git(r.root, ['log', '-20', '--format=%h %s']));
          case 'show': {
            const revision = validateRevision(args.revision);
            if (args.path === undefined) return output(await git(r.root, ['show', '--no-patch', '--format=fuller', revision]));
            return output(await git(r.root, ['show', `${revision}:${args.path}`]));
          }
          case 'diff': {
            const base = ['diff', '--no-ext-diff', '--no-textconv', ...(args.staged ? ['--cached'] : [])];
            const names = (await git(r.root, [...base, '--name-only', '-z', '--', ...(args.path ? [args.path] : [])])).split('\0').filter(Boolean);
            const safe = [];
            for (const name of names) { try { await inspect(r.root, name, { missing: true }); safe.push(name); } catch (error) { if (![400, 403].includes(error.status)) throw error; } }
            return safe.length ? output(await git(r.root, [...base, '--', ...safe])) : { output: '', truncated: false };
          }
          default: fail('Unknown read-only Git operation');
        }
      });
    },
    async gitWrite(args) {
      const r = repo(args);
      return serial(r, async () => {
        if (!r.allowGitWrite) fail('Git writes are disabled for this repository', 403);
        let result;
        switch (args.operation) {
          case 'fetch': result = await git(r.root, ['fetch', '--', await remoteName(r, args.remote)]); break;
          case 'pull': {
            await requireClean(r);
            const branch = await currentBranch(r);
            result = await git(r.root, ['pull', '--ff-only', '--no-rebase', '--', await remoteName(r, args.remote), branch]); break;
          }
          case 'switch': await requireClean(r); result = await git(r.root, ['switch', '--', await branchName(r, args.branch)]); break;
          case 'createBranch': await requireClean(r); result = await git(r.root, ['switch', '-c', await branchName(r, args.branch)]); break;
          case 'stage': {
            await writableBranch(r);
            if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 100) fail('Provide 1 to 100 explicit file paths');
            for (const name of args.paths) {
              const entry = await inspect(r.root, name, { missing: true });
              if (entry.stat && !entry.stat.isFile()) fail('Stage explicit files, not directories');
              if (!entry.stat) {
                const tracked = (await git(r.root, ['ls-files', '-z', '--', name])).split('\0').filter(Boolean);
                if (tracked.length !== 1 || tracked[0] !== name) fail('A deleted stage path must identify exactly one tracked file');
              }
            }
            result = await git(r.root, ['add', '--', ...args.paths]); break;
          }
          case 'commit': await writableBranch(r); text(args.message, 'commit message', 1000); result = await git(r.root, ['commit', '-m', args.message]); break;
          case 'push': {
            if (!r.allowPush) fail('Push is disabled; enable allowPush locally to opt in', 403);
            const branch = await writableBranch(r);
            if (args.branch !== undefined && args.branch !== branch) fail('Push only supports the current branch; switch explicitly first', 409);
            result = await git(r.root, ['push', '--', await remoteName(r, args.remote), `refs/heads/${branch}:refs/heads/${branch}`]); break;
          }
          default: fail('Unknown Git write operation');
        }
        return { ...output(result), branch: await currentBranch(r) };
      });
    }
  };
}
