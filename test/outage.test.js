import assert from "node:assert/strict";
import test from "node:test";

import {
  clearConnectivityOutage,
  DEFAULT_OUTAGE_FAILURE_INTERVAL_MS,
  DEFAULT_OUTAGE_PROBE_INTERVAL_MS,
  getConnectivityOutageKind,
  recordConnectivityOutage,
  shouldProbeConnectivity,
} from "../src/outage.js";
import {
  CloudflareChallengeError,
  ProxyConnectionError,
} from "../src/navigation.js";

test("classifies only external connectivity failures as outages", () => {
  assert.equal(
    getConnectivityOutageKind(new ProxyConnectionError("tunnel failed")),
    "proxy-unavailable",
  );
  assert.equal(
    getConnectivityOutageKind(new CloudflareChallengeError("blocked")),
    "cloudflare-blocked",
  );
  assert.equal(getConnectivityOutageKind(new Error("parser bug")), null);
});

test("reports a connectivity outage once per interval", () => {
  const state = {};
  const startedAt = new Date("2026-08-29T14:13:13.000Z");

  assert.equal(
    recordConnectivityOutage(
      state,
      "proxy-unavailable",
      startedAt,
      DEFAULT_OUTAGE_FAILURE_INTERVAL_MS,
    ),
    true,
  );
  assert.deepEqual(state.connectivityOutage, {
    kind: "proxy-unavailable",
    startedAt: startedAt.toISOString(),
    lastFailureReportedAt: startedAt.toISOString(),
    lastProbeAt: startedAt.toISOString(),
  });

  assert.equal(
    recordConnectivityOutage(
      state,
      "proxy-unavailable",
      new Date("2026-08-30T14:13:12.999Z"),
      DEFAULT_OUTAGE_FAILURE_INTERVAL_MS,
    ),
    false,
  );
  assert.equal(
    state.connectivityOutage.lastFailureReportedAt,
    startedAt.toISOString(),
  );
  assert.equal(
    state.connectivityOutage.lastProbeAt,
    "2026-08-30T14:13:12.999Z",
  );

  const nextReportAt = new Date("2026-08-30T14:13:13.000Z");
  assert.equal(
    recordConnectivityOutage(
      state,
      "proxy-unavailable",
      nextReportAt,
      DEFAULT_OUTAGE_FAILURE_INTERVAL_MS,
    ),
    true,
  );
  assert.equal(
    state.connectivityOutage.lastFailureReportedAt,
    nextReportAt.toISOString(),
  );
  assert.equal(state.connectivityOutage.startedAt, startedAt.toISOString());
  assert.equal(state.connectivityOutage.lastProbeAt, nextReportAt.toISOString());
});

test("limits connectivity probes while an outage is active", () => {
  const lastProbeAt = new Date("2026-08-31T14:00:00.000Z");
  const state = {
    connectivityOutage: {
      kind: "proxy-unavailable",
      startedAt: "2026-08-31T13:00:00.000Z",
      lastFailureReportedAt: "2026-08-31T13:00:00.000Z",
      lastProbeAt: lastProbeAt.toISOString(),
    },
  };

  assert.equal(
    shouldProbeConnectivity(
      state,
      new Date("2026-08-31T14:59:59.999Z"),
      DEFAULT_OUTAGE_PROBE_INTERVAL_MS,
    ),
    false,
  );
  assert.equal(
    shouldProbeConnectivity(
      state,
      new Date("2026-08-31T15:00:00.000Z"),
      DEFAULT_OUTAGE_PROBE_INTERVAL_MS,
    ),
    true,
  );
  assert.equal(shouldProbeConnectivity({}, lastProbeAt), true);
});

test("a different outage kind reports immediately and recovery clears it", () => {
  const state = {
    connectivityOutage: {
      kind: "proxy-unavailable",
      startedAt: "2026-08-29T14:13:13.000Z",
      lastFailureReportedAt: "2026-08-31T14:31:29.000Z",
    },
  };

  const changedAt = new Date("2026-08-31T14:40:00.000Z");
  assert.equal(
    recordConnectivityOutage(state, "cloudflare-blocked", changedAt),
    true,
  );
  assert.equal(state.connectivityOutage.startedAt, changedAt.toISOString());
  assert.deepEqual(clearConnectivityOutage(state), {
    kind: "cloudflare-blocked",
    startedAt: changedAt.toISOString(),
    lastFailureReportedAt: changedAt.toISOString(),
    lastProbeAt: changedAt.toISOString(),
  });
  assert.equal("connectivityOutage" in state, false);
});
