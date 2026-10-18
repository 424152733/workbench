import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_API_HOST, localCorsOrigin } from '../http-security.js';

function checkOrigin(origin) {
  let result;
  let error;
  localCorsOrigin(origin, (callbackError, allowed) => {
    error = callbackError;
    result = allowed;
  });
  return { error, result };
}

test('API binds to the local machine by default', () => {
  assert.equal(LOCAL_API_HOST, '127.0.0.1');
});

test('CORS accepts local Vite and preview origins, plus origin-less requests', () => {
  for (const origin of [undefined, 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173']) {
    assert.deepEqual(checkOrigin(origin), { error:null, result:true });
  }
});

test('CORS rejects unrelated web origins', () => {
  const result = checkOrigin('https://example.com');
  assert.equal(result.result, false);
  assert.match(result.error.message, /仅允许本机工作台/);
});
