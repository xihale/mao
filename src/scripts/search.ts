/** Pagefind search UI. */

interface SearchItem {
  title: string;
  url: string;
  excerpt: string;
  subs: { title: string; excerpt: string }[];
}

interface PagefindSubResult {
  title?: string;
  excerpt?: string;
}

interface PagefindResultData {
  url?: string;
  excerpt?: string;
  meta?: { title?: string };
  sub_results?: PagefindSubResult[];
}

interface PagefindApi {
  init: () => Promise<void>;
  options: (opts: { highlightParam: string }) => Promise<void>;
  search: (q: string) => Promise<{
    results: { data: () => Promise<PagefindResultData> }[];
  }>;
}

interface CachePayload {
  items: SearchItem[];
  total: number;
}

const CACHE_PREFIX = 'pf:';

function isCachePayload(v: unknown): v is CachePayload {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return Array.isArray(o['items']) && typeof o['total'] === 'number';
}

function cacheGet(key: string): CachePayload | null {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) ?? 'null');
    return isCachePayload(raw) ? raw : null;
  } catch {
    return null;
  }
}

function cacheSet(key: string, value: CachePayload) {
  try {
    sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota */
  }
}

function esc(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function getQuery(): string {
  return new URLSearchParams(location.search).get('q') ?? '';
}

function syncURL(q: string) {
  const u = new URL(location.href);
  if (q) u.searchParams.set('q', q);
  else u.searchParams.delete('q');
  history.replaceState(null, '', u);
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export async function initSearch() {
  const inputEl = document.getElementById('q');
  const resultsEl = document.getElementById('results');
  const statusEl = document.getElementById('status');
  const clearEl = document.getElementById('clear');
  if (
    !(inputEl instanceof HTMLInputElement) ||
    !resultsEl ||
    !statusEl ||
    !(clearEl instanceof HTMLButtonElement)
  ) {
    return;
  }
  const input = inputEl;
  const results = resultsEl;
  const status = statusEl;
  const clearBtn = clearEl;

  let pagefind: PagefindApi | null = null;
  try {
    // pagefind is a build artifact at /pagefind/*, not a package
    const url = '/pagefind/pagefind.js';
    const pf = (await import(/* @vite-ignore */ url)) as PagefindApi;
    await pf.init();
    await pf.options({ highlightParam: 'pagefind-highlight' });
    pagefind = pf;
  } catch {
    status.textContent = '搜索不可用，请先运行 bun run build';
    return;
  }

  function render(query: string, items: SearchItem[], total: number) {
    clearBtn.hidden = false;
    if (!items.length) {
      results.innerHTML = '';
      status.textContent = `没有找到「${query}」的相关结果`;
      return;
    }
    status.textContent = `找到 ${total} 个结果`;
    results.innerHTML = items
      .map((r) => {
        const extra =
          r.subs.length > 1
            ? r.subs
                .slice(1)
                .map(
                  (s) => `<div class="sub-result">
                ${s.title ? `<span class="sub-title">${esc(s.title)}</span>` : ''}
                ${s.excerpt ? `<span class="sub-excerpt">${s.excerpt}</span>` : ''}
              </div>`,
                )
                .join('')
            : '';
        return `<a href="${r.url}" class="result-card">
          <div class="result-title">${esc(r.title)}</div>
          ${r.excerpt ? `<div class="result-excerpt">${r.excerpt}</div>` : ''}
          ${extra}
        </a>`;
      })
      .join('');
  }

  async function search(query: string) {
    if (!pagefind) return;
    if (!query.trim()) {
      results.innerHTML = '';
      status.textContent = '';
      clearBtn.hidden = true;
      return;
    }
    clearBtn.hidden = false;
    status.textContent = '搜索中…';
    const res = await pagefind.search(query);
    const raw = await Promise.all(
      res.results.slice(0, 20).map(async (r) => r.data()),
    );
    const items: SearchItem[] = raw.map((r) => {
      const url = asString(r.url, '#');
      const metaTitle = r.meta?.title;
      const title =
        typeof metaTitle === 'string' && metaTitle.length > 0
          ? metaTitle
          : (url.split('/').pop() ?? url);
      const subs = (r.sub_results ?? []).map((s) => ({
        title: asString(s.title),
        excerpt: asString(s.excerpt),
      }));
      return {
        title,
        url,
        excerpt: asString(r.excerpt),
        subs,
      };
    });
    const total = res.results.length;
    cacheSet(query, { items, total });
    render(query, items, total);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    syncURL(input.value);
    clearTimeout(timer);
    timer = setTimeout(() => {
      void search(input.value);
    }, 200);
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    syncURL('');
    void search('');
    input.focus();
  });

  const initial = getQuery();
  if (initial) {
    input.value = initial;
    const cached = cacheGet(initial);
    if (cached) render(initial, cached.items, cached.total);
    else void search(initial);
  } else {
    input.focus();
  }
}
