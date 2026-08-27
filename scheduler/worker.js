const GITHUB_API_VERSION = "2026-03-10";
const WORKFLOW_DISPATCH_URL =
  "https://api.github.com/repos/insolcy/lacemarket-ap-baby-monitor/" +
  "actions/workflows/monitor.yml/dispatches";

export async function dispatchMonitor(githubToken, fetchImplementation = fetch) {
  if (!githubToken) {
    throw new Error("Missing GITHUB_TOKEN Worker secret");
  }

  const response = await fetchImplementation(WORKFLOW_DISPATCH_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${githubToken}`,
      "Content-Type": "application/json",
      "User-Agent": "LaceMarketMonitorScheduler/1.0",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
    body: JSON.stringify({
      ref: "main",
      inputs: { dry_run: false },
    }),
  });

  if (!response.ok) {
    const requestId = response.headers.get("x-github-request-id") || "unknown";
    throw new Error(
      `GitHub workflow dispatch failed ` +
        `(status=${response.status}, requestId=${requestId})`,
    );
  }

  return { status: response.status };
}

export default {
  async scheduled(_controller, env) {
    const result = await dispatchMonitor(env.GITHUB_TOKEN);
    console.log(`Dispatched Lace Market monitor (status=${result.status}).`);
  },

  async fetch() {
    return Response.json({
      service: "lacemarket-github-scheduler",
      schedule: "every 10 minutes",
      status: "ok",
    });
  },
};
