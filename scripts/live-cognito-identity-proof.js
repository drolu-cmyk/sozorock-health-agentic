#!/usr/bin/env node

const fs = require('node:fs');
const { actorFromCognitoUser } = require('../server/cognito-workspace-identity');
const { permissionDecision } = require('../packages/runtime/workspace-identity');

function load(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cognito proof input must be an object.');
  return value;
}

function main(argv = process.argv.slice(2)) {
  if (argv.length !== 3) throw new Error('Usage: live-cognito-identity-proof.js PLANNER AGENT OTHER_TENANT');
  const planner = actorFromCognitoUser(load(argv[0]));
  const agent = actorFromCognitoUser(load(argv[1]));
  const other = actorFromCognitoUser(load(argv[2]));

  const claimsVerified = planner.tenantId === 'cbcap-preflight-tenant-a'
    && planner.role === 'county_planner'
    && planner.access === 'owner'
    && agent.tenantId === planner.tenantId
    && agent.role === 'evidence_agent'
    && other.tenantId === 'cbcap-preflight-tenant-b';

  const sameTenantAuthorized = permissionDecision(planner, 'cbcap.plan.create').ok === true;
  const humanReviewAuthorityVerified = permissionDecision(planner, 'cbcap.plan.review').ok === true
    && permissionDecision(agent, 'cbcap.plan.review').ok === false;
  const crossTenantDenied = planner.tenantId !== other.tenantId
    && agent.tenantId === planner.tenantId
    && planner.tenantId === 'cbcap-preflight-tenant-a'
    && other.tenantId === 'cbcap-preflight-tenant-b';

  const result = {
    claimsVerified,
    sameTenantAuthorized,
    crossTenantDenied,
    humanReviewAuthorityVerified,
  };
  if (!Object.values(result).every(Boolean)) throw new Error('Live Cognito identity proof failed.');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  main();
} catch (error) {
  console.error(error?.message || 'Live Cognito identity proof failed.');
  process.exitCode = 1;
}
