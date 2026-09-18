const message = document.getElementById('random-message');
try {
  const response = await fetch(new URL('./published.json',import.meta.url),{cache:'no-store'});
  if (!response.ok) throw new Error();
  const paths = await response.json();
  if (!paths.length) message.textContent = 'まだ日記がない。';
  else {
    const path = paths[Math.floor(Math.random() * paths.length)];
    if (!/^posts\/[a-f0-9-]+\/$/.test(path)) throw new Error();
    location.replace(new URL('../'+path,import.meta.url));
  }
} catch { message.textContent = '日記を選べなかった。一覧から開いてほしい。'; }
