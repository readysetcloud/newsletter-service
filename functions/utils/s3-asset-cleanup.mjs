import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client();

/**
 * Lambda function to handle async S3 asset cleanup
 * Triggered by EventBridge events from other functions
 */
export const handler = async (event) => {
  console.log('S3 Asset Cleanup triggered:', JSON.stringify(event, null, 2));

  try {
    const detail = event.detail;

    if (!detail || detail.action !== 'delete') {
      console.warn('Invalid or unsupported cleanup event:', detail);
      return { status: 'skipped', reason: 'Invalid event' };
    }

    const { s3Url, s3Key, bucketName, assetType } = detail;

    // Validate required fields
    if (!s3Key || !bucketName) {
      console.error('Missing required fields:', { s3Key, bucketName });
      return { status: 'error', reason: 'Missing required fields' };
    }

    // Safety check - only delete specific asset types
    const allowedAssetTypes = ['brand-logo'];
    if (!allowedAssetTypes.includes(assetType)) {
      console.warn('Unsupported asset type:', assetType);
      return { status: 'skipped', reason: 'Unsupported asset type' };
    }

    // Additional safety check - validate S3 key pattern
    if (!s3Key.startsWith('brand-logos/')) {
      console.warn('S3 key does not match expected pattern:', s3Key);
      return { status: 'skipped', reason: 'Invalid S3 key pattern' };
    }

    console.log(`Deleting S3 object: ${bucketName}/${s3Key}`);

    await s3.send(new DeleteObjectCommand({
      Bucket: bucketName,
      Key: s3Key
    }));

    console.log(`Successfully deleted S3 object: ${s3Key}`);

    return {
      status: 'success',
      deletedObject: {
        bucket: bucketName,
        key: s3Key,
        url: s3Url
      },
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('S3 cleanup failed:', error);

    // Don't throw - we want to handle cleanup failures gracefully
    return {
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};
