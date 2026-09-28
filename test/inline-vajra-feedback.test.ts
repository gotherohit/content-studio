import test from 'node:test';
import assert from 'node:assert/strict';
import { inlineVajraFeedback } from '../client/src/inline-vajra-feedback.ts';
import type { ResearchSession } from '../client/src/research.ts';

const state = (status: string, lastError?: string, interrupted = false): Pick<ResearchSession, 'status' | 'lastError' | 'messages'> => ({
  status, lastError, messages: [{ role: 'assistant', content: 'An unfinished explanation', interrupted }],
});

test('reopened inline explanations disclose output limits and provider credit errors', () => {
  assert.deepEqual(inlineVajraFeedback(state('error', 'The model reached its output limit. Continue with a smaller step.', true)), {
    kind: 'error', message: 'The model reached its output limit. Continue with a smaller step.',
  });
  assert.deepEqual(inlineVajraFeedback(state('error', 'Provider returned 402: insufficient credits')), {
    kind: 'error', message: 'Provider returned 402: insufficient credits',
  });
  assert.match(inlineVajraFeedback(state('stopped', undefined, true))?.message || '', /stopped before finishing/);
});

test('completed answers stay free of failure notices and step limits remain visible', () => {
  assert.equal(inlineVajraFeedback(state('complete')), null);
  assert.equal(inlineVajraFeedback(state('running')), null);
  assert.deepEqual(inlineVajraFeedback(state('limited')), {
    kind: 'notice', message: 'Vajra reached its step limit. Ask a follow-up to continue.',
  });
});
