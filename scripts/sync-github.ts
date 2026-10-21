#!/usr/bin/env tsx
/**
 * Snapshot the GitHub profile for the Repositories page: reads github.username from config/site.yml, writes
 * src/data/github.json. The logic lives in src/lib/github.ts (shared with the daily job).
 */

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fetchGitHub, snapshotJson } from '../src/lib/github';
import type { SiteConfig } from '../src/lib/types';

const ROOT = path.resolve(import.meta.dirname, '..');
const site = yaml.load(fs.readFileSync(path.join(ROOT, 'config', 'site.yml'), 'utf-8')) as SiteConfig;
const username = site.github?.username;
if (!username) {
  console.log('No github.username in config/site.yml: nothing to sync.');
  process.exit(0);
}

try {
  const snapshot = await fetchGitHub(username);
  fs.writeFileSync(path.join(ROOT, 'src', 'data', 'github.json'), snapshotJson(snapshot));
  console.log(`GitHub @${username}: ${snapshot.repos.length} repositories, ${snapshot.followers} followers`);
} catch (err) {
  // Nothing fetched: keep the existing snapshot.
  console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
