import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const contentDir = './src/content/volumes';
const outPath = './public/search-index.json';

const items = [];

for (const volDir of fs.readdirSync(contentDir)) {
  const volPath = path.join(contentDir, volDir);
  if (!fs.statSync(volPath).isDirectory()) continue;
  
  for (const file of fs.readdirSync(volPath)) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(volPath, file);
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    
    items.push({
      id: `${volDir}/${file.replace('.md', '')}`,
      title: data.title || file.replace('.md', ''),
      volume: data.volume || 0,
      body: content.slice(0, 2000)
    });
  }
}

fs.mkdirSync('./public', { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(items));
console.log(`Search index: ${items.length} articles → ${outPath}`);
