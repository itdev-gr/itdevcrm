import { describe, it, expect } from 'vitest';
import { isSuspectedBotUa } from './_bot-ua';

describe('isSuspectedBotUa', () => {
  it('flags known scanner/preview agents', () => {
    for (const ua of [
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'GoogleImageProxy',
      'facebookexternalhit/1.1',
      'WhatsApp/2.23.20',
      'Slackbot-LinkExpanding 1.0',
      'Mozilla/5.0 HeadlessChrome/120.0',
      'Outlook-SafeLinks-Scan',
    ]) {
      expect(isSuspectedBotUa(ua), ua).toBe(true);
    }
  });

  it('passes real browser agents', () => {
    for (const ua of [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    ]) {
      expect(isSuspectedBotUa(ua), ua).toBe(false);
    }
  });

  it('treats a missing/empty UA as bot', () => {
    expect(isSuspectedBotUa(undefined)).toBe(true);
    expect(isSuspectedBotUa('')).toBe(true);
    expect(isSuspectedBotUa('   ')).toBe(true);
  });
});
