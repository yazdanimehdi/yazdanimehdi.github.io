import { readConfig } from '../../../../lib/admin/content';
import { json, route } from '../../../../lib/admin/http';
import { THEMES_DIR, THEME_NAME, configPath } from '../../../../lib/admin/paths';
import { BUILT_IN_THEMES, parseStyles } from '../../../../lib/cv-styles';
import type { CvConfig } from '../../../../lib/types';

export const prerender = false;

/**
 * The CV styles screen's document: config/cv-styles.yml repaired by parseStyles (the defaults while it is missing),
 * its version for the save through PUT /config/cv-styles, and the themes a style can use.
 */
export const GET = route(async (_ctx, store) => {
  const [cv, file, themeFiles] = await Promise.all([
    readConfig(store, 'cv'),
    store.read(configPath('cv-styles')),
    store.list(THEMES_DIR),
  ]);
  // Only folders (a path below the name) with a valid theme name; anything else under cv/themes is not a theme.
  const names = themeFiles.flatMap(({ path }) => {
    const [name, ...rest] = path.slice(THEMES_DIR.length + 1).split('/');
    return rest.length && THEME_NAME.test(name) ? [name] : [];
  });
  const themes = [...new Set(names)];
  return json({
    data: parseStyles(file?.content, cv.data as unknown as CvConfig),
    version: file?.version ?? null,
    builtIn: BUILT_IN_THEMES,
    themes,
  });
});
