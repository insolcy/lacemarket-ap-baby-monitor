const dressCategoryPattern =
  /Dresses|Jumperskirt|One Piece|Salopette|Strapless(?:\/Other)?/i;

export function findMonitoredBrand(brandText, brandDefinitions) {
  return Object.entries(brandDefinitions).find(([, brand]) =>
    String(brandText).toLowerCase().includes(brand.label.toLowerCase()),
  );
}

export function classifyListingDetails({ brandText, categoryText, expectedBrand }) {
  if (!brandText || brandText === "未提供" || !brandText.toLowerCase().includes(expectedBrand.toLowerCase())) {
    return "invalid-brand";
  }

  if (!categoryText || categoryText === "未提供") {
    return "missing-category";
  }

  return dressCategoryPattern.test(categoryText) ? "dress" : "non-dress";
}
