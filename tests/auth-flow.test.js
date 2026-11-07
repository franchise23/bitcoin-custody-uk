const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'quantum-backend', 'server.js'), 'utf8');

test('backend auto-verifies accounts when no email delivery is configured', () => {
  assert.match(serverSource, /shouldAutoVerifyEmails|isEmailDeliveryConfigured/);
  assert.match(serverSource, /email_verified\s*=\s*1|email_verified\s*:\s*1/);
});
