import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/monitor.yml", import.meta.url);

test("queued monitor runs resolve the latest main branch before scanning", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const checkoutBlock = workflow.match(
    /- name: Check out repository([\s\S]*?)(?=\n\s+- name:)/,
  )?.[1];

  assert.ok(checkoutBlock, "checkout step must exist");
  assert.match(checkoutBlock, /uses: actions\/checkout@v\d+/);
  assert.match(checkoutBlock, /ref: main/);
  assert.match(checkoutBlock, /fetch-depth: 0/);
});

test("monitor runs remain serialized without cancelling an active scan", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(
    workflow,
    /concurrency:\s+group: lace-market-monitor\s+cancel-in-progress: false/,
  );
});
