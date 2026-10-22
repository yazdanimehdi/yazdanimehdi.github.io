// The workflow bundler (esbuild) has no `?raw` import, so the apply runner ships as a string module.
import { readFileSync, writeFileSync } from 'node:fs';

const dir = 'src/lib/career/apply';
const source = readFileSync(`${dir}/runner.mjs`, 'utf8');
writeFileSync(
  `${dir}/runner-source.ts`,
  `// Generated from runner.mjs by \`pnpm gen:runner\`; runner.test.ts fails when it is stale.\nexport const RUNNER_SOURCE = ${JSON.stringify(source)};\n`,
);
