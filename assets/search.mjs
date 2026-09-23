import { searchTerms, prepareSearchIndex, findPosts, searchExcerpt, highlightParts } from './search-core.mjs';

const $ = id => document.getElementById('public-search-'+id);
const form = $('form'), field = $('query'), status = $('status'), list = $('results'), more = $('more');
const pageSize = 20;
let indexPromise, revision = 0, matches = [], terms = [], displayed = 0;

function loadIndex() {
  if (!indexPromise) indexPromise = (async () => {
    const response = await fetch(new URL('./search-index.json',import.meta.url),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('検索データを取得できなかった');
    return prepareSearchIndex(await response.json());
  })().catch(error => { indexPromise = null; throw error; });
  return indexPromise;
}

function highlight(element, text) {
  for (const part of highlightParts(text,terms)) {
    if (part.match) { const mark = document.createElement('mark'); mark.textContent = part.text; element.append(mark); }
    else element.append(document.createTextNode(part.text));
  }
}

function showMore() {
  const chunk = document.createDocumentFragment(), first = displayed;
  for (const post of matches.slice(displayed,displayed + pageSize)) {
    const item = document.createElement('li'); item.className = 'public-search-result';
    const date = document.createElement('time'); date.className = 'post-date'; date.dateTime = post.entryDate; date.textContent = post.entryDate.replaceAll('-','.');
    const heading = document.createElement('h2'); heading.className = 'post-title';
    const link = document.createElement('a'); link.href = new URL(`../posts/${post.id}/`,import.meta.url).href; highlight(link,post.title); heading.append(link);
    const excerpt = document.createElement('p'); excerpt.className = 'public-search-excerpt'; highlight(excerpt,searchExcerpt(post.content,terms));
    item.append(date,heading,excerpt);
    if (post.category) { const category = document.createElement('p'); category.className = 'public-search-category'; category.append(document.createTextNode('分類：')); highlight(category,post.category); item.append(category); }
    chunk.append(item);
  }
  list.append(chunk); displayed = Math.min(matches.length,displayed + pageSize);
  more.hidden = displayed >= matches.length;
  more.textContent = `さらに${Math.min(pageSize,matches.length - displayed)}件表示`;
  // Move keyboard focus to the newly added entries instead of skipping them.
  if (first > 0) list.children[first]?.querySelector('a').focus();
}

async function runSearch(updateHistory = true) {
  const current = ++revision, query = field.value.trim();
  matches = []; displayed = 0; list.replaceChildren(); more.hidden = true; list.setAttribute('aria-busy','false');
  status.className = 'public-search-status';
  try { terms = searchTerms(query); }
  catch (error) { status.classList.add('form-error'); status.textContent = error.message; return; }
  if (updateHistory) {
    const url = new URL(location.href);
    if (query) url.searchParams.set('q',query); else url.searchParams.delete('q');
    if (url.href !== location.href) history.pushState(null,'',url);
  }
  if (!terms.length) { status.textContent = '検索語を入力して「検索する」を押す。'; return; }
  status.textContent = '日記を検索している…'; list.setAttribute('aria-busy','true');
  try {
    const index = await loadIndex();
    if (current !== revision) return;
    matches = findPosts(index,terms); showMore();
    status.textContent = matches.length ? `「${query}」：${matches.length}件見つかった。新しい順に表示。` : `「${query}」に一致する日記はない。別の言葉で検索できる。`;
  } catch {
    if (current !== revision) return;
    status.classList.add('form-error'); status.textContent = '検索データを読み込めなかった。通信を確認し、もう一度「検索する」を押してほしい。';
  } finally { if (current === revision) list.setAttribute('aria-busy','false'); }
}

let composing = false;
field.addEventListener('compositionstart',()=>{ composing = true; });
field.addEventListener('compositionend',()=>{ composing = false; });
form.addEventListener('submit',event=>{ event.preventDefault(); if (!composing) runSearch(); });
$('clear').addEventListener('click',()=>{ field.value = ''; runSearch(); field.focus(); });
more.addEventListener('click',showMore);
window.addEventListener('popstate',()=>{ field.value = new URL(location.href).searchParams.get('q') ?? ''; runSearch(false); });
for (const id of ['query','submit','clear']) $(id).disabled = false;
field.value = new URL(location.href).searchParams.get('q') ?? '';
if (field.value) runSearch(false);
