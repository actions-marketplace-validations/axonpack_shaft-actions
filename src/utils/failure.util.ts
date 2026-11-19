import { ERROR_CARDS_URL } from '../consts/api.const';

/**
 * A failure the action knows: `code` is one of the Axon Shaft API's error codes, or the action's
 * own (`missing_id_token`, `api_unreachable`, `review_timed_out`, `review_invalid_reply`,
 * `review_failed`, `push_failed`). `message` says what to do and `url` where to do it.
 */
export class ShaftFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    public url?: string,
  ) {
    super(message);
  }
}

/** The failure as Markdown for the job summary and the PR: its card (an SVG GitHub renders), the message and the link. */
export function failureMarkdown(f: ShaftFailure): string {
  const alt = f.message.replace(/[[\]\r\n]+/g, ' ');
  return [`![${alt}](${ERROR_CARDS_URL}/${encodeURIComponent(f.code)}.svg)`, f.message, f.url && `<${f.url}>`].filter(Boolean).join('\n\n');
}
