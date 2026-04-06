const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Validate a file for sponsor logo upload.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateSponsorLogoFile(file: { size: number; type: string }): string | null {
  if (!file.type.startsWith('image/')) {
    return 'Only image files are allowed';
  }
  if (file.size > MAX_FILE_SIZE) {
    return 'File size must not exceed 5 MB';
  }
  return null;
}
