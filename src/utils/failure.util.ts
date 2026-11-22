import { CODES_URL, ERROR_CARDS_URL } from '../consts/api.const';

/**
 * A failure the action knows: `code` is one of the Axon Shaft API's error codes, or the action's
 * own (`missing_id_token`, `api_unreachable`, `review_timed_out`, `review_invalid_reply`,
 * `review_failed`, `push_failed`, `self_hosted_unsupported`, `credentials_in_checkout`,
 * `sandbox_unavailable`). `message` says what to do and `url` where to do it.
 */
export class ShaftFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    public url?: string,
  ) {
    super(message);
  }
  /** What a model session used before it failed, so the run still counts it. */
  spent?: { models: string[]; costUsd: number; tokens: { input: number; output: number; cache_read: number; cache_write: number } };
}

/** The docs' entry for a failure, notice or skip code. */
export const codeUrl = (code: string) => `${CODES_URL}#${encodeURIComponent(code)}`;

/** A notice's text, with the link to its code's docs when it has one (an older API sends none). */
export const noticeText = (reason: string, code?: string) => (code ? `${reason} See ${codeUrl(code)}` : reason);

/** The failure as Markdown for the job summary and the PR: its card (an SVG GitHub renders, linked to the code's docs), the message and the link. */
export function failureMarkdown(f: ShaftFailure): string {
  const alt = f.message.replace(/[[\]\r\n]+/g, ' ');
  const card = `[![${alt}](${ERROR_CARDS_URL}/${encodeURIComponent(f.code)}.svg)](${codeUrl(f.code)})`;
  return [card, f.message, f.url && `<${f.url}>`].filter(Boolean).join('\n\n');
}
