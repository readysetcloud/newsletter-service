/**
 * Unit tests for device detection utility
 */

import { detectDevice } from '../detect-device.mjs';

describe('detectDevice', () => {
  describe('mobile devices', () => {
    it('should detect iPhone', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect Android phone', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect iPod', () => {
      const ua = 'Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect BlackBerry', () => {
      const ua = 'Mozilla/5.0 (BlackBerry; U; BlackBerry 9900; en) AppleWebKit/534.11+ (KHTML, like Gecko) Version/7.1.0.346 Mobile Safari/534.11+';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect Windows Phone', () => {
      const ua = 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0.2743.116 Mobile Safari/537.36 Edge/15.14977';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect WebOS', () => {
      const ua = 'Mozilla/5.0 (webOS/1.4.0; U; en-US) AppleWebKit/532.2 (KHTML, like Gecko) Version/1.0 Safari/532.2 Pre/1.0';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect generic mobile user agent', () => {
      const ua = 'Mozilla/5.0 (Mobile; rv:26.0) Gecko/26.0 Firefox/26.0';
      expect(detectDevice(ua)).toBe('mobile');
    });
  });

  describe('tablet devices', () => {
    it('should detect iPad', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
      expect(detectDevice(ua)).toBe('tablet');
    });

    it('should detect Android tablet', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X906C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('tablet');
    });

    it('should detect Kindle tablet', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 4.4.3; KFTHWI Build/KTU84M) AppleWebKit/537.36 (KHTML, like Gecko) Silk/47.1.79 like Chrome/47.0.2526.80 Safari/537.36';
      expect(detectDevice(ua)).toBe('tablet');
    });

    it('should detect generic tablet user agent', () => {
      const ua = 'Mozilla/5.0 (Tablet; rv:26.0) Gecko/26.0 Firefox/26.0';
      expect(detectDevice(ua)).toBe('tablet');
    });
  });

  describe('desktop devices', () => {
    it('should detect Windows desktop', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('desktop');
    });

    it('should detect macOS desktop', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('desktop');
    });

    it('should detect Linux desktop', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('desktop');
    });

    it('should detect X11 desktop', () => {
      const ua = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/112.0';
      expect(detectDevice(ua)).toBe('desktop');
    });
  });

  describe('unknown devices', () => {
    it('should return unknown for empty string', () => {
      expect(detectDevice('')).toBe('unknown');
    });

    it('should return unknown for null', () => {
      expect(detectDevice(null)).toBe('unknown');
    });

    it('should return unknown for undefined', () => {
      expect(detectDevice(undefined)).toBe('unknown');
    });

    it('should return unknown for non-string input', () => {
      expect(detectDevice(123)).toBe('unknown');
      expect(detectDevice({})).toBe('unknown');
      expect(detectDevice([])).toBe('unknown');
    });

    it('should return unknown for unrecognized user agent', () => {
      const ua = 'CustomBot/1.0';
      expect(detectDevice(ua)).toBe('unknown');
    });

    it('should return unknown for bot user agent', () => {
      const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
      expect(detectDevice(ua)).toBe('unknown');
    });
  });

  describe('case insensitivity', () => {
    it('should handle uppercase user agent', () => {
      const ua = 'MOZILLA/5.0 (IPHONE; CPU IPHONE OS 16_0 LIKE MAC OS X) APPLEWEBKIT/605.1.15';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should handle mixed case user agent', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
      expect(detectDevice(ua)).toBe('desktop');
    });
  });

  describe('edge cases', () => {
    it('should prioritize tablet over mobile for iPad', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
      expect(detectDevice(ua)).toBe('tablet');
    });

    it('should detect Android tablet without mobile keyword', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X906C) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('tablet');
    });

    it('should detect Android phone with mobile keyword', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36';
      expect(detectDevice(ua)).toBe('mobile');
    });
  });

  describe('common real-world user agents', () => {
    it('should detect Chrome on Windows', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('desktop');
    });

    it('should detect Safari on macOS', () => {
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
      expect(detectDevice(ua)).toBe('desktop');
    });

    it('should detect Firefox on Linux', () => {
      const ua = 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
      expect(detectDevice(ua)).toBe('desktop');
    });

    it('should detect Safari on iPhone', () => {
      const ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect Chrome on Android phone', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
      expect(detectDevice(ua)).toBe('mobile');
    });

    it('should detect Safari on iPad', () => {
      const ua = 'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
      expect(detectDevice(ua)).toBe('tablet');
    });

    it('should detect Samsung Internet on Android tablet', () => {
      const ua = 'Mozilla/5.0 (Linux; Android 13; SM-X906C) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Safari/537.36';
      expect(detectDevice(ua)).toBe('tablet');
    });
  });
});
