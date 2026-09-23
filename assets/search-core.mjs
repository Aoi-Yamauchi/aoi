import { ID } from './model.mjs';

export const MAX_QUERY = 200;
const segments = new Intl.Segmenter('ja', {granularity:'grapheme'});
export const normalizeSearch = text => text.normalize('NFKC').toLowerCase().replace(/ς/g,'σ');

export function searchTerms(query) {
  if (query.length > MAX_QUERY) throw new Error(`検索語は${MAX_QUERY}文字以内で入力してほしい。`);
  return [...new Set(normalizeSearch(query).trim().split(/\s+/u).filter(Boolean))];
}

export function prepareSearchIndex(data) {
  if (data?.version !== 1 || !Array.isArray(data.posts)) throw new Error('検索データの形式が不正');
  return data.posts.map(post => {
    if (!post || !ID.test(post.id) || !/^\d{4}-\d{2}-\d{2}$/.test(post.entryDate) || !['title','content','category'].every(key=>typeof post[key] === 'string')) throw new Error('検索データの形式が不正');
    return {post, fields:[post.title,post.content,post.category].map(normalizeSearch)};
  });
}

export function findPosts(index, terms) {
  return terms.length ? index.filter(row=>terms.every(term=>row.fields.some(field=>field.includes(term)))).map(row=>row.post) : [];
}

// Keep original characters in the excerpt, including combined kana and emoji.
// Only retain a small window even when a match is near the end of a long entry.
export function searchExcerpt(content, terms, limit = 180) {
  const text = content.replace(/\s+/gu,' ').trim(), folded = normalizeSearch(text);
  const positions = terms.map(term=>folded.indexOf(term)).filter(pos=>pos >= 0);
  const target = positions.length ? Math.min(...positions) : 0;
  const before = [], selected = [];
  let offset = 0, started = false, end = 0;
  for (const part of segments.segment(text)) {
    const size = normalizeSearch(part.segment).length;
    if (!started && offset + size > target) { selected.push(...before); started = true; }
    if (started) {
      selected.push(part); end = part.index + part.segment.length;
      if (selected.length >= limit) break;
    } else {
      before.push(part); if (before.length > 40) before.shift();
    }
    offset += size;
  }
  return (selected[0]?.index > 0 ? '…' : '') + selected.map(part=>part.segment).join('') + (end < text.length ? '…' : '');
}

// Return text spans for safe DOM rendering; never treat entries or queries as HTML.
export function highlightParts(text, terms) {
  let folded = ''; const starts = [], ends = [];
  for (const part of segments.segment(text)) {
    const normalized = normalizeSearch(part.segment);
    folded += normalized;
    for (let i = 0; i < normalized.length; i++) { starts.push(part.index); ends.push(part.index + part.segment.length); }
  }
  const ranges = [];
  for (const term of terms) {
    if (!term) continue;
    for (let at = folded.indexOf(term); at >= 0; at = folded.indexOf(term,at + 1)) ranges.push([starts[at],ends[at + term.length - 1]]);
  }
  ranges.sort((a,b)=>a[0]-b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1],range[1]);
    else merged.push([...range]);
  }
  const parts = []; let at = 0;
  for (const [start,end] of merged) {
    if (at < start) parts.push({text:text.slice(at,start),match:false});
    parts.push({text:text.slice(start,end),match:true}); at = end;
  }
  if (at < text.length) parts.push({text:text.slice(at),match:false});
  return parts;
}
