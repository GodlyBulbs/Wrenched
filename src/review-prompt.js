// Apple/Google's built-in "Enjoying Wrenched?" rating pop-up.
//
// Asked once a user has logged a few services (they've gotten real value),
// and never more than once every 90 days from our side. The OS adds its own
// limits on top (Apple shows it at most 3 times a year and may skip it), so
// this can be called freely at "happy moments".
import { Capacitor } from "@capacitor/core";
import { InAppReview } from "@capacitor-community/in-app-review";

const DONE_KEY = "wrenched.servicesLogged";
const ASKED_KEY = "wrenched.reviewAskedAt";
const MIN_SERVICES = 3;
const COOLDOWN_MS = 90 * 24 * 60 * 60 * 1000;

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

// Call after the user marks a service as done. Returns true if it asked for
// a review, so the caller can skip showing an ad at the same moment.
export function noteServiceLogged() {
  if (!Capacitor.isNativePlatform()) return false;
  const count = (parseInt(read(DONE_KEY), 10) || 0) + 1;
  write(DONE_KEY, String(count));
  if (count < MIN_SERVICES) return false;
  const last = parseInt(read(ASKED_KEY), 10) || 0;
  if (Date.now() - last < COOLDOWN_MS) return false;
  write(ASKED_KEY, String(Date.now()));
  // Small delay so it appears after the "done" UI settles, not on top of it.
  setTimeout(() => { InAppReview.requestReview().catch(() => {}); }, 1200);
  return true;
}
