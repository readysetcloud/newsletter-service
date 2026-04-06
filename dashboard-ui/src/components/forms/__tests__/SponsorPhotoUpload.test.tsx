import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateSponsorLogoFile } from '../sponsorLogoValidation';

// Feature: sponsor-logo-upload, Property 7: Client-side file validation rejects invalid files

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/bmp',
  'image/tiff',
];

const NON_IMAGE_MIME_TYPES = [
  'application/pdf',
  'text/plain',
  'text/html',
  'application/json',
  'application/zip',
  'video/mp4',
  'audio/mpeg',
  'application/octet-stream',
  'text/css',
  'application/javascript',
];

describe('SponsorPhotoUpload validation', () => {
  // **Validates: Requirements 4.3, 4.4**

  it('rejects any file larger than 5 MB regardless of MIME type', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 10 }),
        fc.oneof(
          fc.constantFrom(...IMAGE_MIME_TYPES),
          fc.constantFrom(...NON_IMAGE_MIME_TYPES)
        ),
        (size, type) => {
          const result = validateSponsorLogoFile({ size, type });
          // Non-image types get rejected first with a different message
          expect(result).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any file with a non-image MIME type regardless of size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_FILE_SIZE * 10 }),
        fc.constantFrom(...NON_IMAGE_MIME_TYPES),
        (size, type) => {
          const result = validateSponsorLogoFile({ size, type });
          expect(result).toBe('Only image files are allowed');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any file with an arbitrary non-image MIME type string', () => {
    const nonImagePrefix = fc.constantFrom(
      'application', 'text', 'video', 'audio', 'font', 'model', 'multipart', 'message'
    );
    const subtype = fc.stringMatching(/^[a-z0-9][a-z0-9.+-]{0,20}$/);

    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        nonImagePrefix,
        subtype,
        (size, prefix, sub) => {
          const type = `${prefix}/${sub}`;
          const result = validateSponsorLogoFile({ size, type });
          expect(result).toBe('Only image files are allowed');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts valid image files within size limit', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_FILE_SIZE }),
        fc.constantFrom(...IMAGE_MIME_TYPES),
        (size, type) => {
          const result = validateSponsorLogoFile({ size, type });
          expect(result).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('returns correct error message for oversized image files', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_FILE_SIZE + 1, max: MAX_FILE_SIZE * 10 }),
        fc.constantFrom(...IMAGE_MIME_TYPES),
        (size, type) => {
          const result = validateSponsorLogoFile({ size, type });
          expect(result).toBe('File size must not exceed 5 MB');
        }
      ),
      { numRuns: 100 }
    );
  });
});
