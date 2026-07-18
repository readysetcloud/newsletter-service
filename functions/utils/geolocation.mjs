import { Reader } from 'maxmind';
import { readFileSync } from 'fs';

let dbReader = null;

function isPrivateIpv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true;
  }

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 0) return true;
  if (ip === '255.255.255.255') return true;
  if (a === 192 && b === 0 && parts[2] === 2) return true;
  if (a === 198 && b === 51 && parts[2] === 100) return true;
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  return false;
}

function isPrivateIpv6(ip) {
  const lower = ip.toLowerCase();

  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb')) return true;
  if (lower.startsWith('2001:db8:') || lower.startsWith('2001:0db8:')) return true;

  return false;
}

function isPublicIp(ip) {
  if (!ip || typeof ip !== 'string') return false;

  const trimmed = ip.trim();
  if (!trimmed) return false;

  if (trimmed.includes(':')) {
    return !isPrivateIpv6(trimmed);
  }

  return !isPrivateIpv4(trimmed);
}

let cityDbChecked = false;
let cityDbReader = null;

/**
 * Lazily load the GeoLite2 City database if it is present in the layer.
 * The City edition includes location.time_zone (IANA name), which the Country
 * edition does not. Missing City DB is expected until the layer ships it, so
 * absence is remembered without logging an error on every lookup.
 */
function getCityReader() {
  if (!cityDbChecked) {
    cityDbChecked = true;
    try {
      const buffer = readFileSync('/opt/GeoLite2-City.mmdb');
      cityDbReader = new Reader(buffer);
    } catch {
      cityDbReader = null;
    }
  }
  return cityDbReader;
}

/**
 * Resolve an IP address to country and, when the City database is available,
 * the IANA timezone. Falls back to the Country database (timeZone: null) when
 * the City database is not deployed in the layer.
 *
 * @param {string} ipAddress
 * @returns {Promise<{countryCode: string, countryName: string, timeZone: string|null}|null>}
 */
export async function lookupGeo(ipAddress) {
  if (!ipAddress || !isPublicIp(ipAddress)) {
    if (ipAddress && !isPublicIp(ipAddress)) {
      console.error('Geolocation lookup failed', { reason: 'private_ip' });
    }
    return null;
  }

  try {
    const cityReader = getCityReader();
    if (cityReader) {
      const result = cityReader.get(ipAddress);
      if (result?.country) {
        return {
          countryCode: result.country.iso_code,
          countryName: result.country.names?.en || result.country.iso_code,
          timeZone: result.location?.time_zone || null
        };
      }
      // City DB present but no record for this IP — fall through to the
      // Country DB, which has independent coverage.
    }

    if (!dbReader) {
      const dbPath = '/opt/GeoLite2-Country.mmdb';
      try {
        const buffer = readFileSync(dbPath);
        dbReader = new Reader(buffer);
      } catch (err) {
        console.error('Geolocation database initialization failed', { reason: 'db_missing' });
        return null;
      }
    }

    const result = dbReader.get(ipAddress);

    if (!result || !result.country) {
      return null;
    }

    return {
      countryCode: result.country.iso_code,
      countryName: result.country.names?.en || result.country.iso_code,
      timeZone: null
    };
  } catch (err) {
    if (err.message?.includes('invalid')) {
      console.error('Geolocation lookup failed', { reason: 'invalid_ip' });
    } else {
      console.error('Geolocation lookup failed', { reason: 'lookup_failed' });
    }
    return null;
  }
}

/**
 * Country-only lookup, kept for existing callers. Same result shape as before
 * ({countryCode, countryName} or null).
 */
export async function lookupCountry(ipAddress) {
  const geo = await lookupGeo(ipAddress);
  if (!geo) return null;
  return { countryCode: geo.countryCode, countryName: geo.countryName };
}
