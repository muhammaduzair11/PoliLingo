/**
 * In-app browsers (docs/platform.md 4.8). Google refuses to sign anyone in
 * inside the browsers built into WhatsApp, Instagram and Facebook
 * ("disallowed_useragent"), and links to PoliLingo are mostly shared in
 * exactly those apps. So the sign-in page spots them, leaves out the
 * Google button, and says how to open the page in the phone's own browser;
 * the email code works anywhere.
 *
 * Pure: pass it navigator.userAgent.
 */

export type InAppBrowser = 'whatsapp' | 'instagram' | 'facebook';

export const IN_APP_NAMES: Readonly<Record<InAppBrowser, string>> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
};

/** Which in-app browser a user agent belongs to, or null for a real browser. */
export function inAppBrowser(
  userAgent: string | null | undefined,
): InAppBrowser | null {
  const ua = userAgent ?? '';
  if (/\bWhatsApp\//i.test(ua)) return 'whatsapp';
  if (/\bInstagram[\s/]\d/i.test(ua)) return 'instagram';
  // Facebook and Messenger: FBAN/FBAV on iOS, FB_IAB/FBAV on Android.
  if (/\bFB(?:AN|AV|_IAB|IOS|DV|SV)\b|\[FB[A-Z_]*[;/]/.test(ua))
    return 'facebook';
  return null;
}

export type Platform = 'android' | 'ios' | 'other';

export function platformOf(userAgent: string | null | undefined): Platform {
  const ua = userAgent ?? '';
  if (/\bAndroid\b/i.test(ua)) return 'android';
  if (/\b(?:iPhone|iPad|iPod)\b/.test(ua)) return 'ios';
  return 'other';
}

/** The browser to suggest: Chrome on Android, Safari on an iPhone. */
export function suggestedBrowser(userAgent: string | null | undefined): string {
  const platform = platformOf(userAgent);
  if (platform === 'android') return 'Chrome';
  if (platform === 'ios') return 'Safari';
  return 'your usual browser';
}

/**
 * An Android intent link that opens an https URL in Chrome from an in-app
 * browser, falling back to the same URL. Null for anything but https.
 */
export function chromeIntentUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const target = `${url.host}${url.pathname}${url.search}`;
  return `intent://${target}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(url.href)};end`;
}
