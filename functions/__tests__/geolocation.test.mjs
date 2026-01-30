import { jest } from '@jest/globals';

describe('geolocation - lookupCountry', () => {
  let mockReader;
  let mockFs;
  let mockMaxmind;
  let lookupCountry;

  beforeEach(async () => {
    jest.resetModules();

    mockReader = {
      get: jest.fn().mockReturnValue({
        country: {
          iso_code: 'US',
          names: { en: 'United States' }
        }
      })
    };

    mockFs = {
      readFileSync: jest.fn().mockReturnValue(Buffer.from('mock-db'))
    };

    mockMaxmind = {
      Reader: jest.fn().mockImplementation(() => mockReader)
    };

    jest.unstable_mockModule('fs', () => mockFs);
    jest.unstable_mockModule('maxmind', () => mockMaxmind);

    const module = await import(`../utils/geolocation.mjs?update=${Date.now()}`);
    lookupCountry = module.lookupCountry;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns country structure for valid public IPv4', async () => {
    const result = await lookupCountry('8.8.8.8');

    expect(result).toEqual({
      countryCode: 'US',
      countryName: 'United States'
    });
    expect(mockReader.get).toHaveBeenCalledWith('8.8.8.8');
  });

  it('uses iso_code as countryName when names.en is missing', async () => {
    mockReader.get.mockReturnValue({
      country: {
        iso_code: 'XX'
      }
    });

    const result = await lookupCountry('8.8.8.8');

    expect(result).toEqual({
      countryCode: 'XX',
      countryName: 'XX'
    });
  });

  it('returns null for private IPv4 addresses', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await lookupCountry('10.0.0.1');
    expect(result).toBeNull();
    expect(mockReader.get).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('returns null when database lookup returns no country', async () => {
    mockReader.get.mockReturnValue({});

    const result = await lookupCountry('8.8.8.8');
    expect(result).toBeNull();
  });

  it('returns null when database lookup returns null', async () => {
    mockReader.get.mockReturnValue(null);

    const result = await lookupCountry('8.8.8.8');
    expect(result).toBeNull();
  });

  it('returns null and logs when database file is missing', async () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file');
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await lookupCountry('8.8.8.8');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Geolocation database initialization failed',
      { reason: 'db_missing' }
    );

    consoleSpy.mockRestore();
  });

  it('returns null and logs when lookup throws invalid IP error', async () => {
    mockReader.get.mockImplementation(() => {
      throw new Error('invalid IP address');
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await lookupCountry('8.8.8.8');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Geolocation lookup failed',
      { reason: 'invalid_ip' }
    );

    consoleSpy.mockRestore();
  });

  it('returns null and logs when lookup throws other error', async () => {
    mockReader.get.mockImplementation(() => {
      throw new Error('database corrupted');
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    const result = await lookupCountry('8.8.8.8');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith(
      'Geolocation lookup failed',
      { reason: 'lookup_failed' }
    );

    consoleSpy.mockRestore();
  });

  it('returns null for null input', async () => {
    const result = await lookupCountry(null);
    expect(result).toBeNull();
    expect(mockReader.get).not.toHaveBeenCalled();
  });
});
