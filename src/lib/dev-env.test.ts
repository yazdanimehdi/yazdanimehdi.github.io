import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmsProduction, databaseFor, devEnv, hostOf } from './dev-env';

const DEV = 'postgres://u:p@ep-dev-123.eu-central-1.aws.neon.tech/neondb?sslmode=require';
const PROD = 'postgres://u:p@ep-main-999.eu-central-1.aws.neon.tech/neondb?sslmode=require';

test('devEnv: DATABASE_URL is always DEV_DATABASE_URL, never the pulled or shell one', () => {
  const env = devEnv(
    { DATABASE_URL: PROD, DEV_DATABASE_URL: DEV, SESSION_SECRET: 's'.repeat(40), BLOB_READ_WRITE_TOKEN: 'blob' },
    { DATABASE_URL: PROD, PATH: '/bin' },
  );
  assert.equal(env.DATABASE_URL, DEV);
  assert.equal(env.VERCEL, '1');
  assert.equal(env.BLOB_READ_WRITE_TOKEN, 'blob');
  assert.equal(env.SESSION_SECRET, 's'.repeat(40));
  assert.equal(env.PATH, '/bin');
});

test('devEnv: missing DEV_DATABASE_URL is an error that says what to do; missing SESSION_SECRET is generated', () => {
  assert.throws(() => devEnv({ DATABASE_URL: PROD }, {}), /DEV_DATABASE_URL/);
  const env = devEnv({ DEV_DATABASE_URL: DEV }, {}, () => 'g'.repeat(43));
  assert.equal(env.SESSION_SECRET, 'g'.repeat(43));
});

test('databaseFor / hostOf / confirmsProduction', () => {
  assert.equal(databaseFor({ DEV_DATABASE_URL: DEV, DATABASE_URL: PROD }, false), DEV);
  assert.equal(databaseFor({ DEV_DATABASE_URL: DEV, DATABASE_URL: PROD }, true), PROD);
  assert.throws(() => databaseFor({ DATABASE_URL: PROD }, false), /DEV_DATABASE_URL/);
  assert.throws(() => databaseFor({ DEV_DATABASE_URL: DEV }, true), /DATABASE_URL/);
  assert.equal(hostOf(DEV), 'ep-dev-123.eu-central-1.aws.neon.tech');
  assert.equal(confirmsProduction(' Jane ', 'jane'), true);
  assert.equal(confirmsProduction('jan', 'jane'), false);
});
