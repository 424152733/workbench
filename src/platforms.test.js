import test from 'node:test';
import assert from 'node:assert/strict';
import { channelNames, platformsForTopic } from './platforms.js';

test('platform selection uses the topic channels in the product order', () => {
  assert.deepEqual(platformsForTopic({ platforms: ['公众号', '小红书'] }), ['小红书', '公众号']);
});

test('missing or invalid platform selection falls back to all supported channels', () => {
  assert.deepEqual(platformsForTopic({}), channelNames);
  assert.deepEqual(platformsForTopic({ platforms: ['unsupported'] }), channelNames);
});
