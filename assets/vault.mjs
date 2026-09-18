// Only the encrypted GitHub credential is persisted. Passwords and keys are not.
// GitHub remains the authority for reading and changing the private repository.
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', {fatal:true});
const ITERATIONS = 600000;
const bytes64 = bytes => btoa(String.fromCharCode(...bytes));
function from64(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error();
  return Uint8Array.from(atob(value), c => c.charCodeAt(0));
}
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('パスワードは12〜256文字で設定してほしい。');
  if (!password.trim()) throw new Error('空白だけのパスワードは使えない。');
}
function validateToken(token) {
  if (typeof token !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(token)) throw new Error('GitHubトークンの形式を確認してほしい。');
  return token;
}
export class PasswordVault {
  constructor(config, storage = globalThis.localStorage, webcrypto = globalThis.crypto) {
    this.storage = storage;
    this.crypto = webcrypto;
    this.context = `aoi-token-v1\n${config.owner.toLowerCase()}\n${config.sourceRepo.toLowerCase()}\n${config.branch}\n${config.siteUrl}`;
    this.storageKey = `aoi:encrypted-token:${encodeURIComponent(this.context)}`;
  }
  snapshot() {
    try { return this.storage.getItem(this.storageKey); }
    catch { throw new Error('このブラウザにログイン設定を保存できない。サイトのデータ保存を許可してから開き直してほしい。'); }
  }
  hasSaved() { return this.snapshot() !== null; }
  async derive(password, salt) {
    if (!this.crypto?.subtle) throw new Error('このブラウザでは暗号化を使えない。HTTPSの管理画面を最新のブラウザで開いてほしい。');
    const material = await this.crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return this.crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'}, material, {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  }
  async seal(token, password) {
    validatePassword(password); validateToken(token);
    if (!this.crypto?.subtle) throw new Error('このブラウザでは暗号化を使えない。HTTPSの管理画面を最新のブラウザで開いてほしい。');
    const salt = this.crypto.getRandomValues(new Uint8Array(32));
    const iv = this.crypto.getRandomValues(new Uint8Array(12));
    const key = await this.derive(password, salt);
    const plain = encoder.encode(token);
    try {
      const encrypted = await this.crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(this.context),tagLength:128}, key, plain);
      return JSON.stringify({version:1,kdf:'PBKDF2-SHA256',iterations:ITERATIONS,cipher:'AES-GCM',salt:bytes64(salt),iv:bytes64(iv),data:bytes64(new Uint8Array(encrypted))});
    } finally { plain.fill(0); }
  }
  async open(raw, password) {
    if (!raw) throw new Error('このブラウザにはまだパスワードを登録していない。');
    if (typeof password !== 'string' || !password || password.length > 256) throw new Error('パスワードを入力してほしい。');
    let value, salt, iv, data;
    try {
      if (raw.length > 4096) throw new Error();
      value = JSON.parse(raw);
      if (value.version !== 1 || value.kdf !== 'PBKDF2-SHA256' || value.iterations !== ITERATIONS || value.cipher !== 'AES-GCM') throw new Error();
      salt = from64(value.salt); iv = from64(value.iv); data = from64(value.data);
      if (salt.length !== 32 || iv.length !== 12 || data.length < 17 || data.length > 528) throw new Error();
    } catch { throw new Error('保存されたログイン設定を読み取れない。「トークンで登録し直す」から再登録してほしい。'); }
    const key = await this.derive(password, salt);
    let plain;
    try {
      plain = new Uint8Array(await this.crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:encoder.encode(this.context),tagLength:128}, key, data));
      return validateToken(decoder.decode(plain));
    } catch { throw new Error('パスワードが違うか、保存されたログイン設定が壊れている。'); }
    finally { plain?.fill(0); }
  }
  unlock(password) { return this.open(this.snapshot(), password); }
  replace(raw, expected) {
    if (this.snapshot() !== expected) throw new Error('別のタブでログイン設定が変わった。ページを開き直してほしい。');
    try { this.storage.setItem(this.storageKey, raw); }
    catch { throw new Error('暗号化したトークンを保存できなかった。ブラウザのデータ保存設定を確認してほしい。'); }
  }
  async register(token, password, expected = this.snapshot()) {
    const encrypted = await this.seal(token, password);
    this.replace(encrypted, expected);
  }
  async changePassword(currentPassword, newPassword) {
    validatePassword(newPassword);
    const previous = this.snapshot();
    const token = await this.open(previous, currentPassword);
    await this.register(token, newPassword, previous);
  }
  forget() {
    try { this.storage.removeItem(this.storageKey); }
    catch { throw new Error('保存したログイン設定を削除できなかった。ブラウザの設定を確認してほしい。'); }
  }
}
