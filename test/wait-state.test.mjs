import test from "node:test";
import assert from "node:assert/strict";
import {
  WaitState,
  waitForCompletion
} from "../src/wait-state.mjs";

test("waits through generation then requires stability", async () => {
  let clock = 0;
  let poll = 0;

  const statuses = [
    { generationActive: true, completionState: "generating" },
    { generationActive: false, completionState: "complete" },
    { generationActive: false, completionState: "complete" }
  ];

  const result = await waitForCompletion({
    statusFn: async () => statuses[Math.min(poll++, statuses.length - 1)],
    readFn: async () => ({ data: { text: "final answer" } }),
    timeoutMs: 100,
    pollMs: 5,
    stableMs: 5,
    now: () => clock,
    sleep: async (ms) => { clock += ms; }
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, WaitState.COMPLETE);
  assert.equal(result.text, "final answer");
});

test("timeout is resumable and never implies resubmit", async () => {
  let clock = 0;

  const result = await waitForCompletion({
    statusFn: async () => ({
      generationActive: true,
      completionState: "generating"
    }),
    readFn: async () => "",
    timeoutMs: 10,
    pollMs: 5,
    stableMs: 5,
    now: () => clock,
    sleep: async (ms) => { clock += ms; }
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, WaitState.TIMEOUT);
  assert.equal(result.submitted, true);
  assert.equal(result.resumable, true);
  assert.match(result.instruction, /same ChatGPT thread/i);
});
