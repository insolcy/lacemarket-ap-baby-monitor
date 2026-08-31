import {
  CloudflareChallengeError,
  ProxyConnectionError,
} from "./navigation.js";

export const DEFAULT_OUTAGE_FAILURE_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function getConnectivityOutageKind(error) {
  if (error instanceof ProxyConnectionError) {
    return "proxy-unavailable";
  }
  if (error instanceof CloudflareChallengeError) {
    return "cloudflare-blocked";
  }
  return null;
}

export function recordConnectivityOutage(
  state,
  kind,
  now = new Date(),
  failureIntervalMs = DEFAULT_OUTAGE_FAILURE_INTERVAL_MS,
) {
  const checkedAt = now.toISOString();
  const previous = state.connectivityOutage;
  const sameOutage = previous?.kind === kind;
  const previousReportAt = Date.parse(previous?.lastFailureReportedAt || "");
  const reportIsFresh =
    sameOutage &&
    Number.isFinite(previousReportAt) &&
    now.getTime() - previousReportAt < failureIntervalMs;

  if (reportIsFresh) {
    return false;
  }

  state.connectivityOutage = {
    kind,
    startedAt: sameOutage && previous.startedAt ? previous.startedAt : checkedAt,
    lastFailureReportedAt: checkedAt,
  };
  return true;
}

export function clearConnectivityOutage(state) {
  const previous = state.connectivityOutage || null;
  delete state.connectivityOutage;
  return previous;
}
