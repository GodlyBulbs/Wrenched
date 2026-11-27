// Display settings: light/dark mode, accent color, high contrast, text size.
//
// Every color in the app's UI is a CSS variable named after its original dark
// theme hex value — e.g. var(--w-0d0d0d) for the page background. This file
// decides what each variable resolves to for the user's chosen look, so the
// components never need to know which theme is active. Car paint colors
// (garage cards, color picker) are real data and are never themed.

import { Capacitor } from "@capacitor/core";
import { TextZoom } from "@capacitor/text-zoom";
import { StatusBar, Style } from "@capacitor/status-bar";

export const ACCENTS = {
  orange: { label: "Orange", hex: "#FF6B2B", onAccent: "#0D0D0D" },
  blue:   { label: "Blue",   hex: "#2F7DF6", onAccent: "#FFFFFF" },
  green:  { label: "Green",  hex: "#1FA34A", onAccent: "#FFFFFF" },
  red:    { label: "Red",    hex: "#E5383B", onAccent: "#FFFFFF" },
  purple: { label: "Purple", hex: "#8B5CF6", onAccent: "#FFFFFF" },
  yellow: { label: "Yellow", hex: "#F5B700", onAccent: "#0D0D0D" },
  teal:   { label: "Teal",   hex: "#14B8A6", onAccent: "#0D0D0D" },
};

export const TEXT_SIZES = [
  { key: "system", label: "Phone setting" },
  { key: "0.9", label: "Small" },
  { key: "1", label: "Default" },
  { key: "1.15", label: "Large" },
  { key: "1.3", label: "Extra large" },
  { key: "1.5", label: "Huge" },
];

export const DEFAULT_PREFS = { mode: "dark", accent: "orange", contrast: false, textSize: "system" };
const KEY = "wrenched.display";

// Neutral palette, keyed by the original dark-theme hex.
// [dark, dark + high contrast, light, light + high contrast]
const NEUTRALS = {
  "0d0d0d": ["#0D0D0D", "#000000", "#F6F6F4", "#FFFFFF"], // page background
  "111111": ["#111111", "#050505", "#EFEFEC", "#F4F4F2"],
  "1c1c1c": ["#1C1C1C", "#141414", "#FFFFFF", "#FFFFFF"], // cards, inputs
  "222222": ["#222222", "#2E2E2E", "#E4E4E0", "#C9C9C4"],
  "2a2a2a": ["#2A2A2A", "#4A4A4A", "#D9D9D4", "#A8A8A2"], // borders
  "333333": ["#333333", "#5A5A5A", "#BDBDB8", "#8A8A85"],
  "3a3a3a": ["#3A3A3A", "#666666", "#B0B0AB", "#7A7A75"],
  "444444": ["#444444", "#8A8A8A", "#85857F", "#55554F"], // faint text
  "555555": ["#555555", "#9A9A9A", "#6E6E69", "#45453F"],
  "666666": ["#666666", "#A8A8A8", "#5E5E59", "#3A3A35"],
  "777777": ["#777777", "#B4B4B4", "#55554F", "#33332F"],
  "888888": ["#888888", "#C4C4C4", "#4A4A45", "#2A2A26"],
  "999999": ["#999999", "#D0D0D0", "#3F3F3B", "#222220"],
  "c8c4bc": ["#C8C4BC", "#EDEAE4", "#2C2A26", "#141210"], // body text
  "e8e4dc": ["#E8E4DC", "#FFFFFF", "#151310", "#000000"], // headings
  "ffffff": ["#FFFFFF", "#FFFFFF", "#FFFFFF", "#FFFFFF"],
};
// Status colors: [dark, light]
const STATUS = {
  "ff3b3b": ["#FF3B3B", "#C62828"], // overdue / errors
  "f5c800": ["#F5C800", "#9A7A00"], // due soon
  "1ce84a": ["#1CE84A", "#14892F"], // good
  "5faf5f": ["#5FAF5F", "#2E7D32"],
  "3b9ae8": ["#3B9AE8", "#1565C0"],
};

const hexToRgb = (h) => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  const m = (x, y) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
};

export function loadPrefs() {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; }
  catch { return { ...DEFAULT_PREFS }; }
}
export function savePrefs(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ }
}

const prefersLight = () => window.matchMedia?.("(prefers-color-scheme: light)").matches;
export const resolvedMode = (p) => (p.mode === "system" ? (prefersLight() ? "light" : "dark") : p.mode);

export function applyPrefs(p) {
  const light = resolvedMode(p) === "light";
  const col = (light ? 2 : 0) + (p.contrast ? 1 : 0);
  const acc = ACCENTS[p.accent] || ACCENTS.orange;
  const bg = NEUTRALS["0d0d0d"][col];
  const vars = {};
  for (const [k, v] of Object.entries(NEUTRALS)) vars[`--w-${k}`] = v[col];
  for (const [k, v] of Object.entries(STATUS)) {
    vars[`--w-${k}`] = v[light ? 1 : 0];
    vars[`--w-${k}-rgb`] = hexToRgb(v[light ? 1 : 0]).join(",");
  }
  vars["--w-ff6b2b"] = acc.hex;
  vars["--w-on-accent"] = acc.onAccent;
  vars["--w-accent-rgb"] = hexToRgb(acc.hex).join(",");
  vars["--w-ink-rgb"] = light ? "0,0,0" : "255,255,255"; // subtle highlights/borders
  // The warm accent-tinted panels (Remove Ads strip, On-Site card).
  vars["--w-151210"] = mix(bg, acc.hex, light ? 0.07 : 0.05);
  vars["--w-2a2620"] = mix(bg, acc.hex, light ? 0.25 : 0.14);
  vars["--w-2a3a2a"] = light ? "#BFE0BF" : "#2A3A2A";

  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = light ? "light" : "dark";
  root.style.colorScheme = light ? "light" : "dark";
  document.body.style.background = bg;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = bg;

  applyTextSize(p.textSize);
  if (Capacitor.isNativePlatform()) {
    StatusBar.setStyle({ style: light ? Style.Light : Style.Dark }).catch(() => {});
    if (Capacitor.getPlatform() === "android") StatusBar.setBackgroundColor({ color: bg }).catch(() => {});
  }
}

async function applyTextSize(size) {
  if (Capacitor.isNativePlatform()) {
    // Native: scale text the way the phone's own text-size setting does.
    try {
      const value = size === "system" ? (await TextZoom.getPreferred()).value : Number(size);
      await TextZoom.set({ value });
    } catch { /* plugin unavailable */ }
  } else {
    // Website: browsers have their own zoom, so only apply an explicit choice.
    document.documentElement.style.zoom = size === "system" ? "" : String(Number(size));
  }
}

// Keep "Match phone" mode in sync if the phone switches light/dark while open.
export function watchSystemMode(getPrefs) {
  const mq = window.matchMedia?.("(prefers-color-scheme: light)");
  const onChange = () => { if (getPrefs().mode === "system") applyPrefs(getPrefs()); };
  mq?.addEventListener?.("change", onChange);
  return () => mq?.removeEventListener?.("change", onChange);
}
