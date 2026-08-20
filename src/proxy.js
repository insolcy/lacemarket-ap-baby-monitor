import { randomInt } from "node:crypto";

const sessionAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const sessionPattern = /_session-[A-Za-z0-9]+(?=_|$)/i;
const lifetimePattern = /_lifetime-/i;

export function createIPRoyalSessionId(randomInteger = randomInt) {
  return Array.from(
    { length: 8 },
    () => sessionAlphabet[randomInteger(sessionAlphabet.length)],
  ).join("");
}

export function withIPRoyalSession(password, sessionId) {
  if (!password) {
    throw new Error("IPRoyal session rotation requires PROXY_PASSWORD");
  }

  if (!/^[A-Za-z0-9]{8}$/.test(sessionId)) {
    throw new Error("IPRoyal session ID must contain exactly 8 letters or digits");
  }

  const sessionParameter = `_session-${sessionId}`;
  if (sessionPattern.test(password)) {
    return password.replace(sessionPattern, sessionParameter);
  }

  if (lifetimePattern.test(password)) {
    return password.replace(lifetimePattern, `${sessionParameter}_lifetime-`);
  }

  const separator = password.endsWith("_") ? "" : "_";
  return `${password}${separator}session-${sessionId}_lifetime-1h`;
}
