# MaxMind GeoLite2 Database Update Process

This document describes how to update the MaxMind GeoLite2 Country database used for IP geolocation in analytics.

## Overview

The geolocation feature uses MaxMind's GeoLite2 Country database to convert IP addresses to country codes. MaxMind updates this database weekly, but we recommend monthly updates for a balance between accuracy and operational overhead.

## MaxMind Account Setup

### Free Tier Registration

1. Visit [MaxMind GeoLite2 Sign Up](https://www.maxmind.com/en/geolite2/signup)
2. Create a free account
3. Verify your email address
4. Log in to your MaxMind account

### Generate License Key

1. Navigate to "My License Key" in your account dashboard
2. Click "Generate new license key"
3. Provide a description (e.g., "Newsletter Service Production")
4. Select "No" for "Will this key be used for GeoIP Update?"
5. Click "Confirm"
6. **Important**: Copy and save the license key immediately (it won't be shown again)

## Manual Update Process

### Download Latest Database

1. Log in to your MaxMind account
2. Navigate to "Download Files"
3. Download "GeoLite2 Country" in MMDB format
4. Extract the `.tar.gz` file
5. Locate `GeoLite2-Country.mmdb` in the extracted folder

### Update Lambda Layer

1. Replace the database file:
   ```bash
   cp /path/to/downloaded/GeoLite2-Country.mmdb layers/geolocation/GeoLite2-Country.mmdb
   ```

2. Verify file size (should be ~6-8 MB):
   ```bash
   ls -lh layers/geolocation/GeoLite2-Country.mmdb
   ```

3. Deploy the updated layer:
   ```bash
   sam build
   s
Confirm country data is appearing correctly
   - Verify no "unknown" countries for valid public IPs

3. **Monitor errors**:
   - Check CloudWatch logs for geolocation errors
   - Verify no increase in error rates after update

## Automated CI/CD Update Workflow (Optional)

For automated monthly updates, set up a scheduled workflow:

### Prerequisites

- MaxMind Account ID and License Key stored in AWS Secrets Manager
- CI/CD pipeline with AWS access (GitHub Actions, GitLab CI, etc.)

### Store Credentials in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name maxmind-credentials \
  --secret-string '{"account_id":"YOUR_ACCOUNT_ID","license_key":"YOUR_LICENSE_KEY"}'
```

### GitHub Actions Workflow Example

Create `.github/workflows/update-geolocation-db.yml`:

```yaml
name: Update GeoLite2 Database

on:
  schedule:
    # Run on the 1st of every month at 2 AM UTC
    - cron: '0 2 1 * *'
  workflow_dispatch: # Allow manual trigger

jobs:
  update-database:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v3

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v2
        with:
          aws-access-key-id: ${{ secrets.AWS_ACCESS_KEY_ID }}
          aws-secret-access-key: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          aws-region: us-east-1

      - name: Get MaxMind credentials
        id: maxmind
        run: |
          SECRET=$(aws secretsmanager get-secret-value --secret-id maxmind-credentials --query SecretString --output text)
          echo "ACCOUNT_ID=$(echo $SECRET | jq -r .account_id)" >> $GITHUB_OUTPUT
          echo "LICENSE_KEY=$(echo $SECRET | jq -r .license_key)" >> $GITHUB_OUTPUT

      - name: Download latest GeoLite2 database
        run: |
          curl -o GeoLite2-Country.tar.gz \
            "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=${{ steps.maxmind.outputs.LICENSE_KEY }}&suffix=tar.gz"
          tar -xzf GeoLite2-Country.tar.gz
          find . -name "GeoLite2-Country.mmdb" -exec cp {} layers/geolocation/GeoLite2-Country.mmdb \;

      - name: Setup SAM CLI
        uses: aws-actions/setup-sam@v2

      - name: Build and deploy
        run: |
          sam build
          sam deploy --no-confirm-changeset --no-fail-on-empty-changeset

      - name: Verify deployment
        run: |
          echo "Deployment completed. Verify in AWS Console."
          # Add verification steps here (e.g., invoke test Lambda)
```

### GitLab CI Example

Create `.gitlab-ci.yml` job:

```yaml
update-geolocation-db:
  stage: deploy
  only:
    - schedules
  script:
    - apt-get update && apt-get install -y curl jq
    - SECRET=$(aws secretsmanager get-secret-value --secret-id maxmind-credentials --query SecretString --output text)
    - ACCOUNT_ID=$(echo $SECRET | jq -r .account_id)
    - LICENSE_KEY=$(echo $SECRET | jq -r .license_key)
    - curl -o GeoLite2-Country.tar.gz "https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=$LICENSE_KEY&suffix=tar.gz"
    - tar -xzf GeoLite2-Country.tar.gz
    - find . -name "GeoLite2-Country.mmdb" -exec cp {} layers/geolocation/GeoLite2-Country.mmdb \;
    - sam build
    - sam deploy --no-confirm-changeset --no-fail-on-empty-changeset
```

Schedule the job to run monthly in GitLab CI/CD settings.

## Update Frequency Recommendations

- **Production**: Monthly updates (1st of each month)
- **Staging**: Quarterly updates or before major releases
- **Development**: As needed, or use older database versions

## Troubleshooting

### Database File Not Found

**Symptom**: CloudWatch logs show "db_missing" errors

**Solution**:
1. Verify file exists: `ls -lh layers/geolocation/GeoLite2-Country.mmdb`
2. Check file permissions (should be readable)
3. Redeploy layer: `sam build && sam deploy`

### Lookup Failures After Update

**Symptom**: Increased "lookup_failed" errors after database update

**Solution**:
1. Verify database file integrity (not corrupted during download)
2. Check file size matches expected range (6-8 MB)
3. Re-download database from MaxMind
4. Redeploy with verified database file

### Layer Version Mismatch

**Symptom**: Lambda functions still using old layer version

**Solution**:
1. Check CloudFormation stack for layer version
2. Verify Lambda function configuration references latest layer
3. Force update: `sam deploy --force-upload`

## Monitoring

Set up CloudWatch alarms for:

1. **Geolocation Error Rate**:
   - Metric: Count of "lookup_failed" log entries
   - Threshold: > 5% of total lookups
   - Action: Alert operations team

2. **Database Missing Errors**:
   - Metric: Count of "db_missing" log entries
   - Threshold: > 0
   - Action: Immediate alert (critical)

3. **Unknown Country Rate**:
   - Metric: Percentage of events with country='unknown'
   - Threshold: > 20%
   - Action: Investigate potential database issues

## License Compliance

MaxMind GeoLite2 databases require attribution when displaying results to users. Ensure the following text appears in your analytics UI:

> This product includes GeoLite2 data created by MaxMind, available from https://www.maxmind.com

This attribution is already implemented in the dashboard UI.

## Additional Resources

- [MaxMind GeoLite2 Documentation](https://dev.maxmind.com/geoip/geolite2-free-geolocation-data)
- [MaxMind Database Updates](https://support.maxmind.com/hc/en-us/articles/4408216129947-Download-and-Update-Databases)
- [GeoIP2 Database Format](https://maxmind.github.io/MaxMind-DB/)
