// lib/in-app-browser.ts: spotting the browsers built into WhatsApp,
// Instagram and Facebook, where Google refuses to sign anyone in.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chromeIntentUrl,
  inAppBrowser,
  platformOf,
  suggestedBrowser,
} from '../lib/in-app-browser.ts';

const UA = {
  whatsappAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.146 Mobile Safari/537.36 WhatsApp/2.24.19.86',
  whatsappIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 WhatsApp/24.18.79',
  instagramIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 342.0.0.33.103 (iPhone14,5; iOS 17_5_1; en_GB; en; scale=3.00; 1170x2532; 627400398)',
  instagramAndroid:
    'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/127.0.6533.103 Mobile Safari/537.36 Instagram 343.0.0.40.99 Android (33/13; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 627400356)',
  facebookIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/476.0.0.49.109;FBBV/626131047;FBDV/iPhone15,2;FBMD/iPhone;FBSN/iOS;FBSV/17.6;FBSS/3;FBID/phone;FBLC/en_GB;FBOP/5;FBRV/628402498]',
  facebookAndroid:
    'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/128.0.6613.127 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/479.0.0.47.109;]',
  messengerIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/427.0.0.39.107;FBBV/521010447;FBDV/iPhone13,2;FBMD/iPhone;FBSN/iOS;FBSV/16.6;FBSS/3;FBCR/;FBID/phone;FBLC/en_GB;FBOP/5]',
  chromeAndroid:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36',
  safariIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
  chromeIos:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.6668.69 Mobile/15E148 Safari/604.1',
  firefoxDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  edgeDesktop:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
  samsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
};

test('WhatsApp, Instagram and Facebook (and Messenger) in-app browsers', () => {
  assert.equal(inAppBrowser(UA.whatsappAndroid), 'whatsapp');
  assert.equal(inAppBrowser(UA.whatsappIos), 'whatsapp');
  assert.equal(inAppBrowser(UA.instagramIos), 'instagram');
  assert.equal(inAppBrowser(UA.instagramAndroid), 'instagram');
  assert.equal(inAppBrowser(UA.facebookIos), 'facebook');
  assert.equal(inAppBrowser(UA.facebookAndroid), 'facebook');
  assert.equal(inAppBrowser(UA.messengerIos), 'facebook');
});

test('real browsers are not in-app', () => {
  for (const key of [
    'chromeAndroid',
    'safariIos',
    'chromeIos',
    'firefoxDesktop',
    'edgeDesktop',
    'samsung',
  ])
    assert.equal(inAppBrowser(UA[key]), null, key);
  assert.equal(inAppBrowser(''), null);
  assert.equal(inAppBrowser(null), null);
  assert.equal(inAppBrowser(undefined), null);
});

test('the browser to suggest follows the platform', () => {
  assert.equal(platformOf(UA.whatsappAndroid), 'android');
  assert.equal(platformOf(UA.instagramIos), 'ios');
  assert.equal(platformOf(UA.firefoxDesktop), 'other');
  assert.equal(suggestedBrowser(UA.facebookAndroid), 'Chrome');
  assert.equal(suggestedBrowser(UA.whatsappIos), 'Safari');
  assert.equal(suggestedBrowser(UA.edgeDesktop), 'your usual browser');
});

test('an Android intent link opens the same page in Chrome', () => {
  assert.equal(
    chromeIntentUrl('https://poli-lingo.vercel.app/sign-in?next=%2Flearn'),
    'intent://poli-lingo.vercel.app/sign-in?next=%2Flearn#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=https%3A%2F%2Fpoli-lingo.vercel.app%2Fsign-in%3Fnext%3D%252Flearn;end',
  );
  assert.equal(chromeIntentUrl('http://localhost:3000/sign-in'), null);
  assert.equal(chromeIntentUrl('not a url'), null);
});
