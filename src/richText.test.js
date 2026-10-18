import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RichText } from './richText.js';

const render = (value) => renderToStaticMarkup(createElement(RichText,{value}));

test('rich-text preview renders markdown structure without exposing formatting markers',() => {
  const html = render('# 先看合同\n\n先记住 **保障范围** 和 *适用条件*。\n\n- 看保险责任\n- 看责任免除\n\n> 具体以保险合同为准');
  assert.match(html,/<h1>先看合同<\/h1>/);
  assert.match(html,/<strong>保障范围<\/strong>/);
  assert.match(html,/<em>适用条件<\/em>/);
  assert.match(html,/<ul class="rich-text-list"><li>看保险责任<\/li><li>看责任免除<\/li><\/ul>/);
  assert.match(render('① 核对保险责任。'),/<p class="rich-text-step"><span class="rich-text-step-marker">①<\/span>核对保险责任。<\/p>/);
  assert.match(html,/<blockquote><p>具体以保险合同为准<\/p><\/blockquote>/);
  assert.doesNotMatch(html, /\*\*/);
});

test('rich-text preview safely escapes raw HTML and rejects unsafe link protocols',() => {
  const html = render('<script>alert(1)</script>\n\n[恶意链接](javascript:alert(1))\n\n![远程图片](https://example.com/tracker.png)');
  assert.match(html,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/href="javascript:/i);
  assert.match(html,/图片：远程图片/);
  assert.doesNotMatch(html,/<img\b/i);
});

test('rich-text preview supports markdown tables and code blocks',() => {
  const html = render('| 项目 | 说明 |\n| --- | --- |\n| 保险责任 | 合同约定 |\n\n`等待期`');
  assert.match(html,/<table>/);
  assert.match(html,/<th>项目<\/th>/);
  assert.match(html,/<td>合同约定<\/td>/);
  assert.match(html,/<code>等待期<\/code>/);
});
