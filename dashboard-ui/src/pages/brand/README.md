# Brand Management Interface

This directory contains the brand management interface implementation for the newsletter admin UI.

## Components

### BrandPage (`BrandPage.tsx`)
The main page component that provides the brand management interface. Features:
- Loads user profile and brand data on mount
- Displays create/update forms based on existing brand data
- Shows success/error messages for user feedback
- Includes real-time brand preview
- Integrates with shared navigation header

### BrandForm (`../components/forms/BrandForm.tsx`)
A comprehensive form component for brand creation and updates. Features:
- Form validation using Zod schemas
- Real-time preview updates
- Brand logo upload with drag-and-drop support
- Displays immutable brand ID after creation
- Handles both create and update modes

### BrandPreview (`../components/brand/BrandPreview.tsx`)
A preview component that shows how the brand will appear. Features:
- Live preview of form changes
- Displays brand logo, name, website, industry, and description
- Shows brand ID prominently
- Handles empty states gracefully

### BrandPhotoUpload (`../components/forms/BrandPhotoUpload.tsx`)
Specialized component for brand logo uploads. Features:
- Drag and drop file upload
- File type and size validation
- Image preview functionality
- Integration with presigned URL upload flow

## API Integration

The brand management interface integrates with the following API endpoints:
- `GET /me` - Retrieve user profile and brand data
- `PUT /me/brand` - Update brand information
- `POST /brand/logo` - Generate presigned URL for logo upload
- `PUT /brand/logo` - Confirm logo upload

## Validation

Brand data is validated using Zod schemas defined in `../schemas/brandSchema.ts`:
- Brand name: Required, 2-100 characters
- Website: Optional, must be valid URL format
- Industry: Required, from predefined list
- Description: Optional, max 500 characters
- Tags: Optional array of strings

## Navigation

The brand page is accessible via:
- Route: `/brand`
- Navigation: Integrated into the main app header
- Protected: Requires authentication

## Testing

Unit tests are provided for:
- BrandForm component functionality
- Form validation behavior
- Loading and submission states
- Preview updates

## Features Implemented

✅ Brand information form (name, website, industry, description)
✅ Brand logo upload with presigned URL flow
✅ Brand preview component with real-time updates
✅ Form validation using Zod schemas
✅ Brand creation and update operations
✅ Success/error handling with user feedback
✅ Immutable brand ID display
✅ Responsive design and navigation integration
✅ Comprehensive test coverage

## Requirements Satisfied

This implementation satisfies the following requirements from the spec:
- 2.1: Brand creation interface
- 2.2: Brand information form validation
- 2.3: API integration for brand operations
- 2.4: Success/error handling
- 2.5: Brand ID immutability
- 3.1: Brand configuration interface
- 3.2: Brand information updates
- 3.3: Brand photo upload functionality
- 3.4: Brand preview display
- 3.5: Error handling for brand operations
