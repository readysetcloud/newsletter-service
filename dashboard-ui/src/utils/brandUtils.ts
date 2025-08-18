/**
 * Generates a brand ID from a brand name
 * Converts to lowercase and keeps only letters
 */
export function generateBrandId(brandName: string): string {
  if (!brandName) return '';

  return brandName
    .toLowerCase()
    .trim()
    // Keep only lowercase letters
    .replace(/[^a-z]/g, '')
    // Limit length to 50 characters
    .substring(0, 50);
}

/**
 * Validates if a brand ID is properly formatted
 */
export function isValidBrandId(brandId: string): boolean {
  if (!brandId) return false;

  // Check length
  if (brandId.length < 3 || brandId.length > 50) return false;

  // Check format: only lowercase letters
  if (!/^[a-z]+$/.test(brandId)) return false;

  return true;
}

/**
 * Suggests alternative brand IDs if the current one is taken
 */
export function generateAlternativeBrandIds(baseBrandId: string): string[] {
  const alternatives: string[] = [];

  // Add letter suffixes
  const suffixes = ['co', 'inc', 'corp', 'ltd', 'llc'];
  for (const suffix of suffixes) {
    const alternative = `${baseBrandId}${suffix}`;
    if (alternative.length <= 50) {
      alternatives.push(alternative);
    }
  }

  // Add single letter suffixes
  for (let i = 0; i < 5; i++) {
    const letter = String.fromCharCode(97 + i); // a, b, c, d, e
    const alternative = `${baseBrandId}${letter}`;
    if (alternative.length <= 50) {
      alternatives.push(alternative);
    }
  }

  return alternatives;
}
