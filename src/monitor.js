import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import nodemailer from "nodemailer";
import { chromium } from "playwright";

import { classifyListingDetails } from "./classification.js";
import {
  assertAllRecipientsAccepted,
  buildAlertEmail,
  buildRecipients,
} from "./email.js";
import {
  findUnseenNewListings,
  hasNewListingBadge,
  mergeSeen,
  uniqueListings,
} from "./frontier.js";
import {
  CloudflareChallengeError,
  getRetryableProxyErrorCode,
  isChallengeResponse,
  ProxyConnectionError,
} from "./navigation.js";
import { createIPRoyalSessionId, withIPRoyalSession } from "./proxy.js";
import {
  buildNewUnitedStatesListingUrl,
  CURRENT_STATE_VERSION,
  isExpectedNewUnitedStatesListingUrl,
  needsNewUnitedStatesBaseline,
} from "./search.js";

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
const configuredMaxProxyRotations = Number.parseInt(process.env.MAX_PROXY_ROTATIONS || "10", 10);
const maxProxyRotations =
  Number.isInteger(configuredMaxProxyRotations) && configuredMaxProxyRotations >= 0
    ? configuredMaxProxyRotations
    : 10;
let lastNavigationAt = 0;

const brands = {
  ap: {
    label: "Angelic Pretty",
    slug: "angelic-pretty",
  },
  baby: {
    label: "Baby the Stars Shine Bright",
    slug: "baby-the-stars-shine-bright",
  },
};

for (const brand of Object.values(brands)) {
  brand.url = buildNewUnitedStatesListingUrl(brand.slug);
}

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
      const status = response?.status();
      const finalUrl = page.url();
      const title = await page.title();
      if (isChallengeResponse({ status, title, url: finalUrl, bodyText: "" })) {
        const rayId = response?.headers()["cf-ray"] || "unknown";
        throw new CloudflareChallengeError(
          `${label}: Cloudflare challenge (status=${status ?? "unknown"}, title=${JSON.stringify(title)}, url=${finalUrl}, cf-ray=${rayId})`,
        );
      }

      const bodyText = await page.locator("body").innerText({ timeout: 20_000 });
      if (isChallengeResponse({ status, title, url: finalUrl, bodyText })) {
        const rayId = response?.headers()["cf-ray"] || "unknown";
        throw new CloudflareChallengeError(
          `${label}: Cloudflare challenge (status=${status ?? "unknown"}, title=${JSON.stringify(title)}, url=${finalUrl}, cf-ray=${rayId})`,
        );
      }

      await validatePage?.(page, bodyText);

      return bodyText;
    } catch (error) {
      lastError = error;
      if (error instanceof CloudflareChallengeError || error instanceof ProxyConnectionError) {
        throw error;
      }

      const proxyErrorCode = getRetryableProxyErrorCode(error);
      if (proxyErrorCode) {
        throw new ProxyConnectionError(
          `${label}: proxy connection failed (${proxyErrorCode})`,
          { cause: error },
        );
      }

      if (attempt < navigationRetries) {
        await page.waitForTimeout(attempt * 20_000);
      }
    }
  }

  throw lastError;
}

async function assertUsableListingPage(page, brand) {
  const heading = await page.locator("h1").first().innerText({ timeout: 20_000 });
  if (heading.trim() !== "New Listings") {
    throw new Error(`${brand.label}: unexpected listing page heading: ${heading}`);
  }

  if (!isExpectedNewUnitedStatesListingUrl(page.url(), brand.slug)) {
    throw new Error(
      `${brand.label}: New/USA filters were not preserved: ${page.url()}`,
    );
  }
}

async function readListingPage(navigator, url, brand) {
  return navigator.withPage(async (page) => {
    await gotoWithRetry(page, url, brand.label, (currentPage) =>
      assertUsableListingPage(currentPage, brand),
    );

    const rawListings = await page.locator(".grid-list-item-content").evaluateAll((cards) =>
      cards.map((card) => {
        const anchor = card.querySelector('a.auction-title[href*="/auctions/"]');
        const ribbon = card.querySelector(":scope > .ribbon > span");
        const image = card.querySelector(".auction-image");
        return {
          title: (anchor?.textContent || "").replace(/\s+/g, " ").trim(),
          url: anchor?.href || "",
          ribbonText: (ribbon?.textContent || "").replace(/\s+/g, " ").trim(),
          imageUrl:
            image?.getAttribute("data-lazy-load") || image?.getAttribute("data-src") || "",
        };
      }),
    );
    const listings = uniqueListings(rawListings);
    if (rawListings.length > 0 && listings.length === 0) {
      throw new Error(`${brand.label}: listing cards did not contain valid auction links`);
    }

    const nextLink = page.getByRole("link", { name: "Next →", exact: true });
    const nextUrl =
      (await nextLink.count()) > 0 ? await nextLink.first().getAttribute("href") : null;
    return {
      listings,
      nextUrl: nextUrl ? new URL(nextUrl, page.url()).href : null,
    };
  });
}

async function scanBrand(navigator, brandKey, brand, brandState) {
  const pages = [];
  let nextUrl = brand.url;

  for (let pageNumber = 1; pageNumber <= maxPages && nextUrl; pageNumber += 1) {
    const result = await readListingPage(navigator, nextUrl, brand);
    pages.push(result.listings);

    if (!result.nextUrl) {
      const observedListings = uniqueListings(pages.flat());
      const ignoredNonNewCount = observedListings.filter(
        (listing) => !hasNewListingBadge(listing),
      ).length;
      return {
        brandKey,
        candidates: findUnseenNewListings(pages, brandState.seen),
        observedListings,
        frontier: pages[0].map((listing) => listing.url),
        ignoredNonNewCount,
        pagesScanned: pageNumber,
      };
    }

    nextUrl = result.nextUrl;
  }

  throw new Error(
    `${brand.label}: New/USA results exceed ${maxPages} pages; refusing a partial scan`,
  );
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

async function readListingDetails(navigator, candidate, brandKey, brand) {
  return navigator.withPage(async (page) => {
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
    const classification = classifyListingDetails({
      brandText,
      categoryText,
      expectedBrand: brand.label,
    });
    if (classification === "invalid-brand" || classification === "missing-category") {
      throw new Error(
        `${candidate.url}: detail page brand/category validation failed ` +
          `(brand=${JSON.stringify(brandText)}, category=${JSON.stringify(categoryText)})`,
      );
    }

    if (classification === "non-dress") {
      return {
        skippedNonDress: true,
        brandKey,
        brand: brandText,
        title: title || candidate.title || "未命名商品",
        category: categoryText,
        url: candidate.url,
      };
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
      imageUrl: candidate.imageUrl,
      url: candidate.url,
    };
  });
}

async function sendAlert(listings) {
  const mail = buildAlertEmail(listings);
  const recipients = buildRecipients(process.env.SMTP_USER, process.env.ALERT_EMAIL);
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

  const deliveryInfo = await transporter.sendMail({
    from: `Lace Market Monitor <${process.env.SMTP_USER}>`,
    to: recipients,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  });
  const delivery = assertAllRecipientsAccepted(recipients, deliveryInfo);
  console.log(
    `Email accepted by all configured recipients ` +
      `(${delivery.acceptedCount}/${delivery.recipientCount}).`,
  );
}

function buildProxy(rotationMode) {
  if (!process.env.PROXY_SERVER) {
    if (rotationMode === "iproyal") {
      throw new Error("IPRoyal session rotation requires PROXY_SERVER");
    }
    return undefined;
  }

  const password =
    rotationMode === "iproyal"
      ? withIPRoyalSession(process.env.PROXY_PASSWORD, createIPRoyalSessionId())
      : process.env.PROXY_PASSWORD;

  return {
    server: process.env.PROXY_SERVER,
    ...(process.env.PROXY_USERNAME ? { username: process.env.PROXY_USERNAME } : {}),
    ...(password ? { password } : {}),
  };
}

class RotatingNavigator {
  constructor(rotationMode, rotationsAllowed) {
    this.rotationMode = rotationMode;
    this.rotationsAllowed = rotationsAllowed;
    this.rotation = 0;
    this.browser = undefined;
    this.context = undefined;
  }

  async start() {
    await this.openSession();
  }

  async openSession() {
    const proxy = buildProxy(this.rotationMode);
    const browser = await chromium.launch({
      headless,
      ...(process.env.BROWSER_CHANNEL ? { channel: process.env.BROWSER_CHANNEL } : {}),
      ...(proxy ? { proxy } : {}),
    });

    try {
      this.context = await browser.newContext({
        locale: "en-US",
        timezoneId: "America/Los_Angeles",
      });
      await this.context.route("**/*", async (route) => {
        if (shouldBlockResource(route.request())) {
          await route.abort("blockedbyclient");
          return;
        }
        await route.continue();
      });
      this.browser = browser;
      lastNavigationAt = 0;

      if (this.rotationMode === "iproyal") {
        console.log(
          `Started a fresh IPRoyal session ` +
            `(${this.rotation + 1}/${this.rotationsAllowed + 1}).`,
        );
      }
    } catch (error) {
      await browser.close().catch(() => {});
      throw error;
    }
  }

  async closeSession() {
    const context = this.context;
    const browser = this.browser;
    this.context = undefined;
    this.browser = undefined;
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  async rotate(error) {
    console.warn(error.message);
    const reason =
      error instanceof ProxyConnectionError
        ? "The current proxy tunnel failed"
        : "Cloudflare blocked the current proxy IP";
    console.warn(
      `${reason}; switching IP and retrying the current page ` +
        `(${this.rotation + 1}/${this.rotationsAllowed}).`,
    );
    await this.closeSession();
    this.rotation += 1;
    await this.openSession();
  }

  async withPage(operation) {
    for (;;) {
      if (!this.context) {
        throw new Error("Browser session is not available");
      }

      const page = await this.context.newPage();
      try {
        return await operation(page);
      } catch (error) {
        const isRecoverableConnectionError =
          error instanceof CloudflareChallengeError || error instanceof ProxyConnectionError;
        const canRotate =
          isRecoverableConnectionError &&
          this.rotationMode === "iproyal" &&
          this.rotation < this.rotationsAllowed;
        if (!canRotate) {
          throw error;
        }

        await this.rotate(error);
      } finally {
        await page.close().catch(() => {});
      }
    }
  }

  async close() {
    await this.closeSession();
  }
}

async function runMonitorAttempt(state, navigator) {
  const scans = [];
  for (const [brandKey, brand] of Object.entries(brands)) {
    scans.push(await scanBrand(navigator, brandKey, brand, state.brands[brandKey]));
  }

  for (const scan of scans) {
    if (scan.ignoredNonNewCount > 0) {
      console.log(
        `Ignored ${scan.ignoredNonNewCount} ${brands[scan.brandKey].label} ` +
          `listing(s) without the exact New ribbon.`,
      );
    }
  }

  const baselineOnly = needsNewUnitedStatesBaseline(state);
  const candidateDetails = [];
  const skippedNonDressListings = [];
  if (baselineOnly) {
    const baselineCount = scans.reduce(
      (total, scan) => total + scan.observedListings.length,
      0,
    );
    console.log(
      `Initializing New/USA monitoring baseline with ${baselineCount} current listing(s); ` +
        `no historical alerts will be sent.`,
    );
  } else {
    for (const scan of scans) {
      for (const candidate of scan.candidates) {
        const detail = await readListingDetails(
          navigator,
          candidate,
          scan.brandKey,
          brands[scan.brandKey],
        );
        if (detail.skippedNonDress) {
          skippedNonDressListings.push(detail);
        } else {
          candidateDetails.push(detail);
        }
      }
    }
  }

  if (!baselineOnly && candidateDetails.length > 0) {
    if (dryRun) {
      console.log(
        JSON.stringify(
          {
            dryRun: true,
            newListings: candidateDetails,
            skippedNonDressListings,
          },
          null,
          2,
        ),
      );
    } else {
      await sendAlert(candidateDetails);
    }
  } else if (!baselineOnly) {
    console.log("No first-time New listings from US sellers found.");
    if (dryRun && skippedNonDressListings.length > 0) {
      console.log(
        JSON.stringify(
          { dryRun: true, skippedNonDressListings },
          null,
          2,
        ),
      );
    }
  }

  const seenStatus = dryRun ? "would be recorded as seen" : "were recorded as seen";
  if (skippedNonDressListings.length > 0) {
    console.log(
      `Skipped ${skippedNonDressListings.length} non-dress listing(s); they ${seenStatus}.`,
    );
  }

  if (!dryRun) {
    const checkedAt = new Date().toISOString();
    for (const scan of scans) {
      const brandState = state.brands[scan.brandKey];
      brandState.frontier = scan.frontier;
      brandState.seen = mergeSeen(
        brandState.seen,
        scan.observedListings.map((listing) => listing.url),
      );
      brandState.lastPagesScanned = scan.pagesScanned;
    }

    state.version = CURRENT_STATE_VERSION;
    if (baselineOnly) {
      state.newUnitedStatesBaselineAt = checkedAt;
    }
    state.lastSuccessfulCheckAt = checkedAt;
    await saveState(state);
  }
}

async function main() {
  requireProductionEnvironment();
  const state = await loadState();
  const rotationMode = (process.env.PROXY_ROTATION_MODE || "").toLowerCase();
  if (rotationMode && rotationMode !== "iproyal") {
    throw new Error(`Unsupported PROXY_ROTATION_MODE: ${rotationMode}`);
  }

  const navigator = new RotatingNavigator(
    rotationMode,
    rotationMode === "iproyal" ? maxProxyRotations : 0,
  );
  try {
    await navigator.start();
    await runMonitorAttempt(state, navigator);
  } finally {
    await navigator.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
