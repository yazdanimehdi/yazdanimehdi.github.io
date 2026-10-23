import { getSiteConfig, getSiteName, isPageOn } from '../../lib/config';
import { graphDocument, loadPublic } from '../../lib/public-notes';

export async function GET() {
  const config = getSiteConfig();
  if (!isPageOn('/notes', config)) return new Response(null, { status: 404 });
  const site = { name: getSiteName(), url: config.siteUrl.replace(/\/+$/, ''), owner: config.author };
  return new Response(JSON.stringify(graphDocument(await loadPublic(), site)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}
