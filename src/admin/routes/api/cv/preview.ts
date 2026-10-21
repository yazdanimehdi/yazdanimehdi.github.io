import { HttpError, readBody, route } from '../../../../lib/admin/http';
import { assertPublisher } from '../../../../lib/admin/editor';
import { cvRenderRequest, renderCv } from '../../../../lib/cv-render';
import { assertThemeFiles, type CvStyle } from '../../../../lib/cv-styles';

export const prerender = false;

/** Live preview: renders the posted style (and unsaved theme files, publishers only) without saving anything. */
export const POST = route(async (ctx, store, user) => {
  const { style, themeFiles } = await readBody<{ style?: CvStyle; themeFiles?: Record<string, string> }>(ctx);
  if (!style || typeof style !== 'object' || typeof style.theme !== 'string') {
    throw new HttpError(400, 'style is required');
  }
  const req = await cvRenderRequest(store, style);
  if (themeFiles) {
    assertPublisher(user);
    assertThemeFiles(style.theme, themeFiles);
    req.themeFiles = themeFiles;
  }
  const bytes = await renderCv(req);
  return new Response(Buffer.from(bytes), { headers: { 'content-type': 'application/pdf' } });
});
