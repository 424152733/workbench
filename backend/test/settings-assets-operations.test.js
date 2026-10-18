import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { SettingsAssetsOperations } from '../settings-assets-operations.js';

const uploadDirectory = path.resolve('backend/uploads');

async function assetHarness({published=false}={}) {
  const storageName = `test-delete-${randomUUID()}.png`;
  const filePath = path.join(uploadDirectory,storageName);
  await writeFile(filePath,'temporary test image');
  const calls = [];
  const client = {query:async (sql,params=[]) => {
    calls.push({sql,params});
    if (sql.includes('SELECT id,topic_id,platform,storage_name FROM assets')) {
      return {rows:[{id:12,topic_id:'T-TEST',platform:'公众号',storage_name:storageName}]};
    }
    if (sql.includes('FROM content_publication_assets')) return {rows:published ? [{'?column?':1}] : [],rowCount:published ? 1 : 0};
    return {rows:[],rowCount:1};
  }};
  const operation = Object.create(SettingsAssetsOperations.prototype);
  operation.db = {transaction:async (work) => work(client)};
  return {operation,calls,filePath};
}

test('deleting an unreferenced image removes its record, file, and resets draft review state',async () => {
  const {operation,calls,filePath} = await assetHarness();
  try {
    const result = await operation.deleteAsset(12);
    assert.deepEqual(result,{id:12,preservedForHistory:false});
    assert.ok(calls.some(({sql}) => sql.includes('DELETE FROM assets WHERE id=$1')));
    assert.ok(calls.some(({sql}) => sql.includes("UPDATE drafts SET status='草稿'")));
    await assert.rejects(readFile(filePath));
  } finally {
    await rm(filePath,{force:true});
  }
});

test('removing an image used by publication history detaches it from the draft but preserves the file',async () => {
  const {operation,calls,filePath} = await assetHarness({published:true});
  try {
    const result = await operation.deleteAsset(12);
    assert.deepEqual(result,{id:12,preservedForHistory:true});
    assert.ok(calls.some(({sql}) => sql.includes('UPDATE assets SET topic_id=NULL,platform=NULL')));
    assert.ok(!calls.some(({sql}) => sql.includes('DELETE FROM assets WHERE id=$1')));
    assert.ok((await readFile(filePath)).equals(Buffer.from('temporary test image')));
  } finally {
    await rm(filePath,{force:true});
  }
});

test('deleting an image rejects an invalid identifier before querying PostgreSQL',async () => {
  const operation = Object.create(SettingsAssetsOperations.prototype);
  let transactionStarted = false;
  operation.db = {transaction:async () => { transactionStarted = true; }};
  await assert.rejects(operation.deleteAsset('not-an-id'),/图片编号无效/);
  assert.equal(transactionStarted,false);
});
