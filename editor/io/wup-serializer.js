// WUP serializer.
// Reuses the parsed statement list, keeping original ordering and formatting where possible.

function normalizeStatement(statement) {
  if (typeof statement !== "string") {
    return null;
  }
  const trimmed = statement.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.endsWith(";") ? trimmed : `${trimmed};`;
}

export function serializeWup(model) {
  if (!model || typeof model !== "object") {
    return { text: "", fallback: "" };
  }
  const statements = Array.isArray(model.__statements) ? model.__statements : [];
  const normalized = [];
  for (const statement of statements) {
    const formatted = normalizeStatement(statement);
    if (formatted) {
      normalized.push(formatted);
    }
  }
  if (normalized.length === 0) {
    const source = typeof model.__sourceText === "string" ? model.__sourceText : "";
    return { text: null, fallback: source };
  }
  return { text: `${normalized.join("\n")}\n`, fallback: model.__sourceText ?? null };
}
