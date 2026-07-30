/** Article page: selection share (#start-end), copy link, footnote scroll. */

const ARTICLE_SEL = 'article.content';
const isCoarse = () => matchMedia('(pointer: coarse)').matches;

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 14;
const COPY_DEBOUNCE_MS = 800;

function textOffset(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function rangeFromOffsets(root: Node, start: number, end: number): Range | null {
  const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let idx = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  let n: Text | null;
  while ((n = tw.nextNode() as Text | null)) {
    const len = n.nodeValue?.length ?? 0;
    if (!startNode && idx + len >= start) {
      startNode = n;
      startOff = start - idx;
    }
    if (idx + len >= end) {
      endNode = n;
      endOff = end - idx;
      break;
    }
    idx += len;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode, endOff);
  return range;
}

function highlight(range: Range, scroll = false) {
  CSS.highlights.set('sel-hl', new Highlight(range));
  if (scroll) {
    const r = range.getBoundingClientRect();
    window.scrollTo({
      top: Math.max(0, window.scrollY + r.top - window.innerHeight / 2 + r.height / 2),
      behavior: 'smooth',
    });
  }
  setTimeout(() => {
    CSS.highlights.delete('sel-hl');
  }, 2500);
}

function flash(el: Element, ref = false) {
  const bg = 'rgba(255, 196, 87, 0.25)';
  if (ref) {
    const glow = '0 0 0 4px rgba(255, 196, 87, 0.25)';
    el.animate(
      [
        { backgroundColor: 'transparent', color: 'var(--text3)', boxShadow: 'none' },
        { backgroundColor: bg, color: '#ffce5e', boxShadow: glow, offset: 0.1 },
        { backgroundColor: bg, color: '#ffce5e', boxShadow: glow, offset: 0.75 },
        { backgroundColor: 'transparent', color: 'var(--text3)', boxShadow: 'none' },
      ],
      { duration: 2500, easing: 'ease-out' },
    );
  } else {
    el.animate(
      [
        { backgroundColor: 'transparent' },
        { backgroundColor: bg, offset: 0.1 },
        { backgroundColor: bg, offset: 0.75 },
        { backgroundColor: 'transparent' },
      ],
      { duration: 2500, easing: 'ease-out' },
    );
  }
}

function smoothTo(el: Element, ref = false) {
  const y = el.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.2;
  window.scrollTo({ top: y, behavior: 'smooth' });
  flash(el, ref);
}

async function copyText(text: string): Promise<void> {
  // no execCommand fallback — Clipboard API only (needs secure context)
  await navigator.clipboard.writeText(text);
}

function toast(msg: string) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  void el.offsetWidth;
  el.classList.add('show');
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.remove();
    }, 300);
  }, 2000);
}

function selectedOffsets(): [number, number] | null {
  const sel = window.getSelection();
  const article = document.querySelector(ARTICLE_SEL);
  if (!sel || sel.isCollapsed || !article || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!article.contains(range.commonAncestorContainer)) return null;
  const start = textOffset(article, range.startContainer, range.startOffset);
  const end = textOffset(article, range.endContainer, range.endOffset);
  return start === end ? null : [start, end];
}

/** Touch hit-test against selection rects (with pad). Cheap — no text walk. */
function pointInSelection(x: number, y: number, pad = 10): boolean {
  const sel = window.getSelection();
  if (!sel?.rangeCount || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  const article = document.querySelector(ARTICLE_SEL);
  if (!article?.contains(range.commonAncestorContainer)) return false;
  for (const r of range.getClientRects()) {
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) {
      return true;
    }
  }
  return false;
}

function copyLink(start: number, end: number) {
  const url = `${location.origin}${location.pathname}#${start}-${end}`;
  void copyText(url)
    .then(() => {
      toast('已复制');
    })
    .catch(() => {
      toast('复制失败');
    });
}

function applyHash() {
  const m = /^#(\d+)-(\d+)$/.exec(location.hash);
  if (!m) return;
  const start = Number(m[1]);
  const end = Number(m[2]);
  if (!(end > start)) return;
  const article = document.querySelector(ARTICLE_SEL);
  if (!article) return;
  const range = rangeFromOffsets(article, start, end);
  if (range) highlight(range, true);
}

export function initArticle() {
  document.addEventListener('keydown', (e) => {
    if (e.altKey && !e.ctrlKey && !e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      const o = selectedOffsets();
      if (o) copyLink(o[0], o[1]);
    }
  });

  // Mobile: long-press existing selection to copy link
  // (timer + contextmenu both fire on Android — debounce once)
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  let pressOffsets: [number, number] | null = null;
  let pressX = 0;
  let pressY = 0;
  let lastCopyAt = 0;

  const copyOnce = (offsets: [number, number]) => {
    const now = Date.now();
    if (now - lastCopyAt < COPY_DEBOUNCE_MS) return;
    lastCopyAt = now;
    copyLink(offsets[0], offsets[1]);
  };

  const clearPress = () => {
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const fireLongPress = () => {
    const offsets = pressOffsets;
    clearPress();
    pressOffsets = null;
    if (offsets) {
      copyOnce(offsets);
      if (typeof navigator.vibrate === 'function') {
        navigator.vibrate(15);
      }
    }
  };

  document.addEventListener(
    'touchstart',
    (e) => {
      clearPress();
      pressOffsets = null;
      if (!isCoarse() || e.touches.length !== 1) return;

      const t = e.touches[0];
      if (!t) return;
      // Must already have a selection under the finger (not first-press word select)
      const offsets = selectedOffsets();
      if (!offsets || !pointInSelection(t.clientX, t.clientY)) return;

      pressOffsets = offsets;
      pressX = t.clientX;
      pressY = t.clientY;
      pressTimer = setTimeout(fireLongPress, LONG_PRESS_MS);
    },
    { passive: true },
  );

  document.addEventListener(
    'touchmove',
    (e) => {
      if (pressTimer === null || !e.touches.length) return;
      const t = e.touches[0];
      if (!t) return;
      if (
        Math.abs(t.clientX - pressX) > MOVE_CANCEL_PX ||
        Math.abs(t.clientY - pressY) > MOVE_CANCEL_PX
      ) {
        clearPress();
        pressOffsets = null;
      }
    },
    { passive: true },
  );

  document.addEventListener(
    'touchend',
    () => {
      clearPress();
      // keep pressOffsets briefly for a trailing contextmenu
      setTimeout(() => {
        pressOffsets = null;
      }, 50);
    },
    { passive: true },
  );

  document.addEventListener(
    'touchcancel',
    () => {
      clearPress();
      pressOffsets = null;
    },
    { passive: true },
  );

  document.addEventListener('contextmenu', (e) => {
    if (!isCoarse()) return;
    if (Date.now() - lastCopyAt < COPY_DEBOUNCE_MS) {
      e.preventDefault();
      return;
    }
    if (!pressOffsets) return;
    if (!pointInSelection(e.clientX, e.clientY, 24)) return;
    e.preventDefault();
    fireLongPress();
  });

  document.querySelector(ARTICLE_SEL)?.addEventListener('click', (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const ref = t.closest('a[data-footnote-ref]');
    const back = t.closest('a.data-footnote-backref');
    const a = ref ?? back;
    if (!a) return;
    e.preventDefault();
    const id = a.getAttribute('href')?.slice(1);
    const el = id ? document.getElementById(id) : null;
    if (el) smoothTo(el, !!back);
  });

  if (/^#\d+-\d+$/.test(location.hash)) {
    void document.fonts.ready.then(() => {
      window.scrollTo(0, 0);
      requestAnimationFrame(applyHash);
    });
  }
  window.addEventListener('hashchange', applyHash);

  // pagefind highlight param from search results
  if (new URLSearchParams(location.search).getAll('pagefind-highlight').length) {
    const url = '/pagefind/pagefind-highlight.js';
    void import(/* @vite-ignore */ url)
      .then((m: { default: new (opts: { addStyles: boolean; highlightParam: string }) => void }) => {
        new m.default({ addStyles: false, highlightParam: 'pagefind-highlight' });
        document
          .querySelector('mark.pagefind-highlight')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      })
      .catch(() => {
        /* pagefind not built in dev */
      });
  }
}
