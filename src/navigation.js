export class CloudflareChallengeError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudflareChallengeError";
  }
}

export class ProxyConnectionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "ProxyConnectionError";
  }
}

const retryableProxyErrorPattern =
  /\bnet::(ERR_(?:TUNNEL_CONNECTION_FAILED|PROXY_CONNECTION_FAILED))\b/;

export function getRetryableProxyErrorCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.match(retryableProxyErrorPattern)?.[1].toUpperCase() || null;
}

export function isChallengeResponse({ status, title, url, bodyText }) {
  return (
    [403, 429, 503].includes(status) ||
    /Attention Required/i.test(title) ||
    /Just a moment/i.test(title) ||
    /Sorry, you have been blocked/i.test(bodyText) ||
    /__cf_chl_/i.test(url)
  );
}
