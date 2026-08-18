import assert from "node:assert/strict";
import test from "node:test";

import { buildAlertEmail } from "../src/email.js";
import { findCandidatesBeforeAnchor, isListingUrl, mergeSeen, uniqueListings } from "../src/frontier.js";
import { isChallengeResponse } from "../src/navigation.js";

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
      url: "https://egl.circlly.com/auctions/test-op",
    },
  ]);

  assert.match(message.subject, /1件/);
  assert.match(message.text, /Test OP/);
  assert.match(message.text, /https:\/\/egl\.circlly\.com\/auctions\/test-op/);
  assert.match(message.html, /href="https:\/\/egl\.circlly\.com\/auctions\/test-op"/);
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
