import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRepositoryTools } from './tools.mjs';

const exec = promisify(execFile);
async function fixture(t, overrides = {}) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'copilot-tools-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'repo');
  await fs.mkdir(root);
  const git = async (...args) => (await exec('git', ['-C', root, ...args], { windowsHide: true })).stdout;
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'Bridge Test');
  await git('config', 'user.email', 'bridge-test@example.invalid');
  await git('config', 'commit.gpgsign', 'false');
  await git('config', 'core.autocrlf', 'false');
  await fs.writeFile(path.join(root, 'hello.txt'), 'original\n');
  await git('add', 'hello.txt');
  await git('commit', '-m', 'initial');
  const tools = await createRepositoryTools({ repositories: [{ id: 'demo', path: root, allowWrite: true, allowGitWrite: true, ...overrides }] });
  return { base, root, tools, git, args: { repository: 'demo' } };
}

test('lists only configured ids and no absolute paths', async t => {
  const { root, tools } = await fixture(t);
  const result = await tools.listRepositories();
  assert.equal(result.repositories[0].id, 'demo');
  assert.equal(JSON.stringify(result).includes(root), false);
  await assert.rejects(tools.readFile({ repository: 'elsewhere', path: 'hello.txt' }), { status: 404 });
});

test('refuses exposing the bridge config even under a custom filename', async t => {
  const { root } = await fixture(t);
  const configFilePath = path.join(root, 'innocent-settings.json');
  await fs.writeFile(configFilePath, '{"token":"not-for-the-model"}');
  await assert.rejects(createRepositoryTools({ configFilePath, repositories: [{ id: 'demo', path: root }] }), { status: 403 });
});

test('read and optimistic write preserve edits and reject stale/repeated writes', async t => {
  const { tools, args } = await fixture(t);
  const old = await tools.readFile({ ...args, path: 'hello.txt' });
  const written = await tools.writeFile({ ...args, path: 'hello.txt', expectedHash: old.hash, content: 'changed\n' });
  assert.notEqual(written.hash, old.hash);
  assert.equal((await tools.readFile({ ...args, path: 'hello.txt' })).content, 'changed\n');
  await assert.rejects(tools.writeFile({ ...args, path: 'hello.txt', expectedHash: old.hash, content: 'stale' }), { status: 409 });
  await assert.rejects(tools.writeFile({ ...args, path: 'hello.txt', expectedHash: 'absent', content: 'overwrite' }), { status: 409 });
});

test('creates a new file with parent directories and prevents lost concurrent writes', async t => {
  const { tools, args } = await fixture(t);
  const calls = ['one', 'two'].map(content => tools.writeFile({ ...args, path: 'nested/deeper/new.txt', expectedHash: 'absent', content }));
  const results = await Promise.allSettled(calls);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected')[0].reason.status, 409);
});

test('pages UTF8 content with a stable full-file hash', async t => {
  const { tools, args, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'long.txt'), '中'.repeat(13000));
  const first = await tools.readFile({ ...args, path: 'long.txt' });
  const second = await tools.readFile({ ...args, path: 'long.txt', offset: first.nextOffset });
  assert.equal(first.content.length, 12000);
  assert.equal(first.truncated, true);
  assert.equal(second.content.length, 1000);
  assert.equal(second.hash, first.hash);
  await assert.rejects(tools.readFile({ ...args, path: 'long.txt', offset: -1 }), { status: 400 });
});

test('rejects binary, oversized and non-UTF8 files', async t => {
  const { tools, args, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'big.txt'), 'x'.repeat(128 * 1024 + 1));
  await fs.writeFile(path.join(root, 'binary.txt'), Buffer.from([0, 1, 2]));
  await fs.writeFile(path.join(root, 'invalid.txt'), Buffer.from([0xff]));
  await assert.rejects(tools.readFile({ ...args, path: 'big.txt' }), { status: 413 });
  await assert.rejects(tools.readFile({ ...args, path: 'binary.txt' }), { status: 415 });
  await assert.rejects(tools.readFile({ ...args, path: 'invalid.txt' }), { status: 415 });
});

test('rejects traversal, absolute paths, Windows aliases and sensitive paths', async t => {
  const { tools, args } = await fixture(t);
  for (const name of ['../outside', '/outside', 'C:/outside', 'a\\b', 'a/../b', '.git/config', '.GIT/config', '.env', '.env.local', 'secret.pem', 'id_rsa', 'copilot.local.json', 'file:stream', 'file.', 'file ', 'NUL.txt', 'COM1', 'a//b', 'LONGNA~1/a']) {
    await assert.rejects(tools.writeFile({ ...args, path: name, expectedHash: 'absent', content: 'x' }), `should reject ${name}`);
    await assert.rejects(tools.readFile({ ...args, path: name }), `should reject ${name}`);
  }
});

test('listing omits sensitive entries and supports limits', async t => {
  const { tools, args, root } = await fixture(t);
  await fs.writeFile(path.join(root, '.env'), 'SECRET=not-exposed');
  await fs.writeFile(path.join(root, 'second.txt'), 'text');
  const listed = await tools.listFiles(args);
  assert.deepEqual(listed.entries.map(e => e.name), ['hello.txt', 'second.txt']);
  const limited = await tools.listFiles({ ...args, limit: 1 });
  assert.equal(limited.entries.length, 1);
  assert.equal(limited.truncated, true);
  const next = await tools.listFiles({ ...args, limit: 1, offset: limited.nextOffset });
  assert.equal(next.entries[0].name, 'second.txt');
  assert.equal(next.truncated, false);
  assert.equal(next.totalEntries, 2);
});

test('rejects symlink/junction ancestors and leaves external content untouched', async t => {
  const { tools, args, base, root } = await fixture(t);
  const outside = path.join(base, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'secret.txt'), 'external');
  try { await fs.symlink(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Platform denied symlink creation'); return; } throw error; }
  await assert.rejects(tools.readFile({ ...args, path: 'linked/secret.txt' }), { status: 403 });
  await assert.rejects(tools.writeFile({ ...args, path: 'linked/new.txt', expectedHash: 'absent', content: 'bad' }), { status: 403 });
  assert.equal(await fs.readFile(path.join(outside, 'secret.txt'), 'utf8'), 'external');
  assert.equal((await tools.listFiles(args)).entries.some(e => e.name === 'linked'), false);
});

test('rejects hard-linked files', async t => {
  const { tools, args, base, root } = await fixture(t);
  const outside = path.join(base, 'outside.txt');
  await fs.writeFile(outside, 'external');
  await fs.link(outside, path.join(root, 'hard.txt'));
  await assert.rejects(tools.readFile({ ...args, path: 'hard.txt' }), { status: 403 });
  await assert.rejects(tools.writeFile({ ...args, path: 'hard.txt', expectedHash: 'absent', content: 'bad' }), { status: 403 });
});

test('read-only configuration rejects file and Git writes', async t => {
  const { tools, args } = await fixture(t, { allowWrite: false, allowGitWrite: false });
  await assert.rejects(tools.writeFile({ ...args, path: 'new.txt', expectedHash: 'absent', content: 'x' }), { status: 403 });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'createBranch', branch: 'feature/no' }), { status: 403 });
});

test('protects main; creates feature branch, stages, commits and shows real diff', async t => {
  const { tools, args } = await fixture(t);
  await assert.rejects(tools.gitWrite({ ...args, operation: 'stage', paths: ['hello.txt'] }), { status: 403 });
  await tools.gitWrite({ ...args, operation: 'createBranch', branch: 'feature/test' });
  const old = await tools.readFile({ ...args, path: 'hello.txt' });
  await tools.writeFile({ ...args, path: 'hello.txt', expectedHash: old.hash, content: 'new value\n' });
  assert.match((await tools.gitRead({ ...args, operation: 'diff' })).output, /new value/u);
  await tools.gitWrite({ ...args, operation: 'stage', paths: ['hello.txt'] });
  assert.match((await tools.gitRead({ ...args, operation: 'diff', staged: true })).output, /new value/u);
  await tools.gitWrite({ ...args, operation: 'commit', message: 'change hello' });
  assert.match((await tools.gitRead({ ...args, operation: 'log' })).output, /change hello/u);
  assert.equal((await tools.gitRead({ ...args, operation: 'show', path: 'hello.txt', revision: 'HEAD~1' })).output, 'original\n');
  await assert.rejects(tools.gitWrite({ ...args, operation: 'push' }), { status: 403 });
});

test('dirty checkout refuses switch, branch creation and pull', async t => {
  const { tools, args, root } = await fixture(t);
  await fs.writeFile(path.join(root, 'hello.txt'), 'dirty');
  for (const operation of ['switch', 'createBranch', 'pull']) await assert.rejects(tools.gitWrite({ ...args, operation, branch: 'feature/no' }), { status: 409 });
});

test('no destructive/arbitrary Git commands or option injection', async t => {
  const { tools, args } = await fixture(t);
  for (const operation of ['reset', 'clean', 'stash', 'shell', 'merge', 'rebase']) await assert.rejects(tools.gitWrite({ ...args, operation }), { status: 400 });
  await assert.rejects(tools.gitRead({ ...args, operation: 'show', revision: '--output=/tmp/leak' }), { status: 400 });
  await assert.rejects(tools.gitRead({ ...args, operation: 'show', revision: 'HEAD:.env' }), { status: 400 });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'fetch', remote: 'https://example.invalid/repo' }), { status: 400 });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'switch', branch: '--detach' }), { status: 400 });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'switch', branch: '@{-1}' }), { status: 400 });
});

test('Git diff cannot disclose blocked file content', async t => {
  const { tools, args, root, git } = await fixture(t);
  await fs.writeFile(path.join(root, '.env'), 'SECRET=initial');
  await git('add', '.env'); await git('commit', '-m', 'fixture secret');
  await fs.writeFile(path.join(root, '.env'), 'SECRET=changed');
  await fs.writeFile(path.join(root, 'hello.txt'), 'normal change');
  const diff = await tools.gitRead({ ...args, operation: 'diff' });
  assert.match(diff.output, /normal change/u);
  assert.equal(diff.output.includes('SECRET'), false);
  await assert.rejects(tools.gitRead({ ...args, operation: 'show', path: '.env' }), { status: 403 });
});

test('stage accepts explicit deleted files and rejects directories', async t => {
  const { tools, args, root } = await fixture(t);
  await tools.gitWrite({ ...args, operation: 'createBranch', branch: 'feature/delete' });
  await fs.mkdir(path.join(root, 'folder'));
  await fs.writeFile(path.join(root, 'folder', 'tracked.txt'), 'tracked');
  await tools.gitWrite({ ...args, operation: 'stage', paths: ['folder/tracked.txt'] });
  await tools.gitWrite({ ...args, operation: 'commit', message: 'track nested fixture' });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'stage', paths: ['folder'] }), { status: 400 });
  await fs.rm(path.join(root, 'folder'), { recursive: true });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'stage', paths: ['folder'] }), { status: 400 });
  await fs.rm(path.join(root, 'hello.txt'));
  await tools.gitWrite({ ...args, operation: 'stage', paths: ['hello.txt'] });
  assert.match((await tools.gitRead({ ...args, operation: 'diff', staged: true })).output, /deleted file/u);
});

test('fetch, fast-forward pull and opted-in push work against local bare remote', async t => {
  const { tools, args, root, base, git } = await fixture(t, { allowPush: true });
  const remote = path.join(base, 'remote.git');
  await exec('git', ['init', '--bare', remote]);
  await git('remote', 'add', 'origin', remote);
  await git('push', '-u', 'origin', 'main');
  await tools.gitWrite({ ...args, operation: 'fetch' });
  await tools.gitWrite({ ...args, operation: 'pull' });
  await tools.gitWrite({ ...args, operation: 'createBranch', branch: 'feature/push' });
  await fs.writeFile(path.join(root, 'hello.txt'), 'push content');
  await tools.gitWrite({ ...args, operation: 'stage', paths: ['hello.txt'] });
  await tools.gitWrite({ ...args, operation: 'commit', message: 'push test' });
  await assert.rejects(tools.gitWrite({ ...args, operation: 'push', branch: 'main' }), { status: 409 });
  await tools.gitWrite({ ...args, operation: 'push' });
  const branches = (await exec('git', ['--git-dir', remote, 'branch'])).stdout;
  assert.match(branches, /feature\/push/u);
});
