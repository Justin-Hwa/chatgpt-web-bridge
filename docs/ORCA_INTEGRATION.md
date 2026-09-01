# ORCA Integration

## Goal

Support:

```text
ORCA
  ├─ Codex CLI or OMP  -> local executor
  └─ built-in browser  -> visible ChatGPT consultation channel
```

without requiring Codex Desktop.

## Important distinction

`codex-chatgpt-control` can directly use:

- `globalThis.agent`,
- an injected compatible `BrowserLike`,
- or other host-provided JS browser objects.

An ORCA browser may instead be exposed as **Agent tool calls**. Tool calls are not automatically a JavaScript `BrowserLike`.

Therefore v0.1 does not fake an adapter.

## v0.1 host-tool mode

The Skill itself instructs Codex/OMP how to use ORCA's browser tools:

```text
local investigate
  -> decide consultation is useful
  -> build consultation prompt
  -> use ORCA browser
  -> submit once to ChatGPT
  -> observe/wait
  -> read stable answer
  -> return to local repository
  -> verify / implement / test
```

## Required ORCA browser capabilities

Minimum useful capability set:

- open or select a tab
- navigate to `https://chatgpt.com`
- inspect visible page/controls/text
- enter text
- click Send
- wait/re-observe
- read latest assistant output
- preserve or recover the current conversation URL/tab

## Preferred future adapter

If ORCA exposes a stable JS API, implement a `BrowserLike` adapter matching the subset used by `codex-chatgpt-control`:

```ts
type BrowserLike = {
  tabs?: {
    create?: (url: string) => Promise<PageLike>
    selected?: () => Promise<PageLike | undefined>
    list?: () => Promise<PageLike[]>
    get?: (id: string) => Promise<PageLike>
  }
}

type PageLike = {
  url?: () => string | Promise<string>
  goto?: (url: string) => Promise<unknown>
  locator?: (selector: string) => LocatorLike
  getByRole?: (...) => LocatorLike
  getByText?: (...) => LocatorLike
  evaluate?: (...) => Promise<unknown>
  waitForTimeout?: (ms: number) => Promise<void>
}
```

Once ORCA exposes these semantics reliably, the adapter should be preferred so ChatGPT DOM semantics remain centralized in `codex-chatgpt-control`.

## Do not add BrowserSkill unnecessarily

If ORCA's own browser can already operate the user's signed-in ChatGPT session, prefer it.

BrowserSkill is a fallback for ordinary Codex CLI or other shell environments without a usable host browser.
