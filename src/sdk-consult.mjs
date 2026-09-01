import { createChatGPT } from "codex-chatgpt-control";
import { assertNoObviousSecrets } from "./prompt-builder.mjs";
import { waitForCompletion } from "./wait-state.mjs";

/**
 * Consult ChatGPT through a codex-chatgpt-control compatible browser bridge.
 * Submit exactly once, then poll the same assistant turn.
 */
export async function consultWithSdk({
  prompt,
  agent = globalThis.agent,
  browser,
  thread = { type: "new" },
  experience = "chat",
  configuration,
  timeoutMs = 10 * 60_000,
  pollMs = 1_500,
  stableMs = 3_000,
  onProgress
}) {
  assertNoObviousSecrets(prompt);

  const chatgpt = createChatGPT({
    ...(browser ? { browser } : {}),
    ...(agent ? { agent } : {}),
    reporting: { enabled: true, includeContent: false }
  });

  const submit = await chatgpt.ask({
    prompt,
    thread,
    experience,
    ...(configuration ? { configuration } : {}),
    wait: false,
    read: false,
    report: { enabled: true, includeContent: false }
  });

  if (!submit.ok) {
    return {
      ok: false,
      phase: "submit",
      result: submit,
      submitted: false,
      resumable: submit?.blocker?.resumable ?? false
    };
  }

  const waited = await waitForCompletion({
    timeoutMs,
    pollMs,
    stableMs,
    onProgress,
    statusFn: async () => {
      const result = await chatgpt.messages.status({ maxPreviewChars: 800 });
      if (!result.ok) {
        return {
          blocker: result.blocker ?? {
            kind: "unknown",
            message: result.error?.message ?? "Unable to inspect ChatGPT generation status.",
            resumable: true
          }
        };
      }
      return result.data ?? result;
    },
    readFn: async () => chatgpt.messages.readLatest({ role: "assistant", format: "markdown" })
  });

  return {
    ...waited,
    phase: waited.ok ? "complete" : "wait",
    submit
  };
}
