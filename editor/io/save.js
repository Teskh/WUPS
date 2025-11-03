// Saving logic (scaffold).
// Writes a new WUP text with a "-modified" suffix, never overwriting the original.

import { serializeWup } from "./wup-serializer.js";

/**
 * Suggest a filename with `-modified` suffix.
 * @param {string} originalName
 */
export function suggestModifiedFilename(originalName) {
  if (!originalName || typeof originalName !== "string") return "modified.wup";
  const dot = originalName.lastIndexOf(".");
  if (dot <= 0) return `${originalName}-modified.wup`;
  const base = originalName.slice(0, dot);
  const ext = originalName.slice(dot);
  return `${base}-modified${ext}`;
}

/**
 * Serialize and trigger download (browser) or return text (non-browser).
 * @param {object} model - normalized model from parser/normalize pipeline
 * @param {string} originalName
 */
export function saveAsModified(model, originalName = "model.wup") {
  const { text, fallback } = serializeWup(model);
  const payload = text ?? fallback ?? "";
  const filename = suggestModifiedFilename(originalName);
  if (typeof document === "undefined") {
    return { filename, text: payload };
  }
  const blob = new Blob([payload], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return { filename };
}
