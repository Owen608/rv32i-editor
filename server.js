const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

const PORT = 3000;
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
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ toolchain: checkToolchain() }));
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
