const LACE_MARKET_ORIGIN = "https://egl.circlly.com";
const BRAND_FILTER = "f[brand][]";
const REGION_FILTER = "f[region][]";

export const CURRENT_STATE_VERSION = 2;

export function buildNewUnitedStatesListingUrl(brandSlug, page = 1) {
  const url = new URL("/auctions", LACE_MARKET_ORIGIN);
  url.searchParams.set("new", "1");
  url.searchParams.set("q[title]", "");
  url.searchParams.set("q[s]", "");
  url.searchParams.append(BRAND_FILTER, brandSlug);
  url.searchParams.append(REGION_FILTER, "0");
  url.searchParams.set("page", String(page));
  return url.href;
}

export function isExpectedNewUnitedStatesListingUrl(value, brandSlug) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const brands = url.searchParams.getAll(BRAND_FILTER);
  const regions = url.searchParams.getAll(REGION_FILTER);
  return (
    url.origin === LACE_MARKET_ORIGIN &&
    url.pathname === "/auctions" &&
    url.searchParams.get("new") === "1" &&
    brands.length === 1 &&
    brands[0] === brandSlug &&
    regions.length === 1 &&
    regions[0] === "0"
  );
}

export function needsNewUnitedStatesBaseline(state) {
  return !Number.isInteger(state?.version) || state.version < CURRENT_STATE_VERSION;
}
