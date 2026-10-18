import 'reflect-metadata';
import assert from 'node:assert/strict';
import test from 'node:test';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApiController } from '../api.controller.js';
import { WorkbenchService } from '../workbench.service.js';

test('GET /api/customers/lookup reaches the static lookup route before :id',async () => {
  let lookupSearch;
  const service = {
    lookupCustomers:async ({search}) => {
      lookupSearch=search;
      return [{id:7,name:'林女士',stage:'新线索',source:'线下拜访'}];
    },
    customer:async (id) => ({id}),
  };
  class RoutingTestModule {}
  Module({controllers:[ApiController],providers:[{provide:WorkbenchService,useValue:service}]})(RoutingTestModule);
  const app=await NestFactory.create(RoutingTestModule,{logger:false});
  try {
    await app.listen(0,'127.0.0.1');
    const baseUrl=await app.getUrl();
    const emptyResponse=await fetch(`${baseUrl}/api/customers/lookup`);
    assert.equal(emptyResponse.status,200);
    assert.deepEqual(await emptyResponse.json(),[{id:7,name:'林女士',stage:'新线索',source:'线下拜访'}]);
    assert.equal(lookupSearch,'');

    const response=await fetch(`${baseUrl}/api/customers/lookup?search=${encodeURIComponent('林女士')}`);
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),[{id:7,name:'林女士',stage:'新线索',source:'线下拜访'}]);
    assert.equal(lookupSearch,'林女士');
  } finally {
    await app.close();
  }
});
