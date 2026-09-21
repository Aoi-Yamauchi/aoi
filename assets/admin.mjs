import { GitHubStore } from './github.mjs';
import { PasswordVault, validatePassword } from './vault.mjs';
import { markdownZip } from './export.mjs';
import { today, validateConfig, validateProfile } from './model.mjs';
import { initBodyEditor } from './editor.mjs';
const $ = id => document.getElementById(id);
const bodyEditor = initBodyEditor($('content'), $('content-count'));
let store, config, vault, rows = [], current = null, profileCurrent = null, editorId, dirty = false, busy = false, sessionEpoch = 0;
function notice(text, error = false) { $('notice').textContent = text; $('notice').className = error ? 'form-error' : 'notice'; }
function view(name) {
  for (const id of ['login','dashboard','editor','profile','security']) $(id).hidden = id !== name;
  $('disconnect').hidden = !store; $('admin-nav').hidden = !store;
  const active = name === 'editor' ? 'posts' : name === 'dashboard' ? 'posts' : name;
  for (const id of ['posts','profile','security']) $('nav-'+id).setAttribute('aria-current',id === active ? 'page' : 'false');
  if (name !== 'security') $('password-form').reset();
}
function canLeave() { return !busy && (!dirty || confirm('保存していない変更がある。変更を破棄して移動する？')); }
function showLogin(setup = false) {
  let saved = false;
  try { saved = vault?.hasSaved() ?? false; }
  catch (error) { vault = null; notice(error.message,true); }
  $('unlock-form').hidden = !vault || !saved || setup;
  $('setup-form').hidden = !vault || (saved && !setup);
  $('cancel-setup').hidden = !saved;
  $('temporary-login').open = !vault;
  $('unlock-account').value = config?.owner ?? '';
  $('unlock-form').reset(); $('setup-form').reset(); $('temporary-form').reset();
  $('unlock-account').value = config?.owner ?? '';
  view('login');
}
function clearSession() {
  sessionEpoch++;
  store?.disconnect(); store = null; rows = []; current = null; profileCurrent = null; dirty = false;
  for (const id of ['editor-form','profile-form','password-form','unlock-form','setup-form','temporary-form']) $(id).reset();
  bodyEditor.refresh();
  for (const id of ['preview-content','preview-title','post-list','about-preview','profile-name-preview','bio-preview']) $(id).replaceChildren();
  $('search').value = ''; $('filter').value = 'all';
}
async function connect(token, beforeEnter) {
  if (!config) throw new Error('接続設定を読み込めなかった。ページを再読み込みしてほしい。');
  const candidate = new GitHubStore(config, token);
  const epoch = sessionEpoch;
  try {
    const latest = await candidate.connect();
    if (epoch !== sessionEpoch) throw new Error('もう一度ログインしてほしい。');
    if (beforeEnter) await beforeEnter();
    if (epoch !== sessionEpoch) throw new Error('もう一度ログインしてほしい。');
    store = candidate; rows = latest;
  } catch (error) { candidate.disconnect(); throw error; }
  try { $('nav-security').hidden = !vault?.hasSaved(); } catch { $('nav-security').hidden = true; }
  renderList(); view('dashboard');
}
function plainPreview(id, text) {
  $(id).replaceChildren();
  for (const chunk of text.split(/\n{2,}/)) { const p = document.createElement('p'); p.textContent = chunk; $(id).append(p); }
}
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
function renderPublishState() {
  const published = current?.post.status === 'published';
  $('post-status').textContent = published ? '公開' : '下書き';
  $('post-status').dataset.published = String(published);
  $('unpublish-post').hidden = !published;
  $('publish-post').textContent = published ? '公開を更新する' : '公開する';
  $('publish-help').textContent = published
    ? '公開済みの日記は「保存する」でも変更が公開サイトに反映される。反映には数分かかる。'
    : '「保存する」で下書きを保存し、「公開する」でサイトに公開する。公開サイトへの反映には数分かかる。';
}
function editPost(row = null) {
  current = row;
  const p = row?.post;
  editorId = p?.id ?? crypto.randomUUID();
  $('title').value = p?.title ?? ''; $('entry-date').value = p?.entryDate ?? today(); $('category').value = p?.category ?? ''; $('content').value = p?.content ?? '';
  renderPublishState();
  $('editor-title').textContent = p ? '日記を編集する' : '日記を書く'; $('delete-post').hidden = !p; $('preview').hidden = true; $('preview-toggle').textContent = '本文を確認';
  dirty = false; $('save-state').textContent = ''; notice(''); view('editor'); bodyEditor.refresh(); $('title').focus();
}
$('setup-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const token = $('token').value.trim(); $('token').value = '';
  const password = $('setup-password').value, confirmPassword = $('setup-confirm').value;
  $('setup-password').value = ''; $('setup-confirm').value = '';
  validatePassword(password);
  if (password !== confirmPassword) throw new Error('2つのパスワードが一致していない。');
  if (!vault) throw new Error('このブラウザではログイン設定を保存できない。');
  const previous = vault.snapshot();
  notice('トークンを確認して、パスワードを登録している…');
  await connect(token, () => vault.register(token,password,previous));
  notice('登録した。次回から、このブラウザではパスワードだけでログインできる。');
}); });
$('unlock-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const password = $('password').value; $('password').value = '';
  notice('ログインしている…');
  const token = await vault.unlock(password);
  await connect(token); notice('ログインした。');
}); });
$('temporary-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const token = $('temporary-token').value.trim(); $('temporary-token').value = '';
  notice('GitHubに接続している…'); await connect(token); notice('今回だけ接続した。');
}); });
$('reset-login').addEventListener('click', () => { showLogin(true); notice('新しいトークンの確認とパスワードの登録が成功すると、以前の登録を置き換える。'); });
$('cancel-setup').addEventListener('click', () => { showLogin(); notice(''); });
$('disconnect').addEventListener('click', () => {
  if (!canLeave()) return;
  clearSession(); showLogin(); notice('ログアウトした。');
});
$('new-post').addEventListener('click', () => editPost());
$('back').addEventListener('click', () => { if (!canLeave()) return; dirty = false; renderList(); view('dashboard'); });
$('nav-posts').addEventListener('click', () => { if (!canLeave()) return; dirty = false; renderList(); view('dashboard'); notice(''); });
$('nav-profile').addEventListener('click', () => {
  if (!canLeave()) return;
  operation(async () => {
    notice('プロフィールを読み込んでいる…');
    const latest = await store.readProfile();
    profileCurrent = latest;
    $('about-copy').value = latest.profile.about; $('profile-name').value = latest.profile.name; $('profile-bio').value = latest.profile.bio;
    $('profile-save-state').textContent = ''; $('profile-preview').hidden = true; $('profile-preview-toggle').textContent = '表示を確認';
    dirty = false; view('profile'); notice('');
  });
});
$('nav-security').addEventListener('click', () => { if (!canLeave()) return; dirty = false; $('password-form').reset(); view('security'); notice(''); });
$('password-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const oldPassword = $('current-password').value, password = $('new-password').value, confirmation = $('confirm-password').value;
  $('password-form').reset();
  validatePassword(password);
  if (password !== confirmation) throw new Error('2つの新しいパスワードが一致していない。');
  notice('パスワードを変更している…'); await vault.changePassword(oldPassword,password); notice('このブラウザのパスワードを変更した。');
}); });
$('forget-device').addEventListener('click', () => {
  if (!canLeave() || !confirm('このブラウザのログイン設定を削除してログアウトする？ 次回はGitHubトークンでの登録が必要になる。記事は消えない。')) return;
  operation(async () => { vault.forget(); clearSession(); showLogin(); notice('このブラウザの登録を削除した。'); });
});
$('profile-form').addEventListener('input', () => { dirty = true; $('profile-save-state').textContent = '未保存'; });
$('profile-form').addEventListener('submit', e => { e.preventDefault(); operation(async () => {
  const profile = validateProfile({version:1,about:$('about-copy').value,name:$('profile-name').value.trim(),bio:$('profile-bio').value});
  notice('プロフィールを保存している…');
  const result = await store.saveProfile(profile,profileCurrent?.sha);
  profileCurrent = {profile,sha:result.content.sha}; dirty = false; $('profile-save-state').textContent = '保存済み';
  notice('ABOUTとプロフィールを原本に保存した。公開サイトへの反映には数分かかる。');
}); });
$('profile-preview-toggle').addEventListener('click', () => {
  $('profile-preview').hidden = !$('profile-preview').hidden;
  $('profile-preview-toggle').textContent = $('profile-preview').hidden ? '表示を確認' : '確認を閉じる';
  plainPreview('about-preview',$('about-copy').value); plainPreview('bio-preview',$('profile-bio').value);
  $('profile-name-preview').textContent = $('profile-name').value.trim(); $('profile-name-preview').hidden = !$('profile-name-preview').textContent;
});
$('filter').addEventListener('change',renderList); $('search').addEventListener('input',renderList);
$('refresh').addEventListener('click', () => operation(async () => { notice('記事を読み込んでいる…'); rows = await store.list(); renderList(); notice('最新の記事を読み込んだ。'); }));
$('editor-form').addEventListener('input', () => { dirty = true; $('save-state').textContent = '未保存'; });
async function savePost(status) {
  const timestamp = new Date().toISOString();
  const wasPublished = current?.post.status === 'published';
  const post = { id:editorId, title:$('title').value.trim(), entryDate:$('entry-date').value, category:$('category').value.trim(), content:$('content').value.replace(/\r\n?/g,'\n'), status, createdAt:current?.post.createdAt ?? timestamp, updatedAt:timestamp };
  notice('保存している…');
  const result = await store.save(post,current?.sha);
  current = {post,sha:result.content.sha}; rows = [...rows.filter(r => r.post.id !== post.id),current];
  dirty = false; $('save-state').textContent = '保存済み'; $('delete-post').hidden = false; $('editor-title').textContent = '日記を編集する';
  renderPublishState();
  notice(status === 'published'
    ? '公開する内容を保存した。サイトへの反映には数分かかる。一覧の「公開の反映状況」で確認できる。'
    : wasPublished ? '下書きに戻して保存した。公開サイトから消えるまで数分かかる。' : '下書きを保存した。「公開する」を押すまでサイトには公開されない。');
}
$('editor-form').addEventListener('submit', e => {
  e.preventDefault();
  // Enter and submissions without an explicit publish button preserve the saved status.
  const status = e.submitter === $('publish-post') ? 'published' : current?.post.status ?? 'draft';
  operation(() => savePost(status));
});
$('unpublish-post').addEventListener('click', () => {
  if (busy || current?.post.status !== 'published' || !$('editor-form').reportValidity()) return;
  if (!confirm('編集内容を保存して、この日記を下書きに戻す？ 公開サイトから消えるまで数分かかる。')) return;
  operation(() => savePost('draft'));
});
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
// A back/forward-cache restore must not bring back an unlocked tab or drafts.
window.addEventListener('pagehide', () => { clearSession(); view('login'); });
window.addEventListener('pageshow', e => { if (e.persisted) { showLogin(); notice('もう一度ログインしてほしい。'); } });
try {
  const response = await fetch(new URL('./admin-config.json',import.meta.url),{cache:'no-store'});
  if (!response.ok) throw new Error('設定を読み込めなかった。');
  config = validateConfig(await response.json());
  // The repository is set by the site build, never by URL parameters or pasted links.
  if (!/^[a-zA-Z0-9-]+$/.test(config.owner) || !/^[a-zA-Z0-9._-]+$/.test(config.sourceRepo)) throw new Error('接続設定が不正。');
  $('actions-link').href = `https://github.com/${config.owner}/${config.sourceRepo}/actions`;
  try { vault = new PasswordVault(config); vault.snapshot(); }
  catch (error) { vault = null; notice(error.message || 'このブラウザではログイン設定を保存できない。',true); }
  showLogin();
  if (config.owner === 'your-username') notice('初期設定が必要。導入手順に沿ってGitHubユーザー名を設定してほしい。',true);
} catch (error) { notice(error.message,true); }
