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

export async function lookupCountry(ipAddress) {
  if (!ipAddress || !isPublicIp(ipAddress)) {
    if (ipAddress && !isPublicIp(ipAddress)) {
      console.error('Geolocation lookup failed', { reason: 'private_ip' });
    }
    return null;
  }

  try {
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
      countryName: result.country.names?.en || result.country.iso_code
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
