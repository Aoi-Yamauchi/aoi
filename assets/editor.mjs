const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('ja', {granularity:'grapheme'}) : null;
const number = new Intl.NumberFormat('ja-JP');

export function countCharacters(value) {
  const text = value.replace(/[\r\n]/g, '');
  let count = 0;
  for (const _ of segmenter ? segmenter.segment(text) : text) count++;
  return count;
}

export function initBodyEditor(textarea, counter) {
  const doc = textarea.ownerDocument, win = doc.defaultView;
  const mirror = doc.createElement('div');
  mirror.className = 'body-measure'; mirror.setAttribute('aria-hidden', 'true');
  doc.body.append(mirror);
  const request = win.requestAnimationFrame?.bind(win) ?? (fn => win.setTimeout(fn, 0));
  const cancel = win.cancelAnimationFrame?.bind(win) ?? win.clearTimeout.bind(win);
  let frame = null;
  function updateCount() { counter.textContent = `${number.format(countCharacters(textarea.value))}文字`; }
  function reserveSpace() {
    if (!textarea.clientHeight) return;
    // Leave enough space after the last line to scroll it to the middle.
    const padding = `${Math.floor(textarea.clientHeight / 2)}px`;
    if (textarea.style.paddingBottom !== padding) textarea.style.paddingBottom = padding;
  }
  function revealPosition(position) {
    reserveSpace();
    if (!textarea.clientHeight) return;
    const style = win.getComputedStyle(textarea);
    for (const property of ['box-sizing','font-family','font-size','font-weight','font-style','font-variant','line-height','letter-spacing','word-spacing','text-indent','text-transform','text-align','direction','tab-size','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width','border-style','white-space','overflow-wrap','word-break']) {
      mirror.style.setProperty(property, style.getPropertyValue(property));
    }
    // clientWidth excludes the native scrollbar, so wrapped lines match exactly.
    const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    mirror.style.width = `${textarea.clientWidth + border}px`;
    const marker = doc.createElement('span');
    marker.textContent = textarea.value.slice(position) || '\u200b';
    mirror.replaceChildren(doc.createTextNode(textarea.value.slice(0, position)), marker);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 2;
    const top = marker.getClientRects()[0]?.top ?? marker.getBoundingClientRect().top;
    const caret = top - mirror.getBoundingClientRect().top - parseFloat(style.borderTopWidth) + line / 2;
    // Only the textarea scrolls; page position, value and selection stay intact.
    textarea.scrollTop = Math.max(0, caret - textarea.clientHeight / 2);
  }
  function followCaret() {
    frame = null;
    reserveSpace();
    if (doc.activeElement !== textarea || textarea.selectionStart !== textarea.selectionEnd) return;
    revealPosition(textarea.selectionEnd);
  }
  function revealSelection() {
    if (frame !== null) cancel(frame);
    frame = null; revealPosition(textarea.selectionStart);
  }
  function schedule() {
    if (frame !== null) cancel(frame);
    frame = request(followCaret);
  }
  function refresh() {
    if (frame !== null) cancel(frame);
    frame = null; mirror.replaceChildren();
    textarea.setSelectionRange(0, 0); textarea.scrollTop = 0;
    updateCount(); reserveSpace();
  }
  textarea.addEventListener('input', () => { updateCount(); schedule(); });
  textarea.addEventListener('compositionend', () => { updateCount(); schedule(); });
  textarea.addEventListener('focus', schedule);
  textarea.addEventListener('keydown', event => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End','PageUp','PageDown'].includes(event.key) && !event.shiftKey) schedule();
  });
  textarea.addEventListener('blur', () => { mirror.replaceChildren(); });
  win.addEventListener('resize', schedule);
  if (win.ResizeObserver) new win.ResizeObserver(schedule).observe(textarea, {box:'border-box'});
  doc.fonts?.ready.then(schedule);
  refresh();
  return {refresh,revealSelection};
}

export function findTextMatches(text, query, caseSensitive = true) {
  if (!query) return [];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const expression = new RegExp(escaped,caseSensitive ? 'gu' : 'giu');
  return Array.from(text.matchAll(expression),match=>({start:match.index,end:match.index + match[0].length}));
}

export function replaceTextMatches(text, matches, replacement, maxLength = 150000) {
  const length = text.length + matches.reduce((sum,match)=>sum + replacement.length - (match.end - match.start),0);
  if (length > maxLength) throw new Error('置換後の本文が文字数の上限を超えるため、変更していない。');
  const pieces = []; let start = 0;
  for (const match of matches) { pieces.push(text.slice(start,match.start),replacement); start = match.end; }
  pieces.push(text.slice(start)); return pieces.join('');
}

export function initBodyFindReplace(textarea, bodyEditor) {
  const doc = textarea.ownerDocument, win = doc.defaultView, $ = id => doc.getElementById('body-find-'+id);
  const panel = $('panel'), query = $('query'), replacement = $('replacement'), toggle = $('toggle'), sensitive = $('case');
  let matches = [], undo = null, applying = false, composing = false;
  function selectedIndex() { return matches.findIndex(match=>match.start === textarea.selectionStart && match.end === textarea.selectionEnd); }
  function message(text = '', error = false) { $('message').textContent = text; $('message').className = error ? 'form-error' : 'help'; }
  function updateControls() {
    const locked = textarea.disabled || textarea.readOnly, selected = selectedIndex();
    $('previous').disabled = locked || !matches.length; $('next').disabled = locked || !matches.length;
    $('replace').disabled = locked || selected < 0;
    $('all').disabled = locked || !matches.length;
    $('undo').disabled = locked || !undo || undo.after !== textarea.value;
    $('all').textContent = matches.length ? `すべて置換（${number.format(matches.length)}件）` : 'すべて置換';
    $('count').textContent = !query.value ? '検索する文字列を入力する。' : !matches.length ? '一致する箇所はない。' : selected < 0 ? `${number.format(matches.length)}件` : `${number.format(selected + 1)} / ${number.format(matches.length)}件`;
  }
  function select(index, focus = true) {
    const match = matches[index]; if (!match) return;
    if (focus) textarea.focus({preventScroll:true});
    textarea.setSelectionRange(match.start,match.end);
    bodyEditor.revealSelection(); updateControls();
  }
  function recount(choose = false) {
    matches = findTextMatches(textarea.value,query.value,sensitive.checked);
    if (choose && matches.length) {
      const index = matches.findIndex(match=>match.start >= textarea.selectionStart);
      select(index < 0 ? 0 : index,false);
    } else updateControls();
  }
  function move(direction) {
    if (textarea.disabled || !matches.length) return;
    const active = selectedIndex();
    let index;
    if (active >= 0) index = (active + direction + matches.length) % matches.length;
    else if (direction > 0) { index = matches.findIndex(match=>match.start >= textarea.selectionEnd); if (index < 0) index = 0; }
    else { index = matches.findLastIndex(match=>match.end <= textarea.selectionStart); if (index < 0) index = matches.length - 1; }
    message(); select(index);
  }
  function open() {
    if (textarea.disabled) return;
    const selection = textarea.value.slice(textarea.selectionStart,textarea.selectionEnd);
    if (panel.hidden && selection && selection.length <= query.maxLength && !/[\r\n]/.test(selection)) query.value = selection;
    panel.hidden = false; toggle.setAttribute('aria-expanded','true');
    query.focus({preventScroll:true}); query.select(); recount(true);
  }
  function close() { panel.hidden = true; toggle.setAttribute('aria-expanded','false'); textarea.focus({preventScroll:true}); }
  function write(start, end, text, expected, selectionStart, selectionEnd) {
    const old = textarea.value; let inputSeen = false;
    const onInput = () => { inputSeen = true; };
    textarea.focus({preventScroll:true}); textarea.setSelectionRange(start,end);
    applying = true; textarea.addEventListener('input',onInput);
    try {
      // Native text insertion retains browser undo where supported. The explicit
      // undo button also covers browsers that require the standard fallback.
      try { doc.execCommand?.('insertText',false,text); } catch {}
      if (textarea.value !== expected) {
        textarea.value = old; textarea.setRangeText(text,start,end,'end'); inputSeen = false;
      }
      textarea.setSelectionRange(selectionStart,selectionEnd);
      if (!inputSeen) textarea.dispatchEvent(new win.Event('input',{bubbles:true}));
    } finally { textarea.removeEventListener('input',onInput); applying = false; }
    recount(); bodyEditor.revealSelection();
  }
  function replace(all = false) {
    if (textarea.disabled || textarea.readOnly || composing) return;
    recount(); const selected = selectedIndex();
    const targets = all ? matches : selected >= 0 ? [matches[selected]] : [];
    if (!targets.length) return;
    const before = textarea.value, beforeStart = textarea.selectionStart, beforeEnd = textarea.selectionEnd;
    let after;
    try { after = replaceTextMatches(before,targets,replacement.value,textarea.maxLength >= 0 ? textarea.maxLength : 150000); }
    catch (error) { message(error.message,true); return; }
    if (after === before) { message('置換前後の本文が同じため、変更していない。'); return; }
    const start = targets[0].start, end = targets.at(-1).end;
    const inserted = after.slice(start,after.length - (before.length - end));
    const cursor = start + replacement.value.length;
    write(start,end,inserted,after,cursor,cursor);
    undo = {before,after,start:beforeStart,end:beforeEnd};
    if (!all && matches.length) {
      const next = matches.findIndex(match=>match.start >= cursor);
      select(next < 0 ? 0 : next);
    }
    message(`${number.format(targets.length)}箇所を置換した。保存するまで原本には反映されない。`); updateControls();
  }
  function undoReplace() {
    if (textarea.disabled || !undo || undo.after !== textarea.value) return;
    const previous = undo;
    write(0,textarea.value.length,previous.before,previous.before,previous.start,previous.end);
    undo = null; message('直前の置換を元に戻した。'); updateControls();
  }
  function reset() {
    panel.hidden = true; toggle.setAttribute('aria-expanded','false'); query.value = ''; replacement.value = ''; sensitive.checked = true;
    undo = null; matches = []; composing = false; message(); updateControls();
  }
  toggle.addEventListener('click',()=>panel.hidden ? open() : close());
  $('close').addEventListener('click',close);
  $('previous').addEventListener('click',()=>move(-1)); $('next').addEventListener('click',()=>move(1));
  $('replace').addEventListener('click',()=>replace()); $('all').addEventListener('click',()=>replace(true));
  $('undo').addEventListener('click',undoReplace);
  query.addEventListener('input',()=>{ message(); recount(true); });
  sensitive.addEventListener('change',()=>{ message(); recount(true); });
  textarea.addEventListener('input',()=>{
    if (!applying) { undo = null; message(); recount(); }
  });
  textarea.addEventListener('select',()=>{ if (!panel.hidden && !applying) updateControls(); });
  textarea.addEventListener('keyup',()=>{ if (!panel.hidden) updateControls(); });
  textarea.addEventListener('click',()=>{ if (!panel.hidden) updateControls(); });
  panel.addEventListener('compositionstart',()=>{ composing = true; });
  panel.addEventListener('compositionend',()=>{ composing = false; });
  for (const element of [panel,textarea]) element.addEventListener('keydown',event=>{
    if (event.isComposing || composing || event.keyCode === 229 || textarea.disabled) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); open(); }
    else if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); close(); }
    else if (event.key === 'F3' && !panel.hidden) { event.preventDefault(); move(event.shiftKey ? -1 : 1); }
    else if (event.key === 'Enter' && (event.target === query || event.target === replacement)) {
      event.preventDefault(); if (event.target === query) move(event.shiftKey ? -1 : 1); else replace();
    }
  });
  reset(); return {reset,updateControls};
}
