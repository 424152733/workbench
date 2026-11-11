import test from 'node:test';
import assert from 'node:assert/strict';
import { isDiseaseDefinitionPage } from '../policy-contract-parser.js';

test('AI input omits dense disease definitions while retaining payout clauses', () => {
  const definitions='本合同所指的重大疾病\n6.5.1 恶性肿瘤 指\n6.5.2 急性心肌梗塞 指\n6.5.3 脑中风后遗症 指';
  const payouts='2.3.1 轻症疾病保险金，按基本保额20%给付。2.3.2 重大疾病保险金，按基本保额给付。2.3.3 身故保险金。';
  assert.equal(isDiseaseDefinitionPage(definitions),true);
  assert.equal(isDiseaseDefinitionPage(payouts),false);
});
