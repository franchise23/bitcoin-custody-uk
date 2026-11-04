const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeTransactions, isCompletedTransaction } = require('../quantum-utils.js');

test('filters only completed public transactions sorted newest first', () => {
  const records = [
    { id: 'old', status: 'pending', isPublic: true },
    { id: 'complete', status: 'complete', isPublic: true, completedAt: '2026-11-04T12:00:00Z' },
    { id: 'completed', status: 'Completed', isPublic: true, completedAt: '2026-11-05T12:00:00Z' },
    { id: 'private', status: 'completed', isPublic: false, completedAt: '2026-11-06T12:00:00Z' },
    { id: 'success', status: 'success', isPublic: true, completedAt: '2026-11-07T12:00:00Z' },
  ];

  const normalized = normalizeTransactions(records);

  assert.deepEqual(normalized.map((tx) => tx.id), ['success', 'completed', 'complete']);
  assert.equal(isCompletedTransaction({ status: 'success', isPublic: true }), true);
});
