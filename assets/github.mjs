import { validatePost, comparePosts, ID } from './model.mjs';
const enc = new TextEncoder(), dec = new TextDecoder('utf-8', { fatal: true });
export const encode64 = text => { let s = ''; for (const b of enc.encode(text)) s += String.fromCharCode(b); return btoa(s); };
export const decode64 = text => dec.decode(Uint8Array.from(atob(text.replace(/\s/g,'')), c => c.charCodeAt(0)));
export class GitHubError extends Error {
  constructor(status) {
    super(({401:'トークンが無効か期限切れ。再接続してほしい。',403:'権限不足、承認待ち、またはAPI制限。GitHubの設定を確認してほしい。',404:'原本が見つからない。リポジトリ名とトークンのアクセス先を確認してほしい。',409:'別の更新と競合した。入力は残っているので、別タブで最新版を確認してほしい。',422:'保存を受け付けられなかった。競合やブランチ保護を確認してほしい。'})[status] || `GitHubでエラーが発生した（${status}）。`);
    this.status = status;
  }
}
export class GitHubStore {
  #token;
  constructor(config, token, fetcher = fetch) {
    this.config = config; this.#token = token; this.fetcher = (...args) => fetcher(...args);
    this.root = `/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.sourceRepo)}`;
  }
  disconnect() { this.#token = ''; }
  async request(path, method = 'GET', body) {
    if (!this.#token) throw new Error('GitHubに接続してほしい');
    let response;
    try { response = await this.fetcher(`https://api.github.com${this.root}${path}`, {
      method, headers: { Accept:'application/vnd.github+json', Authorization:`Bearer ${this.#token}`, 'X-GitHub-Api-Version':'2026-03-10', ...(body ? {'Content-Type':'application/json'} : {}) },
      body: body ? JSON.stringify(body) : undefined, cache:'no-store', credentials:'omit', redirect:'error', signal: AbortSignal.timeout(60000)
    }); } catch { throw new Error('GitHubに接続できない。保存操作中だった場合は再接続し、保存結果を確認してほしい。'); }
    if (!response.ok) throw new GitHubError(response.status);
    return response.status === 204 ? null : response.json();
  }
  async connect() {
    const repo = await this.request('');
    if (!repo.private) throw new Error('下書き保護のため、原本は非公開リポジトリにしてほしい');
    if (repo.default_branch !== this.config.branch) throw new Error('原本の既定ブランチは main にしてほしい');
    return this.list();
  }
  async list() {
    const tree = await this.request(`/git/trees/${encodeURIComponent(this.config.branch)}?recursive=1`);
    if (tree.truncated) throw new Error('記事一覧がGitHubの取得上限を超えた。原本リポジトリから書き出してほしい。');
    const entries = tree.tree.filter(e => e.type === 'blob' && /^content\/posts\/[^/]+\.json$/.test(e.path));
    const posts = [];
    // A tree snapshot ensures one export cannot mix revisions during concurrent writes.
    for (let i = 0; i < entries.length; i += 4) {
      posts.push(...await Promise.all(entries.slice(i,i+4).map(async e => {
        const id = e.path.slice('content/posts/'.length, -5);
        if (!ID.test(id)) throw new Error('原本に不正な記事ファイル名がある');
        const blob = await this.request(`/git/blobs/${e.sha}`);
        if (blob.encoding !== 'base64') throw new Error('記事の形式を読み取れない');
        const post = validatePost(JSON.parse(decode64(blob.content)));
        if (post.id !== id) throw new Error('記事IDとファイル名が一致しない');
        return { post, sha:e.sha };
      })));
    }
    return posts.sort((a,b) => comparePosts(a.post,b.post));
  }
  async save(value, sha) {
    const post = validatePost(value);
    return this.request(`/contents/content/posts/${post.id}.json`, 'PUT', {
      message:`diary: ${sha ? 'update' : 'create'} ${post.id}`, content:encode64(JSON.stringify(post,null,2)+'\n'), branch:this.config.branch, ...(sha ? {sha} : {})
    });
  }
  async remove(value, sha) {
    const post = validatePost(value);
    if (!sha) throw new Error('削除対象の版が不明');
    return this.request(`/contents/content/posts/${post.id}.json`, 'DELETE', {message:`diary: delete ${post.id}`,sha,branch:this.config.branch});
  }
}
