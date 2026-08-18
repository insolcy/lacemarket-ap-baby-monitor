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

export function findCandidatesBeforeAnchor(pages, frontierUrls, seenUrls) {
  const known = new Set([...frontierUrls, ...seenUrls]);
  const candidates = [];
  let anchorUrl = null;

  for (const page of pages) {
    for (const listing of page) {
      if (known.has(listing.url)) {
        anchorUrl = listing.url;
        return { anchorFound: true, anchorUrl, candidates };
      }

      candidates.push(listing);
    }
  }

  return { anchorFound: false, anchorUrl, candidates: [] };
}

export function mergeSeen(existingUrls, newUrls, limit = 5000) {
  const merged = [...new Set([...newUrls, ...existingUrls])];
  return merged.slice(0, limit);
}
