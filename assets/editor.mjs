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
  function followCaret() {
    frame = null;
    reserveSpace();
    if (doc.activeElement !== textarea || !textarea.clientHeight || textarea.selectionStart !== textarea.selectionEnd) return;
    const style = win.getComputedStyle(textarea);
    for (const property of ['box-sizing','font-family','font-size','font-weight','font-style','font-variant','line-height','letter-spacing','word-spacing','text-indent','text-transform','text-align','direction','tab-size','padding-top','padding-right','padding-bottom','padding-left','border-top-width','border-right-width','border-bottom-width','border-left-width','border-style','white-space','overflow-wrap','word-break']) {
      mirror.style.setProperty(property, style.getPropertyValue(property));
    }
    // clientWidth excludes the native scrollbar, so wrapped lines match exactly.
    const border = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    mirror.style.width = `${textarea.clientWidth + border}px`;
    const marker = doc.createElement('span');
    marker.textContent = textarea.value.slice(textarea.selectionEnd) || '\u200b';
    mirror.replaceChildren(doc.createTextNode(textarea.value.slice(0, textarea.selectionEnd)), marker);
    const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 2;
    const top = marker.getClientRects()[0]?.top ?? marker.getBoundingClientRect().top;
    const caret = top - mirror.getBoundingClientRect().top - parseFloat(style.borderTopWidth) + line / 2;
    // Only the textarea scrolls; page position, value and selection stay intact.
    textarea.scrollTop = Math.max(0, caret - textarea.clientHeight / 2);
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
  return {refresh};
}
