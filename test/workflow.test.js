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

test("native schedule is only an hourly fallback to the ten-minute worker", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /cron: "3 \* \* \* \*"/);
  assert.doesNotMatch(workflow, /3,13,23,33,43,53/);
});

test("connectivity outage state is persisted even when the scan fails", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const persistBlock = workflow.match(
    /- name: Persist monitor state([\s\S]*?)$/,
  )?.[1];

  assert.ok(persistBlock, "persist step must exist");
  assert.match(persistBlock, /if:.*always\(\)/);
  assert.match(workflow, /OUTAGE_FAILURE_INTERVAL_HOURS: "24"/);
});

test("production proxy retries and outage probes are bandwidth bounded", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /MAX_PROXY_ROTATIONS: "2"/);
  assert.match(workflow, /OUTAGE_PROBE_INTERVAL_MINUTES: "60"/);
});

test("full-flow test sends email without persisting monitor state", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const persistBlock = workflow.match(
    /- name: Persist monitor state([\s\S]*?)$/,
  )?.[1];

  assert.match(workflow, /full_test:/);
  assert.match(workflow, /FULL_TEST:.*inputs\.full_test/);
  assert.match(persistBlock, /!inputs\.full_test/);
});
