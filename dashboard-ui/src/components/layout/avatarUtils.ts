/**
 * Derives initials from firstName and lastName.
 * Returns uppercase initials string if both names are present and non-empty,
 * or null if either is missing/empty.
 */
export function getInitials(firstName?: string, lastName?: string): string | null {
  if (!firstName || !lastName || firstName.length === 0 || lastName.length === 0) {
    return null;
  }
  return `${firstName[0].toUpperCase()}${lastName[0].toUpperCase()}`;
}
