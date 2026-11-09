// Inside the iPhone/Android app, links to our own pages (/terms.html,
// /privacy.html, /wrench-day.html, ...) don't work: target="_blank" is ignored
// by the app's web view, and a plain link would load the page with no way back
// into the app. So on native, catch those taps and open the live page from
// wrenched.shop in an in-app browser sheet (with a Done button) instead.
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";

const SITE = "https://wrenched.shop";

if (Capacitor.isNativePlatform()) {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.("a[href]");
    if (!a) return;
    const url = new URL(a.getAttribute("href"), window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.endsWith(".html")) return;
    e.preventDefault();
    Browser.open({ url: SITE + url.pathname + url.search + url.hash });
  });
}
