// ビルドの最後に Service Worker（dist/sw.js）を作る Vite プラグイン。
// 出力するファイル（ビルドしたもの＋public/ の中身）をすべて事前キャッシュの一覧に入れ、
// 中身から版を決める。中身が1バイトでも変われば sw.js も変わり、次の起動で新しい版に切り替わる。
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const SOURCE = 'src/pwa/sw.js';
const OUTPUT = 'sw.js';

/** dir 以下のファイルを、dir からの相対パス（/ 区切り）で */
function walk(dir) {
  const out = [];
  const visit = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) visit(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  visit(dir);
  return out;
}

/** @returns {import('vite').Plugin} */
export function serviceWorker() {
  let root = process.cwd();
  let publicDir = '';
  return {
    name: 'kuragebin-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(config) {
      root = config.root;
      publicDir = config.publicDir;
    },
    generateBundle(_options, bundle) {
      /** @type {Map<string, string | Uint8Array>} */
      const files = new Map();
      for (const [name, out] of Object.entries(bundle)) {
        if (name.endsWith('.map')) continue;
        files.set(name, out.type === 'chunk' ? out.code : out.source);
      }
      if (publicDir) {
        for (const name of walk(publicDir)) if (!files.has(name)) files.set(name, readFileSync(join(publicDir, name)));
      }
      if (!files.has('index.html')) this.error('index.html が出力に見つからない');

      const names = [...files.keys()].sort();
      const template = readFileSync(resolve(root, SOURCE), 'utf8');
      const hash = createHash('sha256').update(template);
      for (const name of names) hash.update('\0').update(name).update('\0').update(files.get(name));
      const version = hash.digest('hex').slice(0, 12);

      const fill = (text, key, value) => {
        const slot = `const ${key} = __${key}__;`;
        if (!text.includes(slot)) this.error(`${SOURCE} に ${slot} がない`);
        return text.replace(slot, `const ${key} = ${JSON.stringify(value)};`);
      };
      const source = fill(fill(template, 'VERSION', version), 'FILES', names.map((n) => `./${n}`));
      this.emitFile({ type: 'asset', fileName: OUTPUT, source });
    },
  };
}
