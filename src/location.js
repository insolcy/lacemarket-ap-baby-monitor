export function isUnitedStatesSellerLocation(value) {
  const location = String(value || "");
  return (
    /\bUSA\b/i.test(location) ||
    /\bUnited States(?: of America)?\b/i.test(location) ||
    /\bU\.S\.A\.?(?=\s|$)/i.test(location)
  );
}
