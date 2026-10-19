import test from 'node:test';
import assert from 'node:assert/strict';
import { uiStrings } from './ui-strings';

test('uiStrings: English by default, with placeholders filled', () => {
  const t = uiStrings({});
  assert.equal(t('home.viewPublications'), 'View publications');
  assert.equal(t('home.allPublications', { count: 5 }), 'All 5 publications');
});

test('uiStrings: config ui overrides by id for any language; unknown ids and non-strings are ignored', () => {
  const t = uiStrings({ lang: 'fa-IR', ui: { 'home.news': 'اخبار', 'home.cv': 42, 'no.such': 'x' } });
  assert.equal(t('home.news'), 'اخبار');
  assert.equal(t('home.cv'), 'Curriculum vitae');
  assert.equal(t('home.allPublications', { count: '۵' }), 'All ۵ publications');
});

test('uiStrings: a placeholder with no var is kept, so a client can fill the raw template later', () => {
  const t = uiStrings({});
  assert.equal(t('mode.label'), 'Color theme: {mode}');
  assert.equal(t('mode.default'), '{mode} (site default)');
  assert.equal(
    t('mode.label').replace('{mode}', t('mode.default').replace('{mode}', 'Dark')),
    'Color theme: Dark (site default)',
  );
});
