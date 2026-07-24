# Newsletter Service

Serverless newsletter platform for Ready, Set, Cloud. This repository contains the infrastructure, backend functions, admin API, and React dashboard used to manage newsletter issues, subscribers, sender verification, audience analytics, and billing.

The codebase is not just a mail sender. It covers the full operational workflow around a newsletter product:

- publishing issues and scheduled sends
- supporting sponsored placements and ad-copy reminders
- managing subscribers and unsubscribe flows
- tracking opens, clicks, bounces, complaints, and deliverability
- administering verified sender identities and domains
- exposing an authenticated admin API and dashboard
- handling sponsorship pricing, sponsor-facing value narratives, and Stripe-backed subscription workflows
- generating reports and audience insights

## Architecture

The system is built around AWS SAM and deploys mostly as Lambda-based services.

- `template.yaml`: primary SAM/CloudFormation stack
- `functions/`: JavaScript Lambda handlers, utilities, billing flows, subscriber flows, and issue processing
- `functions/src/`: Rust Lambda binaries and shared Rust modules for the admin API, auth, sender management, and AI helpers
- `dashboard-ui/`: Vite + React + TypeScript admin dashboard
- `state-machines/`: Step Functions definitions for scheduled and multi-step workflows
- `templates/`: Handlebars email/report templates
- `openapi.yaml`: internal/admin API definition
- `publicapi.yaml`: public-facing API definition for subscriber and tracking flows
- `scripts/`: deployment and operational scripts
- `docs/`: operational documentation

At a high level:

1. public API endpoints accept subscriber actions, tracking events, and unsubscribe requests
2. backend Lambdas persist state in DynamoDB and publish events through EventBridge
3. SES/Scheduler-based flows handle email delivery, scheduled sends, and sponsor reminder automation
4. Cognito secures the admin experience
5. the Rust API serves the authenticated dashboard
6. the dashboard consumes the API for profile, brand, sender, issue, subscriber, segment, pricing, and billing management

## Main Capabilities

### Newsletter operations

- publish issues from Handlebars templates
- preview or schedule sends
- resend issues and rebuild analytics
- sync newsletter content from external sources such as GitHub
- curate community content: capture links from LinkedIn via the Chrome extension (`chrome-extension/`), vet them with AI, and serve them as an RSS feed for writing sessions (see `docs/content-curation.md`)
- render sponsor placements directly into newsletter templates when sponsor data is attached to an issue

### Sponsorship workflows

- calculate sponsorship pricing from audience and performance inputs
- generate sponsor-facing narrative/value copy from pricing calculations
- support sponsored placement content inside newsletter issues
- send automated ad-copy reminder workflows for upcoming sponsored slots

### Subscriber lifecycle

- add and import subscribers
- export subscribers and segments
- manual unsubscribe and complaint-based auto-unsubscribe
- cleanup flows for bounced subscribers

### Analytics and reporting

- issue-level stats for opens, clicks, deliveries, bounces, rejects, and complaints
- audience health and deliverability monitoring
- geolocation reporting using MaxMind GeoLite2 data
- report compilation and aggregation jobs

### Sender and tenant administration

- verified sender email management
- domain verification flows
- tenant setup and profile/brand onboarding
- API key management

### Billing and pricing

- Stripe checkout and customer portal sessions
- webhook/event handling for payments and subscription lifecycle changes
- pricing calculation, pricing history, sponsor-facing narrative generation, and questionnaires

## Tech Stack

- Infrastructure: AWS SAM, CloudFormation, API Gateway, Lambda, EventBridge, Step Functions, S3, CloudFront, Cognito, DynamoDB, SES, Scheduler
- Backend: Node.js ES modules and Rust
- Frontend: React 19, Vite, TypeScript, Tailwind CSS, AWS Amplify
- Testing: Jest, Vitest, Rust `cargo test`, property tests with `fast-check` and `proptest`
- Billing: Stripe

## Repository Layout

```text
.
|-- dashboard-ui/         # Admin dashboard
|-- functions/            # JS Lambda handlers and helpers
|-- functions/src/        # Rust Lambda binaries and shared modules
|-- state-machines/       # Step Functions ASL definitions
|-- templates/            # Email/report templates
|-- scripts/              # Deploy and admin helper scripts
|-- docs/                 # Operational docs
|-- __tests__/            # Root-level JS tests
|-- template.yaml         # SAM stack
|-- openapi.yaml          # Admin/internal API
|-- publicapi.yaml        # Public API
|-- Cargo.toml            # Rust workspace/package
`-- package.json          # Root JS tooling
```

## Prerequisites

Install the following before working in the repository:

- Node.js 20+ and npm
- Rust toolchain with `cargo`
- AWS CLI configured for the target account
- AWS SAM CLI for infrastructure builds/deployments

Depending on what you are testing locally, you may also need:

- valid AWS credentials
- Cognito app/client details for dashboard auth
- Stripe configuration in AWS Parameter Store or stack parameters
- a deployed stack for end-to-end dashboard testing

## Getting Started

### 1. Install dependencies

From the repository root:

```bash
npm ci
cd dashboard-ui
npm ci
cd ..
```

### 2. Run tests and linters

Root JavaScript tests:

```bash
npm test
```

Coverage:

```bash
npm run coverage
```

Root lint:

```bash
npm run lint
```

Dashboard lint:

```bash
npm run lint:ui
```

Rust tests:

```bash
npm run test:rust
```

Rust lint and format checks:

```bash
npm run lint:rust
npm run fmt:rust
```

Dashboard type-check and tests:

```bash
cd dashboard-ui
npm run type-check
npm run test:run
```

### 3. Run the dashboard locally

The dashboard is the easiest part of the system to run locally.

```bash
cd dashboard-ui
npm run dev
```

The UI expects these Vite environment variables:

```env
VITE_API_BASE_URL=
VITE_USER_POOL_CLIENT_ID=
VITE_AWS_REGION=us-east-1
```

The code also references optional frontend flags such as:

```env
VITE_PRELOAD_ROUTES=true
VITE_APP_TITLE=Newsletter Dashboard
```

In practice, local dashboard development usually targets a deployed AWS backend rather than a fully local emulation of the stack.

## Backend Notes

There are two backend surfaces in this repository:

- public newsletter endpoints defined in `publicapi.yaml`
- authenticated admin API routes implemented in Rust under `functions/src/api/`

The admin API includes routes for:

- `/me` and profile management
- `/brand`
- `/api-keys`
- `/senders` and `/senders/domain`
- `/issues`
- `/pricing`
- `/subscribers`
- `/segments`

JavaScript handlers under `functions/` support email sending, event processing, analytics jobs, billing workflows, and operational tasks.

Sponsor-related functionality currently lives primarily in JavaScript handlers and workflow definitions, including sponsorship pricing calculations, sponsor narrative generation, newsletter sponsor rendering, and the ad-copy reminder state machine.

## Useful Scripts

### Root scripts

- `npm test`: run Jest tests
- `npm run coverage`: collect JS coverage
- `npm run lint`: lint root JS modules
- `npm run lint:all`: lint root and dashboard
- `npm run test:rust`: run Rust tests

### Dashboard scripts

From `dashboard-ui/`:

- `npm run dev`: start Vite dev server
- `npm run build`: production build
- `npm run preview`: preview the build
- `npm run test:run`: run Vitest once
- `npm run accessibility:test`: build and run axe CLI checks
- `npm run performance:audit`: run Lighthouse CI

### Operational scripts

- `node scripts/deploy-ui.mjs --stack-name <stack> --region <region>`: build and deploy the dashboard to the stack's S3/CloudFront frontend
- `node scripts/login.mjs`: perform an admin Cognito sign-in flow and copy a bearer token to the clipboard
- `node scripts/create-admin-user.mjs`: create an admin user in the configured Cognito user pool

`scripts/login.mjs` expects environment values such as:

```env
PROFILE=
COGNITO_USER_POOL_ID=
COGNITO_CLIENT_ID=
COGNITO_USERNAME=
COGNITO_PASSWORD=
COGNITO_NEW_PASSWORD=
GIVEN_NAME=
FAMILY_NAME=
```

`scripts/create-admin-user.mjs` expects:

```env
USER_POOL_ID=
ADMIN_EMAIL=
TENANT_ID=
TEMP_PASSWORD=
```

## Deployment

Infrastructure is defined in [`template.yaml`](./template.yaml) and includes:

- Cognito user/identity pools and groups
- API Gateway endpoints
- Lambda functions in both JS and Rust
- S3/CloudFront frontend hosting
- supporting resources such as DynamoDB, EventBridge, SES-related flows, and Step Functions used for newsletter and sponsorship workflows

Typical deployment flow:

```bash
sam build
sam deploy --guided
```

After the stack is deployed, the dashboard can be built and pushed with:

```bash
node scripts/deploy-ui.mjs --stack-name <stack-name> --region <aws-region>
```

The deploy script reads CloudFormation outputs such as:

- `DashboardApiUrl`
- `UserPoolId`
- `UserPoolClientId`
- `IdentityPoolId`
- `FrontendBucketName`
- `FrontendDistributionId`
- `FrontendURL`

and writes the corresponding production env values for `dashboard-ui/`.

## Testing Strategy

This repository has broad automated coverage:

- Jest tests for JS functions and workflows
- Vitest tests for dashboard pages, components, services, and responsive behavior
- Rust unit/integration tests for backend modules
- property-based tests in both JS and Rust for edge cases and invariants

A practical validation sequence before deployment is:

```bash
npm run lint:all
npm test
npm run test:rust
cd dashboard-ui
npm run type-check
npm run test:run
```

## Documentation

- [`docs/geolocation-database-updates.md`](./docs/geolocation-database-updates.md): how to update the MaxMind GeoLite2 database used in analytics
- [`openapi.yaml`](./openapi.yaml): admin/internal API contract
- [`publicapi.yaml`](./publicapi.yaml): public API contract

## CI/CD

GitHub Actions workflows live under `.github/workflows/`:

- `pull-request.yaml`
- `pre-deploy-validation.yaml`
- `deploy.yaml`

These provide the main automation path for validation and deployment.

## Current State

This repository is best understood as a production-oriented application stack rather than a minimal starter project. The local developer experience is strongest for the dashboard, unit tests, and script-driven operational work; most full-system behavior assumes deployed AWS infrastructure.
