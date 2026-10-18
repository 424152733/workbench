import assert from 'node:assert/strict';
import test from 'node:test';
import { isWorkbenchPage, isWorkbenchPath, pageForPath, parseWorkbenchLocation, pathForCustomer, pathForFamily, pathForPage } from './navigation.js';

test('workbench pages resolve from and serialize to stable browser paths',() => {
  assert.equal(pageForPath('/'),'home');
  assert.equal(pageForPath('/clients'),'clients');
  assert.equal(pageForPath('/content/'),'content');
  assert.equal(pageForPath('/products'),'products');
  assert.equal(pathForPage('clients'),'/clients');
  assert.equal(pathForPage('content'),'/content');
  assert.equal(pathForPage('products'),'/products');
  assert.equal(isWorkbenchPath('/content'),true);
  assert.equal(isWorkbenchPath('/unknown'),false);
  assert.equal(isWorkbenchPage('content'),true);
  assert.equal(isWorkbenchPage('products'),true);
  assert.equal(isWorkbenchPage('unknown'),false);
});

test('customer and family detail routes restore their view and return context',() => {
  assert.deepEqual(parseWorkbenchLocation({pathname:'/clients/42',search:''}),{
    page:'clients',customerId:'42',familyId:null,returnFamilyId:null,view:'detail',
  });
  assert.deepEqual(parseWorkbenchLocation({pathname:'/clients/42',search:'?fromFamily=7'}),{
    page:'clients',customerId:'42',familyId:null,returnFamilyId:'7',view:'detail',
  });
  assert.equal(parseWorkbenchLocation({pathname:'/clients/42',search:'?fromFamily=https://example.com'}).returnFamilyId,null);
  assert.deepEqual(parseWorkbenchLocation({pathname:'/families/7',search:''}),{
    page:'clients',customerId:null,familyId:'7',returnFamilyId:null,view:'families',
  });
  assert.equal(pathForCustomer(42,7),'/clients/42?fromFamily=7');
  assert.equal(pathForCustomer(42),'/clients/42');
  assert.equal(pathForFamily(7),'/families/7');
  assert.equal(isWorkbenchPath('/families/7'),true);
});

test('publication history view restores from the address bar',() => {
  assert.equal(parseWorkbenchLocation({pathname:'/content',search:'?view=publications'}).view,'publications');
  assert.equal(parseWorkbenchLocation({pathname:'/content',search:''}).view,'workspace');
});
