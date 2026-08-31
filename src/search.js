const LACE_MARKET_ORIGIN = "https://egl.circlly.com";
const BRAND_FILTER = "f[brand][]";
const CATEGORY_FILTER = "f[category_id][]";
const REGION_FILTER = "f[region][]";
const DRESSES_CATEGORY_ID = "12";

export const CURRENT_STATE_VERSION = 3;

function normalizeBrandSlugs(brandSlugs) {
  return Array.isArray(brandSlugs) ? brandSlugs : [brandSlugs];
}

export function buildNewUnitedStatesListingUrl(brandSlugs, page = 1) {
  const url = new URL("/auctions", LACE_MARKET_ORIGIN);
  url.searchParams.set("new", "1");
  url.searchParams.set("q[title]", "");
  url.searchParams.set("q[s]", "");
  url.searchParams.append(CATEGORY_FILTER, DRESSES_CATEGORY_ID);
  for (const brandSlug of normalizeBrandSlugs(brandSlugs)) {
    url.searchParams.append(BRAND_FILTER, brandSlug);
  }
  url.searchParams.append(REGION_FILTER, "0");
  url.searchParams.set("page", String(page));
  return url.href;
}

export function isExpectedNewUnitedStatesListingUrl(value, brandSlugs) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  const actualBrands = url.searchParams.getAll(BRAND_FILTER);
  const expectedBrands = normalizeBrandSlugs(brandSlugs);
  const categories = url.searchParams.getAll(CATEGORY_FILTER);
  const regions = url.searchParams.getAll(REGION_FILTER);
  return (
    url.origin === LACE_MARKET_ORIGIN &&
    url.pathname === "/auctions" &&
    url.searchParams.get("new") === "1" &&
    categories.length === 1 &&
    categories[0] === DRESSES_CATEGORY_ID &&
    actualBrands.length === expectedBrands.length &&
    expectedBrands.every((brand) => actualBrands.includes(brand)) &&
    regions.length === 1 &&
    regions[0] === "0"
  );
}

export function needsNewUnitedStatesBaseline(state) {
  return !Number.isInteger(state?.version) || state.version < CURRENT_STATE_VERSION;
}
