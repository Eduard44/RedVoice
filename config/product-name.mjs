import { PRODUCT_NAME } from "./app-config.mjs";

/** The name the upstream catalogs use for the app. */
const UPSTREAM_NAME = "VoiceStudio";

/**
 * Catalog sections about the upstream project's own services (its accounts,
 * paid plans, donations and phone apps). They keep the upstream name.
 */
const UPSTREAM_SECTIONS = new Set([
  "account",
  "cloudsync",
  "proPage",
  "donate",
  "enterprise",
  "contact",
  "mobile",
]);

/** The upstream name where it means this app, not an upstream service or site. */
const APP_NAME = /VoiceStudio(?!\.sh\b| Pro\b| Cloud\b| team\b| sponsor| Project\b)/g;

/**
 * Shows this build's product name in interface text. The catalogs stay as
 * upstream ships them, in every language, so upstream changes still merge
 * cleanly; the name is swapped when a text is displayed.
 */
export function withProductName(text, key) {
  if (PRODUCT_NAME === UPSTREAM_NAME || typeof text !== "string" || !text.includes(UPSTREAM_NAME))
    return text;
  const first = Array.isArray(key) ? key[0] : key;
  const section = typeof first === "string" ? first.split(".")[0] : "";
  if (UPSTREAM_SECTIONS.has(section)) return text;
  return text.replace(APP_NAME, PRODUCT_NAME);
}
