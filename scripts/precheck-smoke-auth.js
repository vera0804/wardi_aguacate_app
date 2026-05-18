#!/usr/bin/env node
/* eslint-disable no-console */

function info(msg) {
  console.log(`[INFO] ${msg}`);
}
function ok(msg) {
  console.log(`[OK] ${msg}`);
}
function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  process.exitCode = 1;
}

async function fetchMe(baseUrl, cookieLabel, cookieValue, userAgent) {
  const res = await fetch(`${baseUrl}/auth/me`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Cookie: cookieValue,
      ...(userAgent ? { 'User-Agent': userAgent } : {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    data = null;
  }
  return { status: res.status, data, text };
}

async function main() {
  const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
  const cookieA = process.env.SMOKE_COOKIE_A;
  const cookieB = process.env.SMOKE_COOKIE_B;
  const userAgentA = process.env.SMOKE_USER_AGENT_A || process.env.SMOKE_USER_AGENT || '';
  const userAgentB = process.env.SMOKE_USER_AGENT_B || process.env.SMOKE_USER_AGENT || '';

  if (!cookieA || !cookieB) {
    console.error('Set SMOKE_COOKIE_A and SMOKE_COOKIE_B before running this precheck.');
    process.exit(1);
  }
  if (typeof fetch !== 'function') {
    console.error('Node 18+ is required (global fetch missing).');
    process.exit(1);
  }

  info(`Checking auth cookies against ${baseUrl}/auth/me ...`);

  const a = await fetchMe(baseUrl, 'A', cookieA, userAgentA);
  if (a.status === 200) {
    ok(`Cookie A valid (${a.data?.email || 'user loaded'})`);
  } else {
    fail(`Cookie A invalid. status=${a.status} body=${a.text || '(empty)'}`);
  }

  const b = await fetchMe(baseUrl, 'B', cookieB, userAgentB);
  if (b.status === 200) {
    ok(`Cookie B valid (${b.data?.email || 'user loaded'})`);
  } else {
    fail(`Cookie B invalid. status=${b.status} body=${b.text || '(empty)'}`);
  }

  if (a.status === 200 && b.status === 200) {
    console.log('\nBoth cookies are valid. You can run: npm run smoke:multitenant');
  } else {
    console.log('\nAt least one cookie is invalid for this API_BASE_URL.');
    process.exit(process.exitCode || 1);
  }
}

main().catch((err) => {
  console.error('Unexpected error in precheck:', err);
  process.exit(1);
});

