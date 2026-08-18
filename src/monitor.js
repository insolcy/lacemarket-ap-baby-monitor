import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import nodemailer from "nodemailer";
import { chromium } from "playwright";

import { buildAlertEmail, buildRecipients } from "./email.js";
import { findCandidatesBeforeAnchor, mergeSeen, uniqueListings } from "./frontier.js";
import { isUnitedStatesSellerLocation } from "./location.js";
import { isChallengeResponse } from "./navigation.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const statePath = process.env.STATE_PATH || path.join(projectRoot, "data", "state.json");
const dryRun = process.env.DRY_RUN === "true";
const headless = process.env.HEADLESS !== "false";
const maxPages = Number.parseInt(process.env.MAX_SCAN_PAGES || "10", 10);
const navigationRetries = Number.parseInt(process.env.NAVIGATION_RETRIES || "3", 10);
const minimumNavigationIntervalMs = Number.parseInt(
  process.env.MIN_NAVIGATION_INTERVAL_MS || "10000",
  10,
);
let lastNavigationAt = 0;

const brands = {
  ap: {
    label: "Angelic Pretty",
    url: "https://egl.circlly.com/angelic-pretty/dresses",
  },
  baby: {
    label: "Baby the Stars Shine Bright",
    url: "https://egl.circlly.com/baby-the-stars-shine-bright/dresses",
  },
};

const blockedThirdPartyHosts = [
  "criteo.com",
  "doubleclick.net",
  "freestar.com",
  "google-analytics.com",
  "googleadservices.com",
  "googlesyndication.com",
  "googletagmanager.com",
];

function shouldBlockResource(request) {
  if (["font", "image", "media"].includes(request.resourceType())) {
    return true;
  }

  const hostname = new URL(request.url()).hostname;
  return blockedThirdPartyHosts.some(
    (blockedHost) => hostname === blockedHost || hostname.endsWith(`.${blockedHost}`),
  );
}

function requireProductionEnvironment() {
  if (dryRun) {
    return;
  }

  const missing = ["SMTP_USER", "SMTP_APP_PASSWORD"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

async function loadState() {
  return JSON.parse(await fs.readFile(statePath, "utf8"));
}

async function saveState(state) {
  const temporaryPath = `${statePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, statePath);
}

async function waitForNavigationSlot(page) {
  const jitterMs = Math.floor(Math.random() * 2_500);
  const elapsedMs = Date.now() - lastNavigationAt;
  const waitMs = minimumNavigationIntervalMs + jitterMs - elapsedMs;
  if (waitMs > 0) {
    await page.waitForTimeout(waitMs);
  }
}

async function gotoWithRetry(page, url, label, validatePage) {
  let lastError;

  for (let attempt = 1; attempt <= navigationRetries; attempt += 1) {
    try {
      await waitForNavigationSlot(page);
      const response = await page.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });
      lastNavigationAt = Date.now();
      const title = await page.title();
      const bodyText = await page.locator("body").innerText({ timeout: 20_000 });
      const status = response?.status();
      const finalUrl = page.url();
      if (isChallengeResponse({ status, title, url: finalUrl, bodyText })) {
        const rayId = response?.headers()["cf-ray"] || "unknown";
        throw new Error(
          `${label}: Cloudflare challenge (status=${status ?? "unknown"}, title=${JSON.stringify(title)}, url=${finalUrl}, cf-ray=${rayId})`,
        );
      }

      await validatePage?.(page, bodyText);

      return bodyText;
    } catch (error) {
      lastError = error;
      if (attempt < navigationRetries) {
        await page.waitForTimeout(attempt * 20_000);
      }
    }
  }

  throw lastError;
}

async function assertUsableListingPage(page, brand, bodyText) {

  const heading = await page.locator("h1").first().innerText({ timeout: 20_000 });
  if (!heading.includes(brand.label) || !heading.includes("Dresses")) {
    throw new Error(`${brand.label}: unexpected listing page heading: ${heading}`);
  }

  if (!/Created Date\s*▼/.test(bodyText)) {
    throw new Error(`${brand.label}: listing order is not confirmed as Created Date descending`);
  }
}

async function readListingPage(page, url, brand) {
  await gotoWithRetry(page, url, brand.label, (currentPage, bodyText) =>
    assertUsableListingPage(currentPage, brand, bodyText),
  );
  await page.locator('a[href*="/auctions/"]').first().waitFor({ state: "attached", timeout: 20_000 });

  const rawListings = await page.locator('a[href*="/auctions/"]').evaluateAll((anchors) =>
    anchors.map((anchor) => ({
      title: (anchor.textContent || "").replace(/\s+/g, " ").trim(),
      url: anchor.href,
    })),
  );
  const listings = uniqueListings(rawListings);
  if (listings.length === 0) {
    throw new Error(`${brand.label}: no listing links found`);
  }

  const nextLink = page.getByRole("link", { name: "Next →", exact: true });
  const nextUrl = (await nextLink.count()) > 0 ? await nextLink.first().getAttribute("href") : null;
  return {
    listings,
    nextUrl: nextUrl ? new URL(nextUrl, page.url()).href : null,
  };
}

async function scanBrand(context, brandKey, brand, brandState) {
  const page = await context.newPage();
  const pages = [];
  let nextUrl = brand.url;

  try {
    for (let pageNumber = 1; pageNumber <= maxPages && nextUrl; pageNumber += 1) {
      const result = await readListingPage(page, nextUrl, brand);
      pages.push(result.listings);

      const detection = findCandidatesBeforeAnchor(pages, brandState.frontier, brandState.seen);
      if (detection.anchorFound) {
        return {
          brandKey,
          candidates: detection.candidates,
          frontier: pages[0].map((listing) => listing.url),
          pagesScanned: pageNumber,
        };
      }

      nextUrl = result.nextUrl;
    }
  } finally {
    await page.close();
  }

  throw new Error(`${brand.label}: no known waterline URL found within ${maxPages} pages`);
}

async function readLabelledText(page, selector, label) {
  const element = page.locator(selector).filter({ hasText: new RegExp(`^\\s*${label}:?\\s*$`, "i") }).first();
  if ((await element.count()) === 0) {
    return "未提供";
  }

  const value = await element.evaluate((node) => {
    const chunks = [];
    for (let sibling = node.nextSibling; sibling; sibling = sibling.nextSibling) {
      if (sibling.nodeType === 1 && sibling.nodeName === "HR") {
        break;
      }

      const text = sibling.textContent?.replace(/\s+/g, " ").trim();
      if (text) {
        chunks.push(text);
      }
    }
    return chunks.join(" ");
  });
  return value.trim() || "未提供";
}

async function readListingDetails(context, candidate, brandKey, brand) {
  const page = await context.newPage();

  try {
    await gotoWithRetry(page, candidate.url, candidate.url, async (currentPage) => {
      await currentPage.locator("h2").first().waitFor({ state: "visible", timeout: 20_000 });
      await currentPage.locator("strong").filter({ hasText: /^\s*Brand:\s*$/i }).first().waitFor({
        state: "visible",
        timeout: 20_000,
      });
    });

    const title = (await page.locator("h2").first().innerText({ timeout: 20_000 })).trim();
    const brandText = await readLabelledText(page, "strong", "Brand");
    const categoryText = await readLabelledText(page, "strong", "Category");
    const isDressCategory = /Dresses|Jumperskirt|One Piece|Salopette|Strapless(?:\/Other)?/i.test(
      categoryText,
    );
    if (!brandText.toLowerCase().includes(brand.label.toLowerCase()) || !isDressCategory) {
      throw new Error(
        `${candidate.url}: detail page brand/category validation failed ` +
          `(brand=${JSON.stringify(brandText)}, category=${JSON.stringify(categoryText)})`,
      );
    }

    const condition = await readLabelledText(page, "strong", "Condition");
    const sellerLocation = await readLabelledText(page, "h5", "Seller location");
    const priceTexts = await page.locator("a, button").evaluateAll((elements) =>
      elements
        .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
        .filter((text) => /Buy It Now|Current Bid|Bidding/i.test(text)),
    );

    return {
      brandKey,
      brand: brand.label,
      title: title || candidate.title || "未命名商品",
      price: priceTexts[0] || "请查看商品页面",
      condition,
      sellerLocation,
      url: candidate.url,
    };
  } finally {
    await page.close();
  }
}

async function sendAlert(listings) {
  const mail = buildAlertEmail(listings);
  const smtpPort = Number.parseInt(process.env.SMTP_PORT || "465", 10);
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_APP_PASSWORD.replace(/\s/g, ""),
    },
  });

  await transporter.sendMail({
    from: `Lace Market Monitor <${process.env.SMTP_USER}>`,
    to: buildRecipients(process.env.SMTP_USER, process.env.ALERT_EMAIL),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
}

async function main() {
  requireProductionEnvironment();
  const state = await loadState();
  const proxy = process.env.PROXY_SERVER
    ? {
        server: process.env.PROXY_SERVER,
        ...(process.env.PROXY_USERNAME ? { username: process.env.PROXY_USERNAME } : {}),
        ...(process.env.PROXY_PASSWORD ? { password: process.env.PROXY_PASSWORD } : {}),
      }
    : undefined;
  const browser = await chromium.launch({
    headless,
    ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
    ...(proxy ? { proxy } : {}),
  });
  const context = await browser.newContext({
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  });
  await context.route("**/*", async (route) => {
    if (shouldBlockResource(route.request())) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });

  try {
    const scans = [];
    for (const [brandKey, brand] of Object.entries(brands)) {
      scans.push(await scanBrand(context, brandKey, brand, state.brands[brandKey]));
    }

    const candidateDetails = [];
    for (const scan of scans) {
      for (const candidate of scan.candidates) {
        candidateDetails.push(
          await readListingDetails(context, candidate, scan.brandKey, brands[scan.brandKey]),
        );
      }
    }

    const details = candidateDetails.filter((listing) =>
      isUnitedStatesSellerLocation(listing.sellerLocation),
    );
    const skippedNonUsListings = candidateDetails.filter(
      (listing) => !isUnitedStatesSellerLocation(listing.sellerLocation),
    );

    if (details.length > 0) {
      if (dryRun) {
        console.log(
          JSON.stringify({ dryRun: true, newListings: details, skippedNonUsListings }, null, 2),
        );
      } else {
        await sendAlert(details);
      }
    } else {
      console.log("No new US seller listings found.");
      if (dryRun && skippedNonUsListings.length > 0) {
        console.log(JSON.stringify({ dryRun: true, skippedNonUsListings }, null, 2));
      }
    }

    if (skippedNonUsListings.length > 0) {
      console.log(
        `Skipped ${skippedNonUsListings.length} non-US listing(s); they will be recorded as seen.`,
      );
    }

    if (!dryRun) {
      for (const scan of scans) {
        const brandState = state.brands[scan.brandKey];
        brandState.frontier = scan.frontier;
        brandState.seen = mergeSeen(
          brandState.seen,
          scan.candidates.map((candidate) => candidate.url),
        );
        brandState.lastPagesScanned = scan.pagesScanned;
      }

      state.lastSuccessfulCheckAt = new Date().toISOString();
      await saveState(state);
    }
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
