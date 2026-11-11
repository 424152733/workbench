import assert from 'node:assert/strict';
import test from 'node:test';
import { redactContractText } from '../policy-contract-parser.js';

test('合同脱敏保留影响赔付的条款语义', () => {
  const text='若被保险人因意外伤害或于合同生效后90日确诊，给付重大疾病保险金。\n被保险人：张三 身份证号：110105199001012345';
  const redacted=redactContractText(text);
  assert.match(redacted,/被保险人因意外伤害/);
  assert.match(redacted,/被保险人：\[姓名已隐藏\]/);
  assert.doesNotMatch(redacted,/张三|110105199001012345/);
});
