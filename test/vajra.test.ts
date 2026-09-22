import test from 'node:test';
import assert from 'node:assert/strict';
import { exportResearch } from '../client/src/research.ts';
import { validatePlan } from '../server/agent-plan.js';

test('Vajra plans reject invalid progress and bound model input', () => {
  assert.deepEqual(validatePlan([{ text: ' Read sources ', status: 'in_progress' }]), [{ text: 'Read sources', status: 'in_progress' }]);
  for (const steps of [[], null, [{ text: '', status: 'pending' }], [{ text: 'X', status: 'done' }], Array(13).fill({ text: 'X', status: 'pending' }), Array(2).fill({ text: 'X', status: 'in_progress' })]) assert.throws(() => validatePlan(steps));
});
test('Vajra Markdown export includes plan, conversation, interruption and tool status without approval payloads', () => {
  const result = exportResearch({ id: 'test', title: 'Research', status: 'stopped', model: null, workspace: '', updatedAt: 'today', plan: [{ text: 'Read', status: 'complete' }, { text: 'Write', status: 'in_progress' }], messages: [{ role: 'user', content: 'Question' }, { role: 'assistant', content: 'Partial answer', interrupted: true }], activity: [{ id: 'a', name: 'write_file', status: 'interrupted', arguments: 'private arguments', createdAt: 'today' }] });
  assert.match(result, /\[x\] Read/); assert.match(result, /Write \(in progress\)/); assert.match(result, /Vajra \(interrupted\)/); assert.match(result, /write_file: interrupted/); assert.ok(!result.includes('private arguments'));
});
