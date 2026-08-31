const LISTING_URL_PATTERN = /^https:\/\/egl\.circlly\.com\/auctions\/[^/?#]+$/;

export function isListingUrl(value) {
  if (!LISTING_URL_PATTERN.test(value)) {
    return false;
  }

  return new URL(value).pathname !== "/auctions/search";
}

export function uniqueListings(listings) {
  const byUrl = new Map();

  for (const listing of listings) {
    if (!isListingUrl(listing.url)) {
      continue;
    }

    const previous = byUrl.get(listing.url);
    if (!previous || listing.title.length > previous.title.length) {
      byUrl.set(listing.url, listing);
    }
  }

  return [...byUrl.values()];
}

export function hasNewListingBadge(listing) {
  return String(listing.ribbonText || "").trim().toLowerCase() === "new";
}

export function findUnseenNewListings(pages, seenUrls) {
  const seen = new Set(seenUrls);
  return pages
    .flat()
    .filter((listing) => hasNewListingBadge(listing) && !seen.has(listing.url));
}

export function splitAtFirstKnownListing(listings, knownUrls) {
  const known = knownUrls instanceof Set ? knownUrls : new Set(knownUrls);
  const anchorIndex = listings.findIndex((listing) => known.has(listing.url));
  return {
    anchorFound: anchorIndex >= 0,
    listingsBeforeAnchor:
      anchorIndex >= 0 ? listings.slice(0, anchorIndex) : listings,
  };
}

export function mergeSeen(existingUrls, newUrls) {
  const merged = [...new Set([...newUrls, ...existingUrls])];
  return merged;
}
