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

describe('geolocation - lookupGeo (City DB timezone support)', () => {
  let mockFs;
  let mockMaxmind;
  let lookupGeo;
  let readersByDb;

  /**
   * Wire the fs/maxmind mocks so the City and Country databases can be
   * configured independently. `cityDb`/`countryDb` are either a record the
   * reader returns, or the string 'missing' to make readFileSync throw for
   * that path.
   */
  const setup = async ({ cityDb, countryDb }) => {
    jest.resetModules();
    readersByDb = new Map();

    mockFs = {
      readFileSync: jest.fn((path) => {
        if (path.includes('City') && cityDb === 'missing') {
          throw new Error('ENOENT: no such file');
        }
        if (path.includes('Country') && countryDb === 'missing') {
          throw new Error('ENOENT: no such file');
        }
        return Buffer.from(path); // path travels to the Reader constructor
      })
    };

    mockMaxmind = {
      Reader: jest.fn().mockImplementation((buffer) => {
        const path = buffer.toString();
        const record = path.includes('City') ? cityDb : countryDb;
        const reader = { get: jest.fn().mockReturnValue(record) };
        readersByDb.set(path.includes('City') ? 'city' : 'country', reader);
        return reader;
      })
    };

    jest.unstable_mockModule('fs', () => mockFs);
    jest.unstable_mockModule('maxmind', () => mockMaxmind);

    const module = await import(`../utils/geolocation.mjs?update=${Date.now()}-${Math.random()}`);
    lookupGeo = module.lookupGeo;
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns timezone from the City database when present', async () => {
    await setup({
      cityDb: {
        country: { iso_code: 'US', names: { en: 'United States' } },
        location: { time_zone: 'America/New_York' }
      },
      countryDb: { country: { iso_code: 'US', names: { en: 'United States' } } }
    });

    const result = await lookupGeo('8.8.8.8');

    expect(result).toEqual({
      countryCode: 'US',
      countryName: 'United States',
      timeZone: 'America/New_York'
    });
    // The Country DB must not even be loaded when City resolves the IP.
    expect(readersByDb.has('country')).toBe(false);
  });

  it('returns null timeZone when the City record has no location', async () => {
    await setup({
      cityDb: { country: { iso_code: 'DE', names: { en: 'Germany' } } },
      countryDb: 'missing'
    });

    const result = await lookupGeo('8.8.8.8');
    expect(result).toEqual({ countryCode: 'DE', countryName: 'Germany', timeZone: null });
  });

  it('falls back to the Country database when the City database is missing', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await setup({
      cityDb: 'missing',
      countryDb: { country: { iso_code: 'FR', names: { en: 'France' } } }
    });

    const result = await lookupGeo('8.8.8.8');

    expect(result).toEqual({ countryCode: 'FR', countryName: 'France', timeZone: null });
    // Missing City DB is an expected deployment state, not an error.
    expect(consoleSpy).not.toHaveBeenCalledWith(
      'Geolocation database initialization failed',
      expect.anything()
    );
    consoleSpy.mockRestore();
  });

  it('falls back to the Country database when City has no record for the IP', async () => {
    await setup({
      cityDb: null,
      countryDb: { country: { iso_code: 'JP', names: { en: 'Japan' } } }
    });

    const result = await lookupGeo('8.8.8.8');
    expect(result).toEqual({ countryCode: 'JP', countryName: 'Japan', timeZone: null });
  });

  it('returns null for private IPs without touching either database', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
    await setup({
      cityDb: { country: { iso_code: 'US' }, location: { time_zone: 'America/Chicago' } },
      countryDb: {}
    });

    const result = await lookupGeo('192.168.1.10');
    expect(result).toBeNull();
    expect(mockFs.readFileSync).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
