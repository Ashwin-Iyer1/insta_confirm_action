const test = require('node:test');
const assert = require('node:assert/strict');
const { classify, endpoint, fields, MAX_BODY } = require('../core');
const url = 'https://www.instagram.com/api/graphql';
test('strict endpoint, origin, method and credential boundaries', () => {
  for (const bad of ['https://evil.test/api/graphql', 'https://www.instagram.com.evil.test/api/graphql', 'http://www.instagram.com/api/graphql', 'https://www.instagram.com:444/api/graphql', 'https://secret@www.instagram.com/api/graphql', 'https://www.instagram.com/api/graphql/anything']) assert.equal(endpoint(bad, 'POST'), null);
  assert.equal(endpoint(url, 'GET'), null);
  assert.equal(endpoint('/api/graphql', 'POST').kind, 'graphql');
});
test('known likes expose no post identifier', () => {
  assert.deepEqual(classify('https://www.instagram.com/api/v1/web/likes/123/like/', 'POST'), { kind:'like', path:'/api/v1/web/likes/…/like/', title:'Like post', fields:[] });
  assert.equal(classify('https://www.instagram.com/api/v1/web/likes/123/unlike/', 'POST').title, 'Unlike post');
});
test('explicit reads pass; mutations and opaque documents are reviewed', () => {
  assert.equal(classify(url,'POST','fb_api_req_friendly_name=FeedQuery&variables=%7B%7D'), null);
  assert.equal(classify(url,'POST',JSON.stringify({query:'query Feed { viewer { id } }'})), null);
  assert.equal(classify(url,'POST',JSON.stringify({query:'{ viewer { id } }'})), null);
  assert.equal(classify(url,'POST','doc_id=123').title,'Unclassified GraphQL operation');
  assert.ok(classify(url,'POST',JSON.stringify({operationName:'FeedQuery',query:'mutation Like { like }'})));
});
test('form, JSON, headers and variables use only bounded field names', () => {
  const input = { fb_api_req_friendly_name:'SaveMutation', variables:JSON.stringify({input:{secret:'value'},'secret value!':'hidden'}) };
  for (const body of [JSON.stringify(input),new URLSearchParams(input)]) assert.deepEqual(classify(url,'POST',body).fields,['input']);
  assert.equal(classify(url,'POST','',new Headers({'x-fb-friendly-name':'HeaderMutation'})).title,'HeaderMutation');
  assert.equal(classify(url,'POST','variables=bad').fields.length,0);
  assert.equal(classify(url,'POST','fb_api_req_friendly_name='+ 'a'.repeat(300)).title.length,160);
});
test('oversized or malformed input remains an unclassified action', () => {
  assert.deepEqual(fields('a'.repeat(MAX_BODY+1)),{});
  assert.deepEqual(fields('{invalid'),{});
  assert.ok(classify(url,'POST','{invalid'));
});
