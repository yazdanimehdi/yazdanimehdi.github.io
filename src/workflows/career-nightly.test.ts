import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorText } from './career-nightly';

test('errorText keeps the provider message and drops the step wrapper', () => {
  assert.equal(
    errorText(
      new Error(
        'Step "step//./src/lib/career/steps//scorePosting" failed: Error: Anthropic answered 400: Your credit balance is too low',
      ),
    ),
    'Anthropic answered 400: Your credit balance is too low',
  );
  assert.equal(errorText('boom'), 'boom');
  assert.equal(errorText(new Error('x'.repeat(400))).length, 300);
});
