/** What each pinned linter was asked, and what it answers: `out` by tool name, or an error to throw. */
export const asked: { name: string; args: string[]; files: Record<string, string>; env?: Record<string, string> }[] = [];
export const answers: Record<string, { out: string; status?: number; err?: string } | Error> = {};

/**
 * tool.service.ts with a fake `runTool` and the rest real, for a test file's
 * `vi.mock('../../tool.service', async (real) => (await import('./fixtures/linters')).fakeLinters(await real()))`.
 */
export const fakeLinters = (real: object) => ({
  ...real,
  runTool: async (name: string, args: string[], files: Record<string, string>, env?: Record<string, string>) => {
    asked.push({ name, args, files, ...(env && { env }) });
    const a = answers[name];
    if (a instanceof Error) throw a;
    return { out: a?.out ?? '[]', err: a?.err ?? '', status: a?.status ?? 0 };
  },
});
