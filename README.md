# 毛泽东选集

Astro 静态站点 + EPUB 电子书构建。

## 命令

```bash
bun run dev          # 本地开发
bun run build        # 构建站点（astro build + pagefind）
bun run build:epub   # 生成 dist/mao-selected-works.epub（约 3.2M）
bun run check        # astro check + tsc + eslint
```

## 字体子集

站点字体为霞鹜文楷（LXGW WenKai），源文件在系统字体目录
（`/usr/share/fonts/TTF/LXGWWenKai-*.ttf`）。实际使用的是按站点字符集
（全部 md 内容 + UI 文案 + 可打印 ASCII，共约 3820 字）子集化的产物：

| 文件 | 用途 | 大小 |
|---|---|---|
| `LXGWWenKai.woff2` | 网页 + epub 共用（Regular 子集） | 833K |

单一 Regular 字重：600 的标题/加粗由浏览器合成（synthetic bold）。

**内容或 UI 文案变化时需重新生成**，否则新增字符会缺字：

```bash
# 1. 收集站点字符集（md 全文 + astro/ts 源码 + public + 元数据 + ASCII）
#    （** 需要 bash globstar：shopt -s globstar）
{ cat src/content/volumes/*/*.md
  cat src/**/*.astro src/**/*.ts public/_headers 2>/dev/null
  printf '%s' '毛泽东选集目录mao.xihale.top全七卷·©'
  python3 -c "import sys; sys.stdout.write(''.join(chr(c) for c in range(0x20,0x7f)))"
} > /tmp/charset.txt

# 2. 子集化（需 pip install fonttools）
pyftsubset /usr/share/fonts/TTF/LXGWWenKai-Regular.ttf \
  --output-file=src/fonts/LXGWWenKai.woff2 \
  --flavor=woff2 --layout-features= --drop-tables+=GSUB,GPOS \
  --text-file=/tmp/charset.txt
```

参数说明：`--layout-features=` 与 `--drop-tables+=GSUB,GPOS` 移除排版
特性表（中文正文不需要连字等特性），将每个字体从全量约 19M 压到约 835K。
（LXGW 是 TrueType glyf 轮廓，无需 `--desubroutinize`——那是 CFF 专用。）

注意：`↩︎`（脚注回链符号，markdown-it-footnote 输出）在 LXGW 全量字体中
本就不存在，由浏览器/阅读器回退字体渲染，非子集化丢失。LXGW 覆盖完整
（含 Noto 缺的 `阚`），全书字符零缺失。
