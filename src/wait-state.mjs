import { createHash } from "node:crypto";

export const WaitState = Object.freeze({
  SUBMITTED: "submitted",
  GENERATING: "generating",
  STABLE_CANDIDATE: "stable_candidate",
  COMPLETE: "complete",
  BLOCKED: "blocked",
  TIMEOUT: "timeout"
});

export async function waitForCompletion({
  statusFn,
  readFn,
  timeoutMs = 10 * 60_000,
  pollMs = 1_500,
  stableMs = 3_000,
  onProgress = () => {},
  now = () => Date.now(),
  sleep = defaultSleep
}) {
  if (typeof statusFn !== "function") throw new TypeError("statusFn is required");
  if (typeof readFn !== "function") throw new TypeError("readFn is required");

  const started = now();
  let stableSince = null;
  let lastHash = null;
  let lastStatus = null;

  onProgress({ state: WaitState.SUBMITTED, elapsedMs: 0 });

  while (now() - started < timeoutMs) {
    const status = await statusFn();
    lastStatus = status;

    if (status?.blocker) {
      return {
        ok: false,
        state: WaitState.BLOCKED,
        blocker: status.blocker,
        submitted: true,
        resumable: Boolean(status.blocker?.resumable)
      };
    }

    const generating = status?.generationActive === true || status?.completionState === "generating";
    if (generating) {
      stableSince = null;
      lastHash = null;
      onProgress({ state: WaitState.GENERATING, elapsedMs: now() - started, preview: status?.latestAssistantText });
      await sleep(pollMs);
      continue;
    }

    const latest = await readFn();
    const text = extractText(latest);
    const hash = sha256(text);

    if (hash !== lastHash) {
      lastHash = hash;
      stableSince = now();
      onProgress({ state: WaitState.STABLE_CANDIDATE, elapsedMs: now() - started, chars: text.length });
      await sleep(Math.min(pollMs, stableMs));
      continue;
    }

    if (stableSince != null && now() - stableSince >= stableMs) {
      return {
        ok: true,
        state: WaitState.COMPLETE,
        submitted: true,
        resumable: false,
        elapsedMs: now() - started,
        text,
        raw: latest
      };
    }

    await sleep(pollMs);
  }

  return {
    ok: false,
    state: WaitState.TIMEOUT,
    submitted: true,
    resumable: true,
    elapsedMs: now() - started,
    lastStatus,
    instruction: "Resume by polling the same ChatGPT thread/turn; do not submit the same prompt again."
  };
}

function extractText(readResult) {
  if (typeof readResult === "string") return readResult;
  return readResult?.output_text ?? readResult?.data?.text ?? readResult?.data?.responseText ?? readResult?.text ?? "";
}

function sha256(value) {
  return createHash("sha256").update(value ?? "").digest("hex");
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
