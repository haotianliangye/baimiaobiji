// Citation washing pipeline for RAG/AI output containing raw #log_id_UUID refs.
//
// LLMs emitting diary/review/chat text often sprinkle bare `#log_id_<UUID>`
// markers (or bracketed/code-wrapped variants) to cite source fragments.
// Rendered verbatim these look like garbage and can break Markdown when
// nested inside `[text](...)` link syntax. This module rewrites every citation
// into a clean standard-form link `[引用](#log_id_<UUID>)` while preserving
// any well-formed links the model already produced.
//
// Three-phase pipeline (per PRD §4.3.3):
//   1. Extract well-formed `[text](#log_id_UUID)` links → placeholder tokens.
//   2. Rewrite remaining bare `#log_id_UUID` (incl. `[UUID]`, `code`-wrapped,
//      space-padded variants) into standard `[引用](#log_id_UUID)` links.
//   3. Restore the placeholders from phase 1.

const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

// Matches a well-formed markdown link whose URL is a #log_id_UUID anchor.
const WELL_FORMED_LINK_RE = new RegExp(
  `\\[([^\\]]*)\\]\\(#log_id_${UUID_RE}\\)`,
  'g'
);

// Matches a bare #log_id_<UUID>, optionally wrapped in backticks or square
// brackets, with optional surrounding whitespace inside the brackets.
const BARE_REF_RE = new RegExp(
  '`?#log_id_(' + UUID_RE + ')`?',
  'g'
);

export function washCitations(markdown: string): string {
  if (!markdown) return markdown;

  // Phase 1: preserve well-formed links as placeholders so phase 2 leaves them alone.
  const placeholders: string[] = [];
  let working = markdown.replace(WELL_FORMED_LINK_RE, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `__PRESERVED_LINK_${idx}__`;
  });

  // Phase 2: rewrite every remaining bare #log_id_UUID into a standard link.
  // Skip any that are already the URL part of *some* link (handled by phase 1).
  working = working.replace(BARE_REF_RE, (_match, uuid: string) => {
    return `[引用](#log_id_${uuid})`;
  });

  // Phase 3: restore preserved links.
  placeholders.forEach((orig, idx) => {
    working = working.replace(`__PRESERVED_LINK_${idx}__`, orig);
  });

  return working;
}
