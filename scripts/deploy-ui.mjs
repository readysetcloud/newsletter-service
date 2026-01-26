#!/usr/bin/env node

import { execFileSync, execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');
const frontendRoot = join(projectRoot, 'dashboard-ui');
const frontendDist = join(frontendRoot, 'dist');
const frontendAssetsDir = join(frontendDist, 'assets');
const frontendEnvPath = join(frontendRoot, '.env.production');
const frontendIndexPath = join(frontendDist, 'index.html');

// Check for CI flag
const isCI = process.argv.includes('--ci');
const skipBuild = process.argv.includes('--skip-build');
const cliArgs = getCliArgs();
const stackNameArg = cliArgs['--stack-name'] || process.env.STACK_NAME;
const regionArg = cliArgs['--region'] || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
const profileArg = cliArgs['--profile'] || process.env.AWS_PROFILE;

function log(message, color = '\x1b[32m') {
  console.log(`${color}%s\x1b[0m`, message);
}

function error(message) {
  console.error('\x1b[31m%s\x1b[0m', message);
}

function execCommand(command, options = {}) {
  try {
    return execSync(command, {
      stdio: 'inherit',
      cwd: projectRoot,
      ...options
    });
  } catch (err) {
    error(`Command failed: ${command}`);
    process.exit(1);
  }
}

function execAws(args, options = {}) {
  const profile = getProfile();
  const awsArgs = profile ? [...args, '--profile', profile] : args;
  return execFileSync('aws', awsArgs, { cwd: projectRoot, ...options });
}

function execAwsOutput(args) {
  return execAws(args, { encoding: 'utf8' });
}

function execAwsOutputWithRetry(args, options = {}) {
  return execAwsWithRetry(args, { encoding: 'utf8', ...options });
}

function getCliArgs() {
  const args = {};
  for (let i = 0; i < process.argv.length; i += 1) {
    const value = process.argv[i];
    if (value && value.startsWith('--')) {
      const equalIndex = value.indexOf('=');
      if (equalIndex > -1) {
        const key = value.slice(0, equalIndex);
        const val = value.slice(equalIndex + 1);
        args[key] = val || true;
        continue;
      }
      const nextValue = process.argv[i + 1];
      if (nextValue && !nextValue.startsWith('--')) {
        args[value] = nextValue;
        i += 1;
      } else {
        args[value] = true;
      }
    }
  }
  return args;
}

function checkPrerequisites() {
  log('Checking prerequisites...');

  try {
    execSync('aws --version', { stdio: 'pipe' });
  } catch {
    error('AWS CLI not found. Please install it first.');
    process.exit(1);
  }

  if (!existsSync(frontendRoot)) {
    error('Frontend folder not found at dashboard-ui/.');
    process.exit(1);
  }

  if (!existsSync(frontendEnvPath)) {
    log('dashboard-ui/.env.production not found. It will be created.');
  }

  if (skipBuild && !existsSync(frontendDist)) {
    error('dashboard-ui/dist not found. Run the frontend build or omit --skip-build.');
    process.exit(1);
  }

  if (!stackNameArg) {
    error('Stack name not provided. Pass --stack-name or set STACK_NAME.');
    process.exit(1);
  }

  if (!regionArg) {
    error('AWS region not provided. Pass --region or set AWS_REGION.');
    process.exit(1);
  }
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function isAwsThrottlingError(err) {
  const message = `${err?.message || ''} ${err?.stderr?.toString?.() || ''}`.toLowerCase();
  return (
    message.includes('toomanyrequestsexception') ||
    message.includes('throttling') ||
    message.includes('rate exceeded') ||
    message.includes('slowdown') ||
    message.includes('requestlimitexceeded') ||
    message.includes('429')
  );
}

function execAwsWithRetry(args, options = {}) {
  const { retries = 3, baseDelayMs = 500, ...rest } = options;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return execAws(args, rest);
    } catch (err) {
      if (attempt < retries - 1 && isAwsThrottlingError(err)) {
        const backoff = Math.pow(2, attempt) * baseDelayMs;
        const jitter = Math.floor(Math.random() * 200);
        const delay = backoff + jitter;
        log(`AWS throttled, retrying in ${delay}ms (attempt ${attempt + 1}/${retries})`, '\x1b[33m');
        sleep(delay);
        continue;
      }
      throw err;
    }
  }
  return null;
}

function getStackName() {
  return stackNameArg;
}

function getRegion() {
  return regionArg;
}

function getProfile() {
  if (isCI) {
    return null;
  }

  return profileArg || null;
}

function getStackOutputs() {
  log('Getting stack outputs...');

  const stackName = getStackName();
  const region = getRegion();

  try {
    const outputs = execAwsOutputWithRetry([
      'cloudformation',
      'describe-stacks',
      '--stack-name',
      stackName,
      '--region',
      region,
      '--query',
      'Stacks[0].Outputs',
      '--output',
      'json'
    ]);

    const parsedOutputs = JSON.parse(outputs);
    const result = {};

    if (parsedOutputs && Array.isArray(parsedOutputs) && parsedOutputs.length > 0) {
      parsedOutputs.forEach(output => {
        result[output.OutputKey] = output.OutputValue;
      });
      return result;
    } else {
      log('No outputs in query result, trying alternative approach...');

      // Try getting the full stack description
      const fullStack = execAwsOutputWithRetry([
        'cloudformation',
        'describe-stacks',
        '--stack-name',
        stackName,
        '--region',
        region,
        '--output',
        'json'
      ]);

      const stackData = JSON.parse(fullStack);
      if (stackData.Stacks && stackData.Stacks[0] && stackData.Stacks[0].Outputs) {
        stackData.Stacks[0].Outputs.forEach(output => {
          result[output.OutputKey] = output.OutputValue;
        });
        return result;
      }
    }

    error('Could not retrieve stack outputs');
    process.exit(1);

  } catch (err) {
    error(`Failed to get stack outputs: ${err.message}`);
    process.exit(1);
  }
}

function uploadToS3(bucketName) {
  log('Uploading files to S3...');

  if (existsSync(frontendAssetsDir)) {
    execAwsWithRetry([
      's3',
      'sync',
      frontendAssetsDir,
      `s3://${bucketName}/assets/`,
      '--delete',
      '--cache-control',
      'public,max-age=31536000,immutable',
      '--exclude',
      '*.map'
    ]);

    execAwsWithRetry([
      's3',
      'sync',
      frontendDist,
      `s3://${bucketName}/`,
      '--delete',
      '--cache-control',
      'public,max-age=3600',
      '--exclude',
      'index.html',
      '--exclude',
      'assets/*',
      '--exclude',
      '*.map'
    ]);
  } else {
    execAwsWithRetry([
      's3',
      'sync',
      frontendDist,
      `s3://${bucketName}/`,
      '--delete',
      '--cache-control',
      'public,max-age=3600',
      '--exclude',
      'index.html',
      '--exclude',
      '*.map'
    ]);
  }

  execAwsWithRetry([
    's3',
    'cp',
    frontendIndexPath,
    `s3://${bucketName}/index.html`,
    '--cache-control',
    'public,max-age=0,must-revalidate'
  ]);
}

function invalidateCloudFront(distributionId) {
  log('Invalidating CloudFront cache...');

  execAwsWithRetry([
    'cloudfront',
    'create-invalidation',
    '--distribution-id',
    distributionId,
    '--paths',
    '/*'
  ]);
}

function configureFrontendEnv(outputs) {
  log('Configuring frontend environment...');

  const requiredOutputs = {
    VITE_API_BASE_URL: outputs.DashboardApiUrl,
    VITE_USER_POOL_ID: outputs.UserPoolId,
    VITE_USER_POOL_CLIENT_ID: outputs.UserPoolClientId,
    VITE_IDENTITY_POOL_ID: outputs.IdentityPoolId,
    VITE_AWS_REGION: getRegion()
  };

  const missing = Object.entries(requiredOutputs)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    error(`Missing required stack outputs for frontend env: ${missing.join(', ')}`);
    process.exit(1);
  }

  let envContent = existsSync(frontendEnvPath) ? readFileSync(frontendEnvPath, 'utf8') : '';

  Object.entries(requiredOutputs).forEach(([key, value]) => {
    const lineRegex = new RegExp(`^${key}=.*$`, 'm');
    if (lineRegex.test(envContent)) {
      envContent = envContent.replace(lineRegex, `${key}=${value}`);
    } else {
      envContent = `${envContent.trimEnd()}\n${key}=${value}\n`;
    }
  });

  writeFileSync(frontendEnvPath, envContent);
}

function buildFrontend() {
  if (skipBuild) {
    return;
  }

  log('Building frontend...');
  execCommand('npm ci', { cwd: frontendRoot });
  execCommand('npm run build', { cwd: frontendRoot });

  if (!existsSync(frontendDist)) {
    error('dashboard-ui/dist not found after build.');
    process.exit(1);
  }

  if (!existsSync(frontendIndexPath)) {
    error('dashboard-ui/dist/index.html not found after build.');
    process.exit(1);
  }
}

async function main() {
  try {
    log('Starting deployment...');

    checkPrerequisites();

    const outputs = getStackOutputs();
    const outputKeys = Object.keys(outputs);
    const bucketName = outputs.FrontendBucketName || outputs.WebsiteBucketName;
    const distributionId = outputs.FrontendDistributionId || outputs.CloudFrontDistributionId;
    const websiteUrl = outputs.FrontendURL || outputs.WebsiteURL || outputs.FrontendCloudFrontURL;
    const cloudFrontUrl = outputs.FrontendCloudFrontURL;

    if (!bucketName) {
      error(`Missing bucket output. Looked for: FrontendBucketName, WebsiteBucketName. Available: ${outputKeys.join(', ') || 'none'}`);
      process.exit(1);
    }

    if (!distributionId) {
      error(`Missing distribution output. Looked for: FrontendDistributionId, CloudFrontDistributionId. Available: ${outputKeys.join(', ') || 'none'}`);
      process.exit(1);
    }

    if (!websiteUrl) {
      error(`Missing frontend URL output. Looked for: FrontendURL, WebsiteURL, FrontendCloudFrontURL. Available: ${outputKeys.join(', ') || 'none'}`);
      process.exit(1);
    }

    configureFrontendEnv(outputs);
    buildFrontend();
    uploadToS3(bucketName);
    invalidateCloudFront(distributionId);

    log('Deployment completed successfully!');
    log(`Website URL: ${websiteUrl}`);
    if (cloudFrontUrl && cloudFrontUrl !== websiteUrl) {
      const normalizedCloudFrontUrl = cloudFrontUrl.startsWith('http://') || cloudFrontUrl.startsWith('https://')
        ? cloudFrontUrl
        : `https://${cloudFrontUrl}`;
      log(`CloudFront URL: ${normalizedCloudFrontUrl}`);
    }
    log(`CloudFront Distribution ID: ${distributionId}`);
    log(`S3 Bucket: ${bucketName}`);

  } catch (err) {
    error(`Deployment failed: ${err.message}`);
    process.exit(1);
  }
}

main();
