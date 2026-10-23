import { getSiteConfig, getSiteName, isPageOn } from '../../lib/config';
import { loadPublic, vaultZipResponse } from '../../lib/public-notes';
import { suggestSlug } from '../../lib/utils';

export async function GET() {
  const config = getSiteConfig();
  if (!isPageOn('/notes', config)) return new Response(null, { status: 404 });
  const filename = `${suggestSlug(getSiteName()) || 'site'}-notes.zip`;
  return vaultZipResponse(await loadPublic(), config.siteUrl.replace(/\/+$/, ''), filename);
}
