export class CloudflareChallengeError extends Error {
  constructor(message) {
    super(message);
    this.name = "CloudflareChallengeError";
  }
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
