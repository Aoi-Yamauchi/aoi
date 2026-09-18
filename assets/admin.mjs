import { GitHubStore } from './github.mjs';
import { markdownZip } from './export.mjs';
import { today } from './model.mjs';
const $ = id => document.getElementById(id);
let store, config, rows = [], current = null, editorId, dirty = false, busy = false;
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'form-error' : 'notice'; }
function view(name) { for (const id of ['login','dashboard','editor']) $(id).hidden = id !== name; $('disconnect').hidden = !store; }
function canLeave() { return !dirty || confirm('保存していない変更がある。変更を破棄して移動する？'); }
function renderList() {
  const filter = $('filter').value, query = $('search').value.toLocaleLowerCase();
  const list = $('post-list'); list.replaceChildren();
  const filtered = rows.filter(({post:p}) => (filter === 'all' || p.status === filter) && [p.title,p.content,p.category].some(s => s.toLocaleLowerCase().includes(query)));
  for (const row of filtered) {
    const p = row.post, item = document.createElement('div'); item.className = 'admin-row';
    const date = document.createElement('time'); date.dateTime = p.entryDate; date.textContent = p.entryDate; date.className = 'archive-date';
    const title = document.createElement('span'); title.textContent = p.title; title.className = 'admin-row-title';
    const status = document.createElement('span'); status.textContent = p.status === 'published' ? '公開' : '下書き'; status.className = 'status-pill'; status.dataset.published = String(p.status === 'published');
    const edit = document.createElement('button'); edit.textContent = '編集'; edit.addEventListener('click',() => editPost(row));
    item.append(date,title,status,edit); list.append(item);
  }
  if (!filtered.length) { const empty = document.createElement('p'); empty.textContent = rows.length ? '該当する日記がない。' : 'まだ日記がない。「日記を書く」から始める。'; list.append(empty); }
}
async function operation(action) {
  if (busy) return;
  busy = true;
  const controls = [...document.querySelectorAll('button,input,textarea,select')];
  const states = controls.map(el => el.disabled); controls.forEach(el => el.disabled = true);
  try { await action(); } catch (error) { notice(error.message, true); }
  finally { controls.forEach((el,i) => el.disabled = states[i]); busy = false; }
}
function editPost(row = null) {
  current = row;
  const p = row?.post;
  editorId = p?.id ?? crypto.randomUUID();
  $('title').value = p?.title ?? ''; $('entry-date').value = p?.entryDate ?? today(); $('category').value = p?.category ?? ''; $('content').value = p?.content ?? ''; $('published').checked = p?.status === 'published';
  $('editor-title').textContent = p ? '日記を編集する' : '日記を書く'; $('delete-post').hidden = !p; $('preview').hidden = true; $('preview-toggle').textContent = '本文を確認';
  dirty = false; $('save-state').textContent = ''; notice(''); view('editor'); $('title').focus();
}
$('login-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const token = $('token').value.trim(); $('token').value = '';
  if (!config) throw new Error('接続設定を読み込めなかった。ページを再読み込みしてほしい。');
  const candidate = new GitHubStore(config, token); notice('GitHubに接続している…');
  try { rows = await candidate.connect(); store = candidate; } catch (error) { candidate.disconnect(); throw error; }
  renderList(); view('dashboard'); notice('接続した。');
}); });
$('disconnect').addEventListener('click', () => {
  if (!canLeave()) return;
  store?.disconnect(); store = null; rows = []; current = null; dirty = false;
  $('editor-form').reset(); $('preview-content').replaceChildren(); $('preview-title').textContent = ''; $('post-list').replaceChildren(); view('login'); notice('接続を解除した。');
});
$('new-post').addEventListener('click', () => editPost());
$('back').addEventListener('click', () => { if (!canLeave()) return; dirty = false; renderList(); view('dashboard'); });
$('filter').addEventListener('change',renderList); $('search').addEventListener('input',renderList);
$('refresh').addEventListener('click', () => operation(async () => { notice('記事を読み込んでいる…'); rows = await store.list(); renderList(); notice('最新の記事を読み込んだ。'); }));
$('editor-form').addEventListener('input', () => { dirty = true; $('save-state').textContent = '未保存'; });
$('editor-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const timestamp = new Date().toISOString();
  const post = { id:editorId, title:$('title').value.trim(), entryDate:$('entry-date').value, category:$('category').value.trim(), content:$('content').value.replace(/\r\n?/g,'\n'), status:$('published').checked ? 'published' : 'draft', createdAt:current?.post.createdAt ?? timestamp, updatedAt:timestamp };
  notice('保存している…');
  const result = await store.save(post,current?.sha);
  current = {post,sha:result.content.sha}; rows = [...rows.filter(r => r.post.id !== post.id),current];
  dirty = false; $('save-state').textContent = '保存済み'; $('delete-post').hidden = false; $('editor-title').textContent = '日記を編集する';
  notice(post.status === 'published' ? '原本に保存した。公開サイトへの反映は「公開の反映状況」で確認できる。' : '下書きを原本に保存した。以前の公開記事を下書きにした場合、サイトから消えるまで数分かかる。');
}); });
$('delete-post').addEventListener('click', () => {
  if (!current || !confirm('この日記を削除する？ 公開記事の場合、サイトからも削除される。')) return;
  operation(async () => { await store.remove(current.post,current.sha); rows = rows.filter(r => r.post.id !== current.post.id); current = null; dirty = false; $('editor-form').reset(); renderList(); view('dashboard'); notice('削除した。公開サイトには数分後に反映される。'); });
});
$('preview-toggle').addEventListener('click', () => {
  $('preview').hidden = !$('preview').hidden; $('preview-toggle').textContent = $('preview').hidden ? '本文を確認' : '確認を閉じる';
  $('preview-title').textContent = $('title').value; $('preview-content').replaceChildren();
  for (const text of $('content').value.split(/\n{2,}/)) { const p = document.createElement('p'); p.textContent = text; $('preview-content').append(p); }
});
$('export').addEventListener('click', () => operation(async () => {
  notice('下書きを含む全記事を取得している…');
  const latest = await store.list();
  if (!latest.length) { notice('書き出せる日記がまだない。'); return; }
  const zip = markdownZip(latest.map(r => r.post));
  const url = URL.createObjectURL(new Blob([zip],{type:'application/zip'}));
  const link = document.createElement('a'); link.href = url; link.download = `aoi-diary-${today()}.zip`; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),60000);
  rows = latest; renderList(); notice(`${latest.length}件を書き出した。ダウンロード先を確認してほしい。`);
}));
window.addEventListener('beforeunload', e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ''; } });
try {
  const response = await fetch(new URL('./admin-config.json',import.meta.url),{cache:'no-store'});
  if (!response.ok) throw new Error('設定を読み込めなかった。');
  config = await response.json();
  // The repository is set by the site build, never by URL parameters or pasted links.
  if (!/^[a-zA-Z0-9-]+$/.test(config.owner) || !/^[a-zA-Z0-9._-]+$/.test(config.sourceRepo)) throw new Error('接続設定が不正。');
  $('actions-link').href = `https://github.com/${config.owner}/${config.sourceRepo}/actions`;
  if (config.owner === 'your-username') notice('初期設定が必要。導入手順に沿ってGitHubユーザー名を設定してほしい。',true);
} catch (error) { notice(error.message,true); }
