/** Pagefind search UI. */

type SearchItem = {
  title: string;
  url: string;
  excerpt: string;
  subs: Array<{ title: string; excerpt: string }>;
};

type PagefindApi = {
  init: () => Promise<void>;
  options: (opts: { highlightParam: string }) => Promise<void>;
  search: (q: string) => Promise<{
    results: Array<{ data: () => Promise<Record<string, unknown>> }>;
  }>;
};

const CACHE_PREFIX = 'pf:';

function cacheGet(key: string): { items: SearchItem[]; total: number } | null {
  try {
    return JSON.parse(sessionStorage.getItem(CACHE_PREFIX + key) ?? 'null');
  } catch {
    return null;
  }
}

function cacheSet(key: string, value: { items: SearchItem[]; total: number }) {
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

export async function initSearch() {
  const input = document.getElementById('q') as HTMLInputElement | null;
  const resultsEl = document.getElementById('results');
  const statusEl = document.getElementById('status');
  const clearBtn = document.getElementById('clear') as HTMLButtonElement | null;
  if (!input || !resultsEl || !statusEl || !clearBtn) return;

  let pagefind: PagefindApi | null = null;
  try {
    // pagefind is a build artifact at /pagefind/*, not a package
    const url = '/pagefind/pagefind.js';
    const pf = (await import(/* @vite-ignore */ url)) as PagefindApi;
    await pf.init();
    await pf.options({ highlightParam: 'pagefind-highlight' });
    pagefind = pf;
  } catch {
    statusEl.textContent = '搜索不可用，请先运行 bun run build';
    return;
  }

  function render(query: string, items: SearchItem[], total: number) {
    clearBtn!.hidden = false;
    if (!items.length) {
      resultsEl!.innerHTML = '';
      statusEl!.textContent = `没有找到「${query}」的相关结果`;
      return;
    }
    statusEl!.textContent = `找到 ${total} 个结果`;
    resultsEl!.innerHTML = items
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
      resultsEl!.innerHTML = '';
      statusEl!.textContent = '';
      clearBtn!.hidden = true;
      return;
    }
    clearBtn!.hidden = false;
    statusEl!.textContent = '搜索中…';
    const res = await pagefind.search(query);
    const items: SearchItem[] = (
      await Promise.all(res.results.slice(0, 20).map((r) => r.data()))
    ).map((r) => {
      const meta = r.meta as { title?: string } | undefined;
      const url = (r.url as string) || '#';
      const subs = ((r.sub_results as Array<{ title?: string; excerpt?: string }>) || []).map(
        (s) => ({ title: s.title || '', excerpt: s.excerpt || '' }),
      );
      return {
        title: meta?.title || url.split('/').pop() || url,
        url,
        excerpt: (r.excerpt as string) || '',
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
    timer = setTimeout(() => void search(input.value), 200);
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
