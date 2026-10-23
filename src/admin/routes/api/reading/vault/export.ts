import { careerRoute } from '../../../../../lib/career/route';
import { getSql } from '../../../../../lib/db';
import { exportVault } from '../../../../../lib/reading/vault-db';

export const prerender = false;

/** The vault as an Obsidian zip, one file per note; 413 with a sentence when too big for one response. */
export const GET = careerRoute(async () => {
  const bytes = await exportVault(getSql());
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="vault-${new Date().toISOString().slice(0, 10)}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
});
