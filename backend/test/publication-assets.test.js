import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicationOperations } from '../publication-operations.js';

const requestKey = '27dbbe1a-6dbb-4685-b821-1bdb3e914111';
const publication = {
  id:2,draft_id:32,topic_id:'T-ECC87',platform:'公众号',status:'active',
  published_on_text:'2026-10-18',published_time_text:null,publish_url:'https://example.com',note:'',
};

function correctionHarness(available = [{id:8,file_name:'first.png'},{id:9,file_name:'second.png'}]) {
  const calls = [];
  const client = {query:async (sql,params = []) => {
    calls.push({sql,params});
    if (sql.includes('FOR UPDATE OF p')) return {rows:[publication]};
    if (sql.includes('FROM content_publication_events WHERE request_key')) return {rows:[]};
    if (sql.includes('SELECT asset_id FROM content_publication_assets')) return {rows:[{asset_id:9}]};
    if (sql.includes('SELECT id,file_name FROM assets')) return {rows:available};
    if (sql.includes('FROM content_publications WHERE draft_id')) return {rows:[{published_on_text:'2026-10-18',published_time_text:null,publish_url:'https://example.com'}]};
    return {rows:[]};
  }};
  const operation = new PublicationOperations();
  operation.db = {transaction:async (callback) => callback(client)};
  operation.publication = async () => ({id:2});
  return {operation,calls};
}

test('correcting a publication can restore a missing selected image and audits the change',async () => {
  const {operation,calls} = correctionHarness();
  await operation.correctPublication(2,{requestKey,reason:'补齐登记时使用的配图',assetIds:[8,9]});
  assert.equal(calls.filter(({sql}) => sql.includes('DELETE FROM content_publication_assets')).length,1);
  const inserts = calls.filter(({sql}) => sql.includes('INSERT INTO content_publication_assets'));
  assert.deepEqual(inserts.map(({params}) => params.slice(1,3)),[[8,0],[9,1]]);
  const event = calls.find(({sql}) => sql.includes("VALUES($1,'corrected'"));
  assert.deepEqual(JSON.parse(event.params[1]).assetIds,[9]);
  assert.deepEqual(JSON.parse(event.params[2]).assetIds,[8,9]);
});

test('correcting a publication rejects images from another draft before changing associations',async () => {
  const {operation,calls} = correctionHarness([{id:9,file_name:'second.png'}]);
  await assert.rejects(operation.correctPublication(2,{requestKey,reason:'更正配图',assetIds:[8,9]}),/所选配图不属于当前稿件/);
  assert.equal(calls.some(({sql}) => sql.includes('DELETE FROM content_publication_assets')),false);
});
