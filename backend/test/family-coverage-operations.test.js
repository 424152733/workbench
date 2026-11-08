import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { FamilyCoverageOperations } from '../family-coverage-operations.js';

test('a relationship cannot connect a member outside the requested family',async () => {
  const operations = new FamilyCoverageOperations();
  const statements = [];
  operations.db = {transaction:async (work)=>work({query:async (sql) => {
    statements.push(sql);
    if (sql.startsWith('SELECT id FROM families')) return {rows:[{id:3}]};
    if (sql.startsWith('SELECT id FROM family_members')) return {rows:[{id:11}],rowCount:1};
    return {rows:[],rowCount:0};
  }})};

  await assert.rejects(operations.createRelationship(3,{memberAId:11,memberBId:12,kind:'sibling'}),BadRequestException);
  assert.equal(statements.some((sql)=>sql.startsWith('INSERT INTO family_relationships')),false);
});

test('linking a guest to a customer clears the guest label and preserves its note',async () => {
  const operations = new FamilyCoverageOperations();
  let updateValues;
  operations.family = async (id) => ({id});
  operations.db = {transaction:async (work)=>work({query:async (sql,values) => {
    if (sql.startsWith('SELECT * FROM family_members')) return {rows:[{id:8,family_id:3,customer_id:null,guest_name:'孩子',note:'家庭成员'}]};
    if (sql.startsWith('SELECT id FROM customers')) return {rows:[{id:20}]};
    if (sql.startsWith('UPDATE family_members')) updateValues=values;
    return {rows:[],rowCount:1};
  }})};

  await operations.updateFamilyMember(3,8,{customerId:20});
  assert.deepEqual(updateValues,[3,8,20,null,'家庭成员']);
});

test('customer lookup does not turn a name-only search into an unfiltered phone match',async () => {
  const operations = new FamilyCoverageOperations();
  let captured;
  operations.db={query:async(sql,params)=>{captured={sql,params};return {rows:[]};}};

  await operations.lookupCustomers({search:'林女士'});
  assert.match(captured.sql,/WHERE c\.name ILIKE \$1\s+ORDER BY/);
  assert.deepEqual(captured.params,['%林女士%']);

  await operations.lookupCustomers({search:'138 0000'});
  assert.match(captured.sql,/c\.phone_normalized LIKE \$2/);
  assert.deepEqual(captured.params,['%138 0000%','%1380000%']);
});

test('customer lookup with an empty query provides at most twenty recent customer suggestions',async () => {
  const operations = new FamilyCoverageOperations();
  let captured;
  operations.db={query:async(sql,params)=>{captured={sql,params};return {rows:[{id:9,name:'周先生',stage:'跟进中',source:'线下拜访'}]};}};

  assert.deepEqual(await operations.lookupCustomers(),[{id:9,name:'周先生',stage:'跟进中',source:'线下拜访'}]);
  assert.match(captured.sql,/ORDER BY c\.updated_at DESC,c\.id DESC LIMIT 20/);
  assert.doesNotMatch(captured.sql,/\bWHERE\b/);
  assert.deepEqual(captured.params,[]);
});

test('family member details resolve customer source codes through the source dictionary',async () => {
  const operations = new FamilyCoverageOperations();
  let memberQuery='';
  operations.db={query:async(sql)=>{
    if (sql.includes('FROM families f JOIN customers c')) return {rows:[{id:3,name:'示例客户的家庭',primary_customer_id:9,primary_customer_name:'示例客户'}]};
    if (sql.includes('FROM family_members fm LEFT JOIN customers c')) {
      memberQuery=sql;
      return {rows:[{id:11,family_id:3,customer_id:9,guest_name:null,name:'示例客户',phone:null,stage:'已有客户',source:'朋友转介绍',contact_status:'已确认'}]};
    }
    return {rows:[]};
  }};

  const family=await operations.family(3);
  assert.match(memberQuery,/LEFT JOIN source_dictionary sd ON sd\.code=c\.source_code/);
  assert.match(memberQuery,/COALESCE\(sd\.label,'未记录'\) AS source/);
  assert.equal(family.members[0].source,'朋友转介绍');
});

test('policy coverage labels are replaced within one family only',async () => {
  const operations = new FamilyCoverageOperations();
  const statements=[];
  operations.family=async(id)=>({id});
  operations.db={transaction:async(work)=>work({query:async(sql,values)=>{
    statements.push({sql,values});
    if(sql.startsWith('SELECT id FROM families'))return {rows:[{id:3}],rowCount:1};
    if(sql.startsWith('SELECT id,customer_id FROM policies'))return {rows:[{id:50,customer_id:20}],rowCount:1};
    if(sql.startsWith('SELECT id FROM family_members WHERE family_id=$1 AND customer_id'))return {rows:[{id:8}],rowCount:1};
    if(sql.startsWith('SELECT id FROM family_members WHERE family_id=$1 AND id'))return {rows:[{id:8}],rowCount:1};
    if(sql.startsWith('DELETE FROM family_policy_coverage_tags'))return {rows:[],rowCount:1};
    return {rows:[],rowCount:1};
  }})};

  await operations.linkFamilyPolicy(3,50,{people:[{memberId:8,role:'insured'}],coverageTags:['medical']});
  assert.equal(statements.some(({sql,values})=>sql.startsWith('DELETE FROM family_policy_coverage_tags') && values[0]===3 && values[1]===50),true);
  assert.equal(statements.some(({sql,values})=>sql.startsWith('INSERT INTO family_policy_coverage_tags') && values[0]===3 && values[1]===50 && values[2]==='medical'),true);
  assert.equal(statements.some(({sql,values})=>sql.startsWith('DELETE FROM family_contract_people') && values[0]===3 && values[1]===50),true);
  assert.equal(statements.some(({sql,values})=>sql.startsWith('INSERT INTO family_contract_people') && values[0]===3 && values[1]===50),true);
});

test('legacy family policy unlink delegates to the same policy and PDF unlink operation',async()=>{
  const operations=new FamilyCoverageOperations();
  let input;
  operations.unlinkFamilyPolicySource=async(familyId,source)=>{input={familyId,source};};
  operations.family=async(id)=>({id});
  assert.deepEqual(await operations.unlinkFamilyPolicy(3,50),{id:3});
  assert.deepEqual(input,{familyId:3,source:{policyId:50}});
});
