# MaxMind GeoLite2 Database Update Process

This document describes how to update the MaxMind GeoLite2 databases used for IP geolocation in analytics.

## Overview

The geolocation feature uses two MaxMind GeoLite2 databases:

- **GeoLite2 Country** (`GeoLite2-Country.mmdb`, ~6-8 MB) — converts IP addresses to country codes for analytics. Required.
- **GeoLite2 City** (`GeoLite2-City.mmdb`, ~60 MB) — additionally provides the IANA timezone (`location.time_zone`) used for subscriber timezone detection and the local-send feature. Optional but strongly recommended: without it, subscriber timezones are never detected and local send falls back to sending everyone at the default time.

Both files live in the geolocation Lambda layer and are read from `/opt/` at runtime (`functions/utils/geolocation.mjs`). The code prefers the City database and silently falls back to Country-only lookups when `GeoLite2-City.mmdb` is absent, so the City database can be added to the layer at any time without a code change.

MaxMind updates these databases weekly, but we recommend monthly updates for a balance between accuracy and operational overhead.

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

### Download Latest Databases

1. Log in to your MaxMind account
2. Navigate to "Download Files"
3. Download "GeoLite2 Country" and "GeoLite2 City" in MMDB format
4. Extract each `.tar.gz` file
5. Locate `GeoLite2-Country.mmdb` and `GeoLite2-City.mmdb` in the extracted folders

### Update Lambda Layer

The layer ships as a prebuilt zip committed to the repository
(`functions/layers/geolocation-layer.zip`) with the `.mmdb` files at the zip
root and the `maxmind` node module under `nodejs/`. To rebuild it:

1. Unpack the current layer (preserves the bundled node module):
   ```bash
   mkdir -p /tmp/geo-layer
   unzip functions/layers/geolocation-layer.zip -d /tmp/geo-layer
   ```

2. Replace the database files and verify sizes (Country ~6-10 MB, City ~60 MB):
   ```bash
   cp /path/to/downloaded/GeoLite2-Country.mmdb /tmp/geo-layer/GeoLite2-Country.mmdb
   cp /path/to/downloaded/GeoLite2-City.mmdb /tmp/geo-layer/GeoLite2-City.mmdb
   ls -lh /tmp/geo-layer/*.mmdb
   ```

3. Repack and deploy:
   ```bash
   (cd /tmp/geo-layer && zip -r geolocation-layer.zip .)
   mv /tmp/geo-layer/geolocation-layer.zip functions/layers/geolocation-layer.zip
   sam build && sam deploy
   ```

4. **Verify after deploy**:
   - Confirm country data is appearing correctly
   - Verify no "unknown" countries for valid public IPs
   - Check CloudWatch logs for geolocation errors and confirm no increase in
     error rates after the update

## Automated Monthly Updates (GitHub Actions)

The repository ships a scheduled workflow that keeps both databases fresh:
[`.github/workflows/update-geolocation-db.yml`](../.github/workflows/update-geolocation-db.yml).

On the 1st of every month (or on manual dispatch) it:

1. Downloads the latest GeoLite2 Country and City databases from MaxMind
2. Sanity-checks the file sizes so a truncated download or error page can never ship
3. Rebuilds `functions/layers/geolocation-layer.zip` in place, preserving the bundled
   `maxmind` node module — and skips everything if the database contents are unchanged
4. Opens a pull request against `main` with the updated layer zip

`main` is a protected branch (pull requests required), so the workflow opens a PR
rather than committing directly. **Merging the PR** is what ships the update: your
merge is a real-user push to `main`, which triggers the regular
[Deploy to Production workflow](../.github/workflows/deploy.yaml) to build and
deploy the refreshed layer. (A push made with the workflow's own token does not
trigger downstream workflows, which is why a human merge is what drives the deploy.)
It's a binary database bump, so there's nothing to review beyond the layer zip itself.

### One-time setup

1. Create a free MaxMind license key (see [Generate License Key](#generate-license-key) above)
2. Add it as a repository secret named `MAXMIND_LICENSE_KEY`
   (Settings → Secrets and variables → Actions)
3. No additional AWS setup is needed — deployment runs through the existing
   Deploy to Production workflow when you merge the PR, using its `prod`
   environment credentials (`PROD_ACCESS_KEY` / `PROD_SECRET_KEY`)

To run an update immediately: Actions → "Update GeoLite2 Databases" → Run workflow,
then merge the pull request it opens.

## Update Frequency Recommendations

- **Production**: Monthly updates (1st of each month)
- **Staging**: Quarterly updates or before major releases
- **Development**: As needed, or use older database versions

## Troubleshooting

### Database File Not Found

**Symptom**: CloudWatch logs show "db_missing" errors

**Solution**:
1. Verify the file is in the layer zip: `unzip -l functions/layers/geolocation-layer.zip`
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
