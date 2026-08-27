#!/usr/bin/env node

const {
  AuthenticationDetails,
  CognitoUser,
  CognitoUserPool,
} = require('amazon-cognito-identity-js');
const { totp } = require('./totp-code');

const USER_POOL_ID = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-\d_[A-Za-z0-9]+$/;
const APP_CLIENT_ID = /^[A-Za-z0-9]{1,128}$/;

function required(value, label, max = 512) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.length > max) throw new Error(`${label} is invalid.`);
  return normalized;
}

function validateConfig(input = {}) {
  const userPoolId = required(input.userPoolId, 'userPoolId', 160);
  const appClientId = required(input.appClientId, 'appClientId', 128);
  const username = required(input.username, 'username', 320);
  const password = required(input.password, 'password', 1024);
  if (!USER_POOL_ID.test(userPoolId)) throw new Error('userPoolId is invalid.');
  if (!APP_CLIENT_ID.test(appClientId)) throw new Error('appClientId is invalid.');
  return { userPoolId, appClientId, username, password };
}

function accessTokenFromSession(session) {
  const token = session?.getAccessToken?.()?.getJwtToken?.();
  if (typeof token !== 'string' || !token || token.length > 8192 || /\s/.test(token)) {
    throw new Error('Cognito SRP authentication returned an invalid access token.');
  }
  return token;
}

function authenticateWithSrp(input = {}) {
  const { userPoolId, appClientId, username, password } = validateConfig(input);
  const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: appClientId });
  const user = new CognitoUser({ Username: username, Pool: pool });
  user.setAuthenticationFlowType('USER_SRP_AUTH');
  const details = new AuthenticationDetails({ Username: username, Password: password });

  return new Promise((resolve, reject) => {
    let softwareTokenSecret = null;
    let settled = false;

    function fail() {
      if (settled) return;
      settled = true;
      reject(new Error('Cognito SRP production probe authentication failed.'));
    }

    function succeed(session) {
      if (settled) return;
      try {
        const token = accessTokenFromSession(session);
        settled = true;
        resolve(token);
      } catch {
        fail();
      }
    }

    const callbacks = {
      onSuccess: succeed,
      onFailure: fail,
      newPasswordRequired: fail,
      customChallenge: fail,
      mfaRequired: fail,
      selectMFAType: fail,
      mfaSetup() {
        try {
          user.associateSoftwareToken(callbacks);
        } catch {
          fail();
        }
      },
      associateSecretCode(secretCode) {
        try {
          softwareTokenSecret = required(secretCode, 'softwareTokenSecret', 256);
          user.verifySoftwareToken(
            totp(softwareTokenSecret),
            'cbcap-production-preflight',
            callbacks,
          );
        } catch {
          fail();
        }
      },
      totpRequired() {
        if (!softwareTokenSecret) return fail();
        try {
          user.sendMFACode(totp(softwareTokenSecret), callbacks, 'SOFTWARE_TOKEN_MFA');
        } catch {
          fail();
        }
      },
    };

    try {
      user.authenticateUser(details, callbacks);
    } catch {
      fail();
    }
  });
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length !== 4) {
    throw new Error('Usage: cognito-srp-auth.js USER_POOL_ID APP_CLIENT_ID USERNAME PASSWORD');
  }
  const token = await authenticateWithSrp({
    userPoolId: argv[0],
    appClientId: argv[1],
    username: argv[2],
    password: argv[3],
  });
  process.stdout.write(token);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.message || 'Cognito SRP production probe authentication failed.');
    process.exitCode = 1;
  });
}

module.exports = {
  accessTokenFromSession,
  authenticateWithSrp,
  validateConfig,
};
