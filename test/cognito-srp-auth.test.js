const test = require('node:test');
const assert = require('node:assert/strict');
const {
  accessTokenFromSession,
  validateConfig,
} = require('../scripts/cognito-srp-auth');

test('SRP probe requires the deployed Cognito pool and app-client shapes', () => {
  assert.deepEqual(validateConfig({
    userPoolId: 'us-east-1_Example123',
    appClientId: '4exampleclient123',
    username: 'planner@example.invalid',
    password: 'not-a-real-production-password',
  }), {
    userPoolId: 'us-east-1_Example123',
    appClientId: '4exampleclient123',
    username: 'planner@example.invalid',
    password: 'not-a-real-production-password',
  });
  assert.throws(() => validateConfig({
    userPoolId: 'invalid',
    appClientId: '4exampleclient123',
    username: 'planner@example.invalid',
    password: 'password',
  }), /userPoolId is invalid/);
  assert.throws(() => validateConfig({
    userPoolId: 'us-east-1_Example123',
    appClientId: 'bad client',
    username: 'planner@example.invalid',
    password: 'password',
  }), /appClientId is invalid/);
});

test('SRP probe accepts only a bounded access token from a Cognito session', () => {
  const session = {
    getAccessToken() {
      return { getJwtToken() { return 'header.payload.signature'; } };
    },
  };
  assert.equal(accessTokenFromSession(session), 'header.payload.signature');
  assert.throws(() => accessTokenFromSession({}), /invalid access token/);
  assert.throws(() => accessTokenFromSession({
    getAccessToken() { return { getJwtToken() { return 'token with whitespace'; } }; },
  }), /invalid access token/);
});
