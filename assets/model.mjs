export const MAX_CONTENT = 150000;
export const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function defaultProfile(config) {
  return {version:1, about:`${config.title}の日記。\n${config.description}`, name:'', bio:`${config.title}の日記。\n\n${config.description}`};
}
export function validateProfile(input) {
  if (!input || input.version !== 1) throw new Error('プロフィールの形式が不正');
  const profile = {version:1};
  for (const [key, max] of Object.entries({about:2000, name:80, bio:30000})) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error('プロフィールの文字数または形式が不正');
    profile[key] = input[key].replace(/\r\n?/g, '\n');
  }
  // Existing profiles keep the configured title until a name is saved here.
  if (input.siteTitle !== undefined) {
    if (typeof input.siteTitle !== 'string' || !input.siteTitle.trim() || input.siteTitle.length > 100 || /[\u0000-\u001f\u007f]/.test(input.siteTitle)) throw new Error('日記の名前は1〜100文字で、改行せずに入力してほしい。');
    profile.siteTitle = input.siteTitle.trim();
  }
  return profile;
}
export function validatePost(input) {
  if (!input || typeof input !== 'object' || !ID.test(input.id)) throw new Error('記事IDが不正');
  const result = {};
  for (const key of ['id', 'title', 'content', 'category', 'entryDate', 'status', 'createdAt', 'updatedAt']) {
    if (typeof input[key] !== 'string') throw new Error(`記事の ${key} が不正`);
    result[key] = input[key];
  }
  if (!result.title.trim() || result.title.length > 200) throw new Error('題名は1〜200文字で入力');
  if (result.content.length > MAX_CONTENT || result.category.length > 80) throw new Error('本文または分類が長すぎる');
  if (!['draft', 'published'].includes(result.status)) throw new Error('公開状態が不正');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result.entryDate) || !Number.isFinite(Date.parse(result.entryDate)) || new Date(result.entryDate).toISOString().slice(0, 10) !== result.entryDate) throw new Error('日付が不正');
  for (const key of ['createdAt', 'updatedAt']) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result[key]) || !Number.isFinite(Date.parse(result[key]))) throw new Error('更新日時が不正');
  }
  return result;
}
export function validateConfig(input) {
  for (const key of ['title', 'description', 'owner', 'sourceRepo', 'publicRepo', 'branch', 'siteUrl']) if (typeof input[key] !== 'string') throw new Error(`設定 ${key} が不正`);
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/.test(input.owner)) throw new Error('GitHubユーザー名が不正');
  for (const key of ['sourceRepo', 'publicRepo']) if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input[key])) throw new Error('リポジトリ名が不正');
  if (input.sourceRepo.toLowerCase() === input.publicRepo.toLowerCase()) throw new Error('原本と公開先には別のリポジトリを指定');
  if (input.branch !== 'main') throw new Error('原本のブランチは main を使用');
  const url = new URL(input.siteUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !/^\/(?:[a-zA-Z0-9._-]+\/)*$/.test(url.pathname)) throw new Error('サイトURLは末尾 / のHTTPS URLを指定');
  if (input.title.length > 100 || input.description.length > 1000) throw new Error('サイト名または説明が長すぎる');
  return { ...input, siteUrl: url.href };
}
export const comparePosts = (a, b) => b.entryDate.localeCompare(a.entryDate) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
export const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
export const plainBody = value => value.split(/\n{2,}/).map(p => `<p>${escapeHTML(p)}</p>`).join('');
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
