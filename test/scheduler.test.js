import assert from "node:assert/strict";
import test from "node:test";

import { dispatchMonitor } from "../scheduler/worker.js";

test("external scheduler dispatches the production monitor workflow", async () => {
  const calls = [];
  const fetchImplementation = async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 204 });
  };

  assert.deepEqual(await dispatchMonitor("test-token", fetchImplementation), {
    status: 204,
  });
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/insolcy/lacemarket-ap-baby-monitor/actions/workflows/monitor.yml/dispatches",
  );
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    ref: "main",
    inputs: { dry_run: false },
  });
});

test("external scheduler fails without a GitHub token", async () => {
  await assert.rejects(() => dispatchMonitor(""), /Missing GITHUB_TOKEN/);
});

test("external scheduler reports GitHub failures without exposing its token", async () => {
  const fetchImplementation = async () =>
    new Response("unauthorized", {
      status: 401,
      headers: { "x-github-request-id": "request-123" },
    });

  await assert.rejects(
    () => dispatchMonitor("super-secret-token", fetchImplementation),
    (error) => {
      assert.match(error.message, /status=401/);
      assert.match(error.message, /request-123/);
      assert.doesNotMatch(error.message, /super-secret-token/);
      return true;
    },
  );
});
