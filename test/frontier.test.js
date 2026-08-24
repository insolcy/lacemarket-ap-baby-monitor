import assert from "node:assert/strict";
import test from "node:test";

import { classifyListingDetails } from "../src/classification.js";
import { buildAlertEmail, buildRecipients } from "../src/email.js";
import {
  findCandidatesBeforeAnchor,
  hasNewListingBadge,
  isListingUrl,
  mergeSeen,
  uniqueListings,
} from "../src/frontier.js";
import { isUnitedStatesSellerLocation } from "../src/location.js";
import {
  CloudflareChallengeError,
  getRetryableProxyErrorCode,
  isChallengeResponse,
  ProxyConnectionError,
} from "../src/navigation.js";
import { createIPRoyalSessionId, withIPRoyalSession } from "../src/proxy.js";

test("recognizes real listing URLs and rejects search URLs", () => {
  assert.equal(isListingUrl("https://egl.circlly.com/auctions/new-dress"), true);
  assert.equal(isListingUrl("https://egl.circlly.com/auctions/search"), false);
  assert.equal(isListingUrl("https://example.com/auctions/new-dress"), false);
});

test("keeps listing order while preferring the longest title", () => {
  assert.deepEqual(
    uniqueListings([
      { title: "", url: "https://egl.circlly.com/auctions/one" },
      { title: "Dress One", url: "https://egl.circlly.com/auctions/one" },
      { title: "Dress Two", url: "https://egl.circlly.com/auctions/two" },
      { title: "Clear Search", url: "https://egl.circlly.com/auctions/search" },
    ]),
    [
      { title: "Dress One", url: "https://egl.circlly.com/auctions/one" },
      { title: "Dress Two", url: "https://egl.circlly.com/auctions/two" },
    ],
  );
});

test("only recognizes the site's exact New ribbon as a first-time listing", () => {
  assert.equal(hasNewListingBadge({ ribbonText: "New" }), true);
  assert.equal(hasNewListingBadge({ ribbonText: " NEW " }), true);
  assert.equal(hasNewListingBadge({ ribbonText: "-10%" }), false);
  assert.equal(hasNewListingBadge({ ribbonText: "Relisted" }), false);
  assert.equal(hasNewListingBadge({ ribbonText: "" }), false);
  assert.equal(hasNewListingBadge({}), false);
});

test("only treats URLs before the first known waterline URL as new", () => {
  const result = findCandidatesBeforeAnchor(
    [
      [
        { title: "New A", url: "https://egl.circlly.com/auctions/new-a" },
        { title: "New B", url: "https://egl.circlly.com/auctions/new-b" },
      ],
      [
        { title: "Old Anchor", url: "https://egl.circlly.com/auctions/anchor" },
        { title: "Older", url: "https://egl.circlly.com/auctions/older" },
      ],
    ],
    ["https://egl.circlly.com/auctions/anchor"],
    [],
  );

  assert.equal(result.anchorFound, true);
  assert.deepEqual(
    result.candidates.map((item) => item.url),
    ["https://egl.circlly.com/auctions/new-a", "https://egl.circlly.com/auctions/new-b"],
  );
});

test("returns no candidates when no known anchor is found", () => {
  const result = findCandidatesBeforeAnchor(
    [[{ title: "Unknown", url: "https://egl.circlly.com/auctions/unknown" }]],
    ["https://egl.circlly.com/auctions/anchor"],
    [],
  );

  assert.equal(result.anchorFound, false);
  assert.deepEqual(result.candidates, []);
});

test("merges seen URLs without duplicates", () => {
  assert.deepEqual(mergeSeen(["b", "c"], ["a", "b"]), ["a", "b", "c"]);
});

test("email includes listing details and clickable URLs", () => {
  const message = buildAlertEmail([
    {
      brandKey: "ap",
      title: "Test OP",
      price: "Buy It Now: $200",
      condition: "New Without Tag",
      sellerLocation: "USA",
      imageUrl: "https://d2ieorefj5ilau.cloudfront.net/uploads/test/thumb/dress.jpg",
      url: "https://egl.circlly.com/auctions/test-op",
    },
  ]);

  assert.match(message.subject, /1件/);
  assert.match(message.text, /Test OP/);
  assert.match(message.text, /https:\/\/egl\.circlly\.com\/auctions\/test-op/);
  assert.match(message.text, /图片：https:\/\/d2ieorefj5ilau\.cloudfront\.net\/uploads\/test\/thumb\/dress\.jpg/);
  assert.match(message.html, /href="https:\/\/egl\.circlly\.com\/auctions\/test-op"/);
  assert.match(
    message.html,
    /<img src="https:\/\/d2ieorefj5ilau\.cloudfront\.net\/uploads\/test\/thumb\/dress\.jpg"/,
  );
  assert.match(message.html, /alt="Test OP"/);
});

test("does not render unsafe image URLs", () => {
  const message = buildAlertEmail([
    {
      brandKey: "ap",
      title: "Unsafe Image Test",
      price: "$1",
      condition: "New",
      sellerLocation: "USA",
      imageUrl: "javascript:alert(1)",
      url: "https://egl.circlly.com/auctions/unsafe-image-test",
    },
  ]);

  assert.doesNotMatch(message.html, /<img/);
  assert.doesNotMatch(message.text, /javascript:/);
});

test("always emails the sender and adds configured recipients without duplicates", () => {
  assert.deepEqual(buildRecipients("owner@gmail.com", "joy@example.com, owner@gmail.com"), [
    "owner@gmail.com",
    "joy@example.com",
  ]);
});

test("recognizes US seller locations without matching shipping text", () => {
  assert.equal(isUnitedStatesSellerLocation("93003 USA"), true);
  assert.equal(isUnitedStatesSellerLocation("United States"), true);
  assert.equal(isUnitedStatesSellerLocation("California, U.S.A."), true);
  assert.equal(isUnitedStatesSellerLocation("(Tariff free shipping!) East Asia EastAsia"), false);
  assert.equal(isUnitedStatesSellerLocation("Tariff free shipping to the US available EastAsia"), false);
  assert.equal(isUnitedStatesSellerLocation("未提供"), false);
});

test("classifies explicit non-dress categories as skippable", () => {
  assert.equal(
    classifyListingDetails({
      brandText: "Angelic Pretty",
      categoryText: "Skirts",
      expectedBrand: "Angelic Pretty",
    }),
    "non-dress",
  );
});

test("keeps invalid brands and missing categories as hard validation failures", () => {
  assert.equal(
    classifyListingDetails({
      brandText: "Other Brand",
      categoryText: "Dresses > Jumperskirt",
      expectedBrand: "Angelic Pretty",
    }),
    "invalid-brand",
  );
  assert.equal(
    classifyListingDetails({
      brandText: "Angelic Pretty",
      categoryText: "未提供",
      expectedBrand: "Angelic Pretty",
    }),
    "missing-category",
  );
});

test("accepts the supported Lace Market dress subcategories", () => {
  for (const categoryText of ["Dresses", "Jumperskirt", "One Piece", "Salopette", "Strapless/Other"]) {
    assert.equal(
      classifyListingDetails({
        brandText: "Baby the Stars Shine Bright",
        categoryText,
        expectedBrand: "Baby the Stars Shine Bright",
      }),
      "dress",
    );
  }
});

test("recognizes Cloudflare block and rate-limit variants", () => {
  assert.equal(
    isChallengeResponse({ status: 429, title: "Just a moment...", url: "https://egl.circlly.com", bodyText: "" }),
    true,
  );
  assert.equal(
    isChallengeResponse({
      status: 403,
      title: "Attention Required! | Cloudflare",
      url: "https://egl.circlly.com",
      bodyText: "Sorry, you have been blocked",
    }),
    true,
  );
  assert.equal(
    isChallengeResponse({
      status: 200,
      title: "Just a moment...",
      url: "https://egl.circlly.com/?__cf_chl_rt_tk=token",
      bodyText: "",
    }),
    true,
  );
  assert.equal(
    isChallengeResponse({
      status: 200,
      title: "Angelic Pretty Dresses",
      url: "https://egl.circlly.com/angelic-pretty/dresses",
      bodyText: "Created Date ▼",
    }),
    false,
  );
});

test("recognizes transient Chromium proxy tunnel failures", () => {
  for (const code of [
    "ERR_TUNNEL_CONNECTION_FAILED",
    "ERR_PROXY_CONNECTION_FAILED",
  ]) {
    assert.equal(
      getRetryableProxyErrorCode(
        new Error(`page.goto: net::${code} at https://egl.circlly.com/angelic-pretty/dresses`),
      ),
      code,
    );
  }
});

test("does not rotate proxy sessions for unrelated navigation or configuration errors", () => {
  assert.equal(getRetryableProxyErrorCode(new Error("page.goto: Timeout 60000ms exceeded")), null);
  assert.equal(getRetryableProxyErrorCode(new Error("net::ERR_NAME_NOT_RESOLVED")), null);
  assert.equal(getRetryableProxyErrorCode(new Error("net::ERR_CONNECTION_RESET")), null);
  assert.equal(getRetryableProxyErrorCode(new Error("net::ERR_SOCKS_CONNECTION_FAILED")), null);
  assert.equal(getRetryableProxyErrorCode(new Error("net::ERR_PROXY_AUTH_UNSUPPORTED")), null);
  assert.equal(getRetryableProxyErrorCode(new Error("ERR_TUNNEL_CONNECTION_FAILED")), null);
  assert.equal(new ProxyConnectionError("failed").name, "ProxyConnectionError");
});

test("creates an eight-character alphanumeric IPRoyal session ID", () => {
  const values = [0, 1, 2, 3, 4, 5, 60, 61];
  const sessionId = createIPRoyalSessionId(() => values.shift());

  assert.equal(sessionId, "ABCDEF89");
  assert.match(sessionId, /^[A-Za-z0-9]{8}$/);
});

test("rotates only the IPRoyal session while preserving proxy options", () => {
  assert.equal(
    withIPRoyalSession(
      "secret_country-us_session-Old12345_lifetime-24h_streaming-1",
      "New67890",
    ),
    "secret_country-us_session-New67890_lifetime-24h_streaming-1",
  );
});

test("adds an IPRoyal session before an existing lifetime option", () => {
  assert.equal(
    withIPRoyalSession("secret_country-us_lifetime-24h", "Ab12Cd34"),
    "secret_country-us_session-Ab12Cd34_lifetime-24h",
  );
});

test("adds a one-hour lifetime when the IPRoyal password has no session options", () => {
  assert.equal(
    withIPRoyalSession("secret_country-us_", "Ab12Cd34"),
    "secret_country-us_session-Ab12Cd34_lifetime-1h",
  );
});

test("rejects invalid IPRoyal session IDs", () => {
  assert.throws(
    () => withIPRoyalSession("secret", "too-short"),
    /exactly 8 letters or digits/,
  );
  assert.equal(new CloudflareChallengeError("blocked").name, "CloudflareChallengeError");
});
