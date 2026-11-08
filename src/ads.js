// Ads for the free version of Wrenched.
//
// Native (iOS/Android): Google AdMob via @capacitor-community/admob — a banner
// pinned to the bottom of the screen, plus an occasional full-screen
// interstitial after finishing a maintenance task (capped, see below).
// Web: Google AdSense, rendered inline by <WebAdSlot/> in App.jsx.
//
// Anyone who bought Remove Ads (subscriptions.status === "active") never sees
// either one — App.jsx only calls into this file when the user isn't ad-free.
//
// Real AdMob ad unit IDs are below (they're public, not secrets). To test with
// Google's test ads instead — e.g. while developing in the simulator — set
// VITE_ADMOB_TEST=1 in a local .env file. Never tap your own live ads.
// The AdMob *app* IDs (with a ~) live in Info.plist and AndroidManifest.xml.

import { Capacitor } from "@capacitor/core";
import { AdMob, BannerAdPosition, BannerAdSize, BannerAdPluginEvents, AdmobConsentStatus } from "@capacitor-community/admob";

const platform = Capacitor.getPlatform();
const env = import.meta.env;

// Google's public test ad units — safe to load as often as you like.
const TEST_UNITS = {
  ios: { banner: "ca-app-pub-3940256099942544/2435281174", interstitial: "ca-app-pub-3940256099942544/4411468910" },
  android: { banner: "ca-app-pub-3940256099942544/9214589741", interstitial: "ca-app-pub-3940256099942544/1033173712" },
};
const REAL_UNITS = {
  ios: { banner: "ca-app-pub-5823580625659011/8612419854", interstitial: "ca-app-pub-5823580625659011/8063569604" },
  android: { banner: "ca-app-pub-5823580625659011/4315896287", interstitial: "ca-app-pub-5823580625659011/1689732941" },
};

const USE_TEST_ADS = env.VITE_ADMOB_TEST === "1";
const unit = (kind) => (USE_TEST_ADS ? TEST_UNITS : REAL_UNITS)[platform]?.[kind];
const isTesting = () => USE_TEST_ADS;

// At most one interstitial every 4 minutes, and never in the first 2 minutes
// of a session — enough to earn something without making the app feel spammy.
const INTERSTITIAL_GAP_MS = 4 * 60 * 1000;
const sessionStart = Date.now();
let lastInterstitial = sessionStart - INTERSTITIAL_GAP_MS + 2 * 60 * 1000;

let initPromise = null;
let bannerVisible = false;
let interstitialReady = false;
let sizeListener = null;

// Consent (Google's UMP form — only actually shown in the EU/UK/etc. where
// it's legally required) → Apple's App Tracking Transparency prompt (iOS only,
// once ever) → SDK init. Personalized ads only serve when the user allows it;
// AdMob falls back to non-personalized ads on its own otherwise.
export function initAds() {
  if (!Capacitor.isNativePlatform()) return Promise.resolve(false);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      const consent = await AdMob.requestConsentInfo();
      if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
        await AdMob.showConsentForm();
      }
    } catch (err) {
      console.warn("AdMob consent check failed:", err);
    }
    if (platform === "ios") {
      try {
        const { status } = await AdMob.trackingAuthorizationStatus();
        if (status === "notDetermined") await AdMob.requestTrackingAuthorization();
      } catch (err) {
        console.warn("ATT prompt failed:", err);
      }
    }
    await AdMob.initialize({ initializeForTesting: isTesting("banner") });
    return true;
  })().catch((err) => {
    console.error("AdMob init failed:", err);
    initPromise = null;
    return false;
  });
  return initPromise;
}

// onHeight lets the app pad its bottom edge so the banner never covers content.
export async function showBanner(onHeight) {
  if (!(await initAds()) || bannerVisible) return;
  bannerVisible = true;
  if (onHeight) {
    sizeListener = await AdMob.addListener(BannerAdPluginEvents.SizeChanged, (size) => onHeight(size?.height || 0));
  }
  try {
    await AdMob.showBanner({
      adId: unit("banner"),
      adSize: BannerAdSize.ADAPTIVE_BANNER,
      position: BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: isTesting("banner"),
    });
  } catch (err) {
    bannerVisible = false;
    console.warn("Banner failed:", err);
  }
}

export async function removeBanner() {
  if (!Capacitor.isNativePlatform() || !bannerVisible) return;
  bannerVisible = false;
  try {
    await AdMob.removeBanner();
    await sizeListener?.remove();
    sizeListener = null;
  } catch { /* already gone */ }
}

async function prepareInterstitial() {
  if (interstitialReady) return;
  try {
    await AdMob.prepareInterstitial({ adId: unit("interstitial"), isTesting: isTesting("interstitial") });
    interstitialReady = true;
  } catch (err) {
    console.warn("Interstitial failed to load:", err);
  }
}

// Call after a natural "done" moment (finished the setup wizard, logged a
// service). Silently does nothing if it's too soon or no ad is loaded.
export async function maybeShowInterstitial() {
  if (!(await initAds())) return;
  if (Date.now() - lastInterstitial < INTERSTITIAL_GAP_MS) {
    prepareInterstitial();
    return;
  }
  if (!interstitialReady) {
    prepareInterstitial();
    return;
  }
  interstitialReady = false;
  lastInterstitial = Date.now();
  try {
    await AdMob.showInterstitial();
  } catch (err) {
    console.warn("Interstitial failed to show:", err);
  }
  prepareInterstitial();
}

// Warm one up early so the first eligible moment has an ad ready.
export function preloadInterstitial() {
  initAds().then((ok) => ok && prepareInterstitial());
}

// Shown in Settings/footer for EU users, who must be able to change consent later.
export async function showPrivacyOptions() {
  if (!Capacitor.isNativePlatform()) return;
  try { await AdMob.showPrivacyOptionsForm(); } catch (err) { console.warn(err); }
}
