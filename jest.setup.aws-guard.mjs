/**
 * Keeps unit tests off real AWS.
 *
 * Every backend test is supposed to mock the AWS SDK modules it touches, and
 * almost all of them do. `manual-unsubscribe.test.mjs` did not mock
 * EventBridge, so running the suite on a machine that happened to have
 * credentials published genuine `Send Email v2` events onto the production bus
 * for a tenant that exists only in that file's fixtures. The send function
 * rejected them, retried twice each, filled the pipeline DLQ and tripped the
 * production error alarm. No mail was ever sent, but the first anyone knew of
 * it was a 3am-shaped pager message about an alarm nobody could explain.
 *
 * A missing mock should be a failing test, not a production event. This runs
 * before the module registry is built for each test file, so any client
 * constructed afterwards picks it up:
 *
 *   - every endpoint points at a closed local port, so an unmocked call fails
 *     fast with ECONNREFUSED instead of reaching AWS;
 *   - credentials are obvious junk, so nothing can authenticate even if a
 *     request did escape;
 *   - IMDS is off, so a stray call fails immediately rather than hanging for
 *     the metadata timeout.
 *
 * This is a backstop, not a substitute for mocking. A test that trips it will
 * be noisy and slow, which is the intended signal.
 */

/** A port nothing listens on. Connecting fails immediately rather than hanging. */
const BLACKHOLE = 'http://127.0.0.1:1';

// The global override. Every AWS SDK v3 client honours this.
process.env.AWS_ENDPOINT_URL = BLACKHOLE;

// Service-specific variables win over the global one, so a developer whose
// shell already exports one for local work would otherwise punch a hole
// straight through this guard. Every service the backend talks to is listed.
const SERVICES = [
  'EVENTBRIDGE',
  'DYNAMODB',
  'SESV2',
  'SES',
  'S3',
  'SQS',
  'SNS',
  'SCHEDULER',
  'SFN',
  'LAMBDA',
  'SECRETS_MANAGER',
  'SSM',
  'CLOUDWATCH',
  'CLOUDWATCH_LOGS',
  'COGNITO_IDENTITY_PROVIDER',
  'BEDROCK_RUNTIME',
];

for (const service of SERVICES) {
  process.env[`AWS_ENDPOINT_URL_${service}`] = BLACKHOLE;
}

process.env.AWS_ACCESS_KEY_ID = 'jest-blocked';
process.env.AWS_SECRET_ACCESS_KEY = 'jest-blocked';
process.env.AWS_SESSION_TOKEN = 'jest-blocked';

// A named profile would otherwise be read from the shared config file and
// could supply real credentials through SSO or a credential process.
delete process.env.AWS_PROFILE;

// Region only if the environment has not chosen one: a few tests assert on
// values derived from it, and this guard is not the place to change them.
process.env.AWS_REGION ||= 'us-east-1';
process.env.AWS_DEFAULT_REGION ||= process.env.AWS_REGION;

// Without this the credential chain tries the instance metadata endpoint and
// waits out its timeout before failing.
process.env.AWS_EC2_METADATA_DISABLED = 'true';
