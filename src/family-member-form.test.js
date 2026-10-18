import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFamilyMemberIdentity } from './features/customers/family-member-form.js';

test('a selected customer takes precedence over a stale guest nickname',()=>{
  assert.deepEqual(normalizeFamilyMemberIdentity({customerId:12,guestName:'母亲'}),{
    customerId:12,
    guestName:undefined,
  });
});

test('a guest nickname is trimmed when no customer is selected',()=>{
  assert.deepEqual(normalizeFamilyMemberIdentity({guestName:'  母亲  '}),{
    customerId:undefined,
    guestName:'母亲',
  });
});
