import * as core from '@actions/core';
import type { Placed } from '../utils/render.util';
import { callApi } from './api.service';

/** The most drafts one review asks for. */
const MAX_DRAFTS = 3;

export const WITHHELD_TITLE = 'Security issue, reported privately';

/** What a public PR thread says in place of a finding whose details went into a private draft. */
export const withheldBody = (url: string) =>
  `Axon Shaft found a blocking security issue on these lines. The details are in a [private draft security advisory](${url}) that the repo's admins and security managers can open.`;

/** What `POST /v1/advisories` returns: the draft, and whether the repo is public, so the thread mustn't show the details. */
type Draft = { ghsa_id: string; html_url: string; withhold: boolean };

const cut = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * Ask the Axon Shaft API for a private draft security advisory for each blocking `security` finding,
 * the first 3. Each one that comes back links to its draft; on a public repo its title and body
 * become the short note and its suggestion goes, so the inline comment, summary, state marker, check
 * run and run report all carry the note. The fingerprint stays, so a re-review matches it. A failed
 * request keeps the finding as it is and warns. Returns the summary's line about the failures, if any.
 * The finding's text is never logged: the job log is public on a public repo.
 */
export async function openAdvisories(placed: Placed[], o: { pull: number; dryRun: boolean; clean: (s: string) => string }): Promise<string | undefined> {
  const failed: string[] = [];
  for (const p of placed.filter((f) => f.step === 'security' && f.severity === 'blocking').slice(0, MAX_DRAFTS)) {
    if (o.dryRun) {
      core.info(`Would open a draft advisory for ${p.fp}`);
      continue;
    }
    try {
      const body = { fp: p.fp, title: cut(o.clean(p.title), 300), body: cut(o.clean(p.body), 5000), file: cut(p.file, 500), line: Math.max(1, p.line), pull: o.pull };
      const draft = (await callApi('/v1/advisories', body)) as Draft | undefined;
      if (typeof draft?.html_url !== 'string') throw new Error('The Axon Shaft API sent an incomplete answer');
      p.url = draft.html_url;
      if (draft.withhold) {
        p.title = WITHHELD_TITLE;
        p.body = withheldBody(draft.html_url);
        delete p.suggestion;
      }
    } catch (e) {
      const why = (e instanceof Error ? e.message : String(e)).replace(/\.$/, '');
      core.warning(`Couldn't open a draft advisory for ${p.fp}, so the finding is posted as it is: ${why}`);
      failed.push(`\`${p.fp}\` (${why})`);
    }
  }
  return failed.length ? `Couldn't open a private draft advisory for ${failed.join(', ')}, so ${failed.length === 1 ? 'that finding shows' : 'those findings show'} in full.` : undefined;
}
