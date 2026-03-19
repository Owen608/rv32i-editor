const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const PORT = 3000;
const STORAGE_DIR = path.join(__dirname, 'storage');
function ensureStorageDir() {
  try { fs.mkdirSync(STORAGE_DIR, { recursive: true }); } catch (_) {}
}
function sanitizeFileName(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const base = path.basename(raw).replace(/[/\\]/g, '');
  const safe = base.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  if (!safe) return null;
  if (!/\.txt$/i.test(safe)) return safe + '.txt';
  return safe;
}
function readJsonBody(req, cb) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    try {
      cb(null, body ? JSON.parse(body) : {});
    } catch (e) {
      cb(e);
    }
  });
}
function json(res, status, obj) {
  res.statusCode = status || 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}
function listTxtFiles() {
  ensureStorageDir();
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(STORAGE_DIR, { withFileTypes: true }); } catch (_) { entries = []; }
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const n = ent.name || '';
    if (!/\.txt$/i.test(n)) continue;
    try {
      const st = fs.statSync(path.join(STORAGE_DIR, n));
      out.push({ name: n, size: st.size, mtimeMs: st.mtimeMs });
    } catch (_) {
      out.push({ name: n });
    }
  }
  out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return out;
}
function ensureDefaultFiles() {
  ensureStorageDir();
  const defaults = [
    { name: 'c-source.txt', text: '' },
    { name: 'asm-source.txt', text: '' },
    { name: 'machine-disasm.txt', text: '' },
  ];
  for (const d of defaults) {
    const n = sanitizeFileName(d.name);
    if (!n) continue;
    const p = path.join(STORAGE_DIR, n);
    if (!fs.existsSync(p)) {
      try { fs.writeFileSync(p, d.text, 'utf8'); } catch (_) {}
    }
  }
}
const MIME = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res, filePath) {
  const ext = path.extname(filePath);
  res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(filePath).pipe(res);
}

function compileWithToolchain(source) {
  const tmpDir = os.tmpdir();
  const base = path.join(tmpDir, 'riscv_' + Date.now());
  const sPath = base + '.s';
  const oPath = base + '.o';
  fs.writeFileSync(sPath, source, 'utf8');
  try {
    execSync(`riscv-none-elf-as -march=rv32im -mabi=ilp32 -o "${oPath}" "${sPath}"`, {
      timeout: 5000,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const disasm = execSync(`riscv-none-elf-objdump -d "${oPath}"`, {
      encoding: 'utf8',
      timeout: 3000,
    });
    const textMatch = disasm.match(/<\.text>:\s*([\s\S]*?)(?=\n\n\s*\d+ \s*<|\n\n$)/);
    const disasmText = textMatch ? textMatch[1].trim() : disasm;
    const code = [];
    const lineRe = /^\s*\d+:\s+([0-9a-f]{8})\s+/gm;
    let m;
    while ((m = lineRe.exec(disasm)) !== null) {
      const hex = m[1];
      for (let i = 0; i < 4; i++) code.push(parseInt(hex.substr(6 - i * 2, 2), 16));
    }
    try { fs.unlinkSync(sPath); } catch (_) {}
    try { fs.unlinkSync(oPath); } catch (_) {}
    return { ok: true, machineCode: code, disasm: disasmText, asmExpanded: disasmText };
  } catch (e) {
    try { fs.unlinkSync(sPath); } catch (_) {}
    try { fs.unlinkSync(oPath); } catch (_) {}
    return { ok: false, errors: (e.stderr || e.message || String(e)).toString() };
  }
}

function checkToolchain() {
  try {
    execSync('riscv-none-elf-as -v', { stdio: 'pipe', timeout: 2000 });
    return true;
  } catch (_) {
    return false;
  }
}

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(__dirname, path.normalize(url).replace(/^(\.\.(\/|\\|$))+/, ''));

  if (req.method === 'GET' && url === '/api/health') {
    json(res, 200, { toolchain: checkToolchain() });
    return;
  }

  if (req.method === 'GET' && url === '/api/files') {
    ensureDefaultFiles();
    json(res, 200, { ok: true, files: listTxtFiles() });
    return;
  }

  if (req.method === 'POST' && url === '/api/files/create') {
    readJsonBody(req, (err, data) => {
      if (err) return json(res, 400, { ok: false, error: 'JSON 解析失败' });
      const name = sanitizeFileName(data && data.name);
      if (!name) return json(res, 400, { ok: false, error: '缺少 name' });
      const text = (data && data.text != null) ? String(data.text) : '';
      ensureStorageDir();
      const p = path.join(STORAGE_DIR, name);
      if (fs.existsSync(p)) return json(res, 409, { ok: false, error: '文件已存在: ' + name });
      try {
        fs.writeFileSync(p, text, 'utf8');
        json(res, 200, { ok: true, name });
      } catch (_) {
        json(res, 500, { ok: false, error: '创建失败' });
      }
    });
    return;
  }

  if (req.method === 'POST' && url === '/api/files/delete') {
    readJsonBody(req, (err, data) => {
      if (err) return json(res, 400, { ok: false, error: 'JSON 解析失败' });
      const name = sanitizeFileName(data && data.name);
      if (!name) return json(res, 400, { ok: false, error: '缺少 name' });
      ensureStorageDir();
      const p = path.join(STORAGE_DIR, name);
      try {
        fs.unlinkSync(p);
        json(res, 200, { ok: true, name });
      } catch (_) {
        json(res, 404, { ok: false, error: '文件不存在: ' + name });
      }
    });
    return;
  }

  if (req.method === 'POST' && url === '/api/files/rename') {
    readJsonBody(req, (err, data) => {
      if (err) return json(res, 400, { ok: false, error: 'JSON 解析失败' });
      const from = sanitizeFileName(data && data.from);
      const to = sanitizeFileName(data && data.to);
      if (!from || !to) return json(res, 400, { ok: false, error: '缺少 from/to' });
      ensureStorageDir();
      const pFrom = path.join(STORAGE_DIR, from);
      const pTo = path.join(STORAGE_DIR, to);
      if (!fs.existsSync(pFrom)) return json(res, 404, { ok: false, error: '文件不存在: ' + from });
      if (fs.existsSync(pTo)) return json(res, 409, { ok: false, error: '目标已存在: ' + to });
      try {
        fs.renameSync(pFrom, pTo);
        json(res, 200, { ok: true, from, to });
      } catch (_) {
        json(res, 500, { ok: false, error: '重命名失败' });
      }
    });
    return;
  }

  // 简易文本文件存取（用于在浏览器与 localhost 间加载/保存）
  if (req.method === 'GET' && url.startsWith('/api/file')) {
    const u = new URL(req.url, 'http://localhost');
    const name = sanitizeFileName(u.searchParams.get('name'));
    if (!name) {
      json(res, 400, { ok: false, error: '缺少 name' });
      return;
    }
    ensureStorageDir();
    const p = path.join(STORAGE_DIR, name);
    try {
      const text = fs.readFileSync(p, 'utf8');
      json(res, 200, { ok: true, name, text });
    } catch (e) {
      json(res, 404, { ok: false, error: '文件不存在: ' + name });
    }
    return;
  }

  if (req.method === 'POST' && url === '/api/file') {
    readJsonBody(req, (err, data) => {
      if (err) {
        json(res, 400, { ok: false, error: 'JSON 解析失败' });
        return;
      }
      const name = sanitizeFileName(data && data.name);
      if (!name) {
        json(res, 400, { ok: false, error: '缺少 name' });
        return;
      }
      const text = (data && data.text != null) ? String(data.text) : '';
      ensureStorageDir();
      const p = path.join(STORAGE_DIR, name);
      try {
        fs.writeFileSync(p, text, 'utf8');
        json(res, 200, { ok: true, name });
      } catch (e) {
        json(res, 500, { ok: false, error: '写入失败' });
      }
    });
    return;
  }

  if (req.method === 'POST' && url === '/api/compile') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        const { type = 'asm', source } = JSON.parse(body);
        if (!source) {
          res.end(JSON.stringify({ ok: false, errors: '缺少 source' }));
          return;
        }
        if (type === 'c') {
          res.end(JSON.stringify({ ok: false, errors: 'C 编译请先安装 RISC-V 工具链，当前 demo 仅支持汇编' }));
          return;
        }
        if (!checkToolchain()) {
          res.end(JSON.stringify({
            ok: false,
            errors: '未检测到 RISC-V 工具链 (riscv-none-elf-as)。请使用页面内「内置汇编器」或安装 xPack riscv-none-elf-gcc 并加入 PATH。',
          }));
          return;
        }
        const result = compileWithToolchain(source);
        res.end(JSON.stringify(result));
      } catch (e) {
        res.end(JSON.stringify({ ok: false, errors: String(e.message) }));
      }
    });
    return;
  }

  if (req.method === 'GET' && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    serveStatic(req, res, filePath);
    return;
  }

  res.statusCode = 404;
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`RV32I 编辑器 Demo: http://localhost:${PORT}`);
  console.log('未安装工具链时，请使用页面内「内置汇编器」即可运行。');
});
