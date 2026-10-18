import { createElement as h } from 'react';

const inlinePattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)|`([^`]+)`|\*\*(.+?)\*\*|__(.+?)__|~~(.+?)~~|\*([^*\n]+)\*|_([^_\n]+)_/g;
const headingPattern = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
const listPattern = /^\s*(?:[-*+]\s+|\d+[.)、]\s+|[①-⑳]\s*)/u;
const horizontalRulePattern = /^\s*(?:[-*_]\s*){3,}$/;

function safeHref(value) {
  const href = String(value || '').trim();
  if (/^(?:https?:|mailto:|tel:)/i.test(href)) return href;
  if (/^(?:\/|#)(?!\/)/.test(href)) return href;
  return null;
}

function renderInline(value, keyPrefix) {
  const text = String(value || '');
  const nodes = [];
  let cursor = 0;
  let match;
  const tokenPattern = new RegExp(inlinePattern.source,'g');

  while ((match = tokenPattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor,match.index));
    const key = `${keyPrefix}-${match.index}`;
    if (match[1] !== undefined) {
      nodes.push(h('span',{key,className:'rich-text-image-placeholder'},`图片：${match[1] || match[3] || '正文配图'}`));
    } else if (match[4] !== undefined) {
      const href = safeHref(match[5]);
      nodes.push(href
        ? h('a',{key,href,target:'_blank',rel:'noopener noreferrer'},...renderInline(match[4],key))
        : h('span',{key},...renderInline(match[4],key)));
    } else if (match[7] !== undefined) nodes.push(h('code',{key},match[7]));
    else if (match[8] !== undefined) nodes.push(h('strong',{key},...renderInline(match[8],key)));
    else if (match[9] !== undefined) nodes.push(h('strong',{key},...renderInline(match[9],key)));
    else if (match[10] !== undefined) nodes.push(h('del',{key},...renderInline(match[10],key)));
    else if (match[11] !== undefined) nodes.push(h('em',{key},...renderInline(match[11],key)));
    else if (match[12] !== undefined) nodes.push(h('em',{key},...renderInline(match[12],key)));
    cursor = tokenPattern.lastIndex;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function isTableStart(lines,index) {
  if (!lines[index]?.includes('|') || !lines[index + 1]?.includes('|')) return false;
  const separators = lines[index + 1].split('|').map((cell) => cell.trim()).filter(Boolean);
  return separators.length > 0 && separators.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isBlockStart(lines,index) {
  const line = lines[index] || '';
  return headingPattern.test(line)
    || /^\s*```/.test(line)
    || /^\s*>/.test(line)
    || listPattern.test(line)
    || horizontalRulePattern.test(line)
    || isTableStart(lines,index);
}

function splitTableRow(line) {
  const cells = line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map((cell) => cell.trim());
  return cells;
}

export function RichText({ value = '', className = '', emptyText = '生成稿件后会在这里显示富文本排版。' }) {
  const lines = String(value || '').replace(/\r\n?/g,'\n').split('\n');
  const blocks = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(/^\s*```\s*([\w-]*)/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(h('pre',{key:`block-${key++}`,className:'rich-text-code'},h('code',null,codeLines.join('\n'))));
      continue;
    }

    const heading = line.match(headingPattern);
    if (heading) {
      const level = Math.min(heading[1].length,4);
      blocks.push(h(`h${level}`,{key:`block-${key++}`},...renderInline(heading[2],`heading-${key}`)));
      index += 1;
      continue;
    }

    if (horizontalRulePattern.test(line)) {
      blocks.push(h('hr',{key:`block-${key++}`}));
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quoteLines.push(lines[index++].replace(/^\s*>\s?/,''));
      blocks.push(h('blockquote',{key:`block-${key++}`},h('p',null,...quoteLines.flatMap((item,lineIndex) => lineIndex ? [h('br',{key:`quote-break-${lineIndex}`}),...renderInline(item,`quote-${lineIndex}`)] : renderInline(item,`quote-${lineIndex}`)))));
      continue;
    }

    const circledStep = line.match(/^\s*([①-⑳])\s*(.*)$/u);
    if (circledStep) {
      blocks.push(h('p',{key:`block-${key++}`,className:'rich-text-step'},h('span',{className:'rich-text-step-marker'},circledStep[1]),...renderInline(circledStep[2],`step-${key}`)));
      index += 1;
      continue;
    }

    if (listPattern.test(line)) {
      const ordered = /^\s*(?:\d+[.)、]|[①-⑳])/.test(line);
      const items = [];
      while (index < lines.length && listPattern.test(lines[index]) && ordered === /^\s*(?:\d+[.)、]|[①-⑳])/.test(lines[index])) {
        const item = lines[index].replace(listPattern,'');
        items.push(h('li',{key:`list-${key}-${items.length}`},...renderInline(item,`list-${key}-${items.length}`)));
        index += 1;
      }
      blocks.push(h(ordered ? 'ol' : 'ul',{key:`block-${key++}`,className:'rich-text-list'},...items));
      continue;
    }

    if (isTableStart(lines,index)) {
      const headers = splitTableRow(lines[index]);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      const headerCells = headers.map((cell,cellIndex) => h('th',{key:`head-${cellIndex}`},...renderInline(cell,`head-${key}-${cellIndex}`)));
      const bodyRows = rows.map((row,rowIndex) => {
        const cells = headers.map((_cell,cellIndex) => h('td',{key:`cell-${rowIndex}-${cellIndex}`},...renderInline(row[cellIndex] || '',`cell-${key}-${rowIndex}-${cellIndex}`)));
        return h('tr',{key:`row-${rowIndex}`},...cells);
      });
      blocks.push(h('div',{key:`block-${key++}`,className:'rich-text-table-wrap'},h('table',null,
        h('thead',null,h('tr',null,...headerCells)),
        h('tbody',null,...bodyRows),
      )));
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines,index)) paragraphLines.push(lines[index++]);
    const paragraphChildren = paragraphLines.flatMap((item,lineIndex) => lineIndex ? [h('br',{key:`paragraph-break-${key}-${lineIndex}`}),...renderInline(item,`paragraph-${key}-${lineIndex}`)] : renderInline(item,`paragraph-${key}-0`));
    blocks.push(h('p',{key:`block-${key++}`},...paragraphChildren));
  }

  return h('div',{className:`rich-text ${className}`.trim()},...(blocks.length ? blocks : [h('p',{key:'empty',className:'rich-text-empty'},emptyText)]));
}
