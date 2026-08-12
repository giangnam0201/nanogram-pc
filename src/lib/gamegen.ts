/* The model can ask a question and offer answers instead of free text. It does
 * that by embedding a block in its reply:
 *
 *   <<<choices>>>{"options":["Neon cyberpunk night run","Spooky graveyard"]}<<</choices>>>
 *
 * The Android client strips that block from what it displays and renders the
 * options as tappable chips, so the marker is never shown. This mirrors that
 * exactly, including keeping any prose that follows the block.
 */

const OPEN = '<<<choices>>>';
const CLOSE = '<<</choices>>>';

export interface AssistantMessage {
  /** Message text with the choices block removed. */
  text: string;
  /** Suggested replies, empty when the model asked nothing. */
  options: string[];
}

export function parseAssistant(content: string | null | undefined): AssistantMessage {
  const raw = content ?? '';
  const start = raw.indexOf(OPEN);
  if (start < 0) return { text: raw.trim(), options: [] };

  const end = raw.indexOf(CLOSE, start + OPEN.length);

  // Unterminated block: drop everything from the marker on.
  const text =
    end < 0
      ? raw.slice(0, start).trim()
      : (raw.slice(0, start) + raw.slice(end + CLOSE.length)).trim();

  if (end < 0) return { text, options: [] };

  const payload = raw.slice(start + OPEN.length, end).trim();
  return { text, options: payload ? readOptions(payload) : [] };
}

function readOptions(payload: string): string[] {
  try {
    const parsed = JSON.parse(payload) as { options?: unknown };
    if (!Array.isArray(parsed.options)) return [];
    return parsed.options
      .filter((o): o is string => typeof o === 'string')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
  } catch {
    // A half-streamed block is not worth surfacing as an error.
    return [];
  }
}
