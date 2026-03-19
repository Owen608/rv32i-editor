(function () {
  const REG_NAMES = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
  var BASE_CODE = 0x00000000;

  const el = {
    cSource: document.getElementById('cSource'),
    source: document.getElementById('source'),
    machineCode: document.getElementById('machineCode'),
    status: document.getElementById('status'),
    btnAssemble: document.getElementById('btnAssemble'),
    btnCompileC: document.getElementById('btnCompileC'),
    cIoMode: document.getElementById('cIoMode'),
    cIoName: document.getElementById('cIoName'),
    asmIoMode: document.getElementById('asmIoMode'),
    asmIoName: document.getElementById('asmIoName'),
    outIoMode: document.getElementById('outIoMode'),
    outIoName: document.getElementById('outIoName'),
    btnCLoadTxt: document.getElementById('btnCLoadTxt'),
    btnCSaveTxt: document.getElementById('btnCSaveTxt'),
    btnAsmLoadTxt: document.getElementById('btnAsmLoadTxt'),
    btnAsmSaveTxt: document.getElementById('btnAsmSaveTxt'),
    btnOutLoadTxt: document.getElementById('btnOutLoadTxt'),
    btnOutSaveTxt: document.getElementById('btnOutSaveTxt'),
    btnLoad: document.getElementById('btnLoad'),
    btnStep: document.getElementById('btnStep'),
    btnRun: document.getElementById('btnRun'),
    btnStop: document.getElementById('btnStop'),
    btnReset: document.getElementById('btnReset'),
    regs: document.getElementById('regs'),
    pcVal: document.getElementById('pcVal'),
    dataSizeKB: document.getElementById('dataSizeKB'),
    dataMemory: document.getElementById('dataMemory'),
    sourceGutter: document.getElementById('sourceGutter'),
    cloudSidebar: document.getElementById('cloudSidebar'),
    cloudBody: document.getElementById('cloudBody'),
    cloudFiles: document.getElementById('cloudFiles'),
    btnCloudToggle: document.getElementById('btnCloudToggle'),
    btnCloudRefresh: document.getElementById('btnCloudRefresh'),
    btnCloudNew: document.getElementById('btnCloudNew'),
    cloudModal: document.getElementById('cloudModal'),
    cloudModalName: document.getElementById('cloudModalName'),
    cloudModalText: document.getElementById('cloudModalText'),
    btnCloudModalClose: document.getElementById('btnCloudModalClose'),
    btnCloudModalSave: document.getElementById('btnCloudModalSave'),
  };

  let lastMachineCode = [];
  let lastDisasm = [];
  let lastLineToAddr = {};
  let breakpointAddrs = new Set();
  let breakpointLines = new Set();
  let simulator = null;
  let runInterval = null;

  function setStatus(msg, isErr) {
    el.status.textContent = msg;
    el.status.classList.toggle('err', !!isErr);
  }

  function downloadText(filename, text) {
    const blob = new Blob([text == null ? '' : String(text)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250);
  }

  async function saveLocalTextWithPicker(filename, text) {
    // Prefer native save dialog (File System Access API) when available.
    const anyWin = window;
    if (anyWin && typeof anyWin.showSaveFilePicker === 'function') {
      const suggestedName = filename || 'download.txt';
      const handle = await anyWin.showSaveFilePicker({
        suggestedName,
        types: [{
          description: 'Text',
          accept: { 'text/plain': ['.txt', '.c', '.h', '.s', '.asm', '.json'] }
        }]
      });
      const writable = await handle.createWritable();
      await writable.write(new Blob([text == null ? '' : String(text)], { type: 'text/plain;charset=utf-8' }));
      await writable.close();
      return { ok: true, method: 'picker' };
    }
    // Fallback: browser download (may land in Downloads).
    downloadText(filename, text);
    return { ok: true, method: 'download' };
  }

  function pickLocalTextFile(accept) {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept || '.txt,.c,.s,.asm,.h';
      input.addEventListener('change', () => {
        const f = input.files && input.files[0];
        if (!f) { reject(new Error('未选择文件')); return; }
        const reader = new FileReader();
        reader.onload = () => resolve({ name: f.name, text: String(reader.result || '') });
        reader.onerror = () => reject(new Error('读取文件失败'));
        reader.readAsText(f, 'utf-8');
      });
      input.click();
    });
  }

  async function localhostLoad(name) {
    const res = await fetch('/api/file?name=' + encodeURIComponent(name || ''));
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return String(data.text || '');
  }

  async function localhostSave(name, text) {
    const res = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || '', text: text == null ? '' : String(text) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  async function localhostListFiles() {
    const res = await fetch('/api/files');
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return Array.isArray(data.files) ? data.files : [];
  }

  async function localhostCreateFile(name, text) {
    const res = await fetch('/api/files/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || '', text: text == null ? '' : String(text) })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  async function localhostDeleteFile(name) {
    const res = await fetch('/api/files/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name || '' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  async function localhostRenameFile(from, to) {
    const res = await fetch('/api/files/rename', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: from || '', to: to || '' })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
    return data;
  }

  function formatBytes(n) {
    const x = Number(n);
    if (!isFinite(x)) return '';
    if (x < 1024) return x + ' B';
    if (x < 1024 * 1024) return (x / 1024).toFixed(1) + ' KB';
    return (x / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function guessTargetForName(name) {
    const n = String(name || '').toLowerCase();
    if (n.includes('c-') || n.endsWith('.c.txt') || n.endsWith('.c')) return 'c';
    if (n.includes('asm') || n.endsWith('.s.txt') || n.endsWith('.s') || n.endsWith('.asm.txt')) return 'asm';
    if (n.includes('machine') || n.includes('disasm') || n.includes('out')) return 'out';
    return 'asm';
  }

  let cloudEditingName = null;
  function openCloudModal(name, text) {
    cloudEditingName = name || '';
    if (el.cloudModalName) el.cloudModalName.textContent = cloudEditingName;
    if (el.cloudModalText) el.cloudModalText.value = text == null ? '' : String(text);
    if (el.cloudModal) el.cloudModal.classList.remove('hidden');
    if (el.cloudModalText) el.cloudModalText.focus();
  }
  function closeCloudModal() {
    if (el.cloudModal) el.cloudModal.classList.add('hidden');
    cloudEditingName = null;
  }

  function renderCloudFiles(files) {
    if (!el.cloudFiles) return;
    if (!files || !files.length) {
      el.cloudFiles.innerHTML = '<div class="cloud-hint">(暂无 txt)</div>';
      return;
    }
    el.cloudFiles.innerHTML = files.map((f) => {
      const name = escapeHtml(f.name || '');
      const meta = (f.size != null ? formatBytes(f.size) : '') + (f.mtimeMs ? (' · ' + new Date(f.mtimeMs).toLocaleString()) : '');
      return (
        '<div class="cloud-file" data-name="' + name + '">' +
          '<div class="cloud-file-top">' +
            '<div class="cloud-file-name" title="' + name + '">' + name + '</div>' +
          '</div>' +
          '<div class="cloud-file-actions">' +
            '<button class="btn-secondary btn-tiny cloud-edit">编辑</button>' +
            '<button class="btn-secondary btn-tiny cloud-rename">重命名</button>' +
            '<button class="btn-secondary btn-tiny cloud-delete">删除</button>' +
          '</div>' +
          (meta ? '<div class="cloud-file-meta">' + escapeHtml(meta) + '</div>' : '') +
        '</div>'
      );
    }).join('');
  }

  async function refreshCloudFiles() {
    try {
      const files = await localhostListFiles();
      renderCloudFiles(files);
      return files;
    } catch (e) {
      setStatus('刷新云端文件失败：' + (e.message || String(e)), true);
      return [];
    }
  }

  async function cloudEdit(name) {
    const text = await localhostLoad(name);
    openCloudModal(name, text);
    setStatus('已打开编辑窗口：' + name);
  }

  function buildMachineDisasmText() {
    const bytes = Array.isArray(lastMachineCode) ? lastMachineCode : [];
    const lines = Array.isArray(lastDisasm) ? lastDisasm : [];
    if (!bytes.length) return '';
    let out = '';
    for (let i = 0; i < bytes.length; i += 4) {
      const addr = (BASE_CODE + i) >>> 0;
      const word = (bytes[i] & 0xff) | ((bytes[i + 1] & 0xff) << 8) | ((bytes[i + 2] & 0xff) << 16) | ((bytes[i + 3] & 0xff) << 24);
      const hexStr = ('00000000' + (word >>> 0).toString(16)).slice(-8);
      const asm = (lines[i / 4] != null && lines[i / 4] !== '(内置汇编)') ? lines[i / 4] : disasmOne(bytes, i);
      out += formatHex4(addr) + '\t' + hexStr + '\t' + (asm || '') + '\n';
    }
    return out;
  }

  function renderOutputText(text) {
    if (!el.machineCode) return;
    const safe = escapeHtml(text || '');
    el.machineCode.innerHTML = '<pre class="machine-code-pre">' + safe + '</pre>';
  }

  function formatHex4(n) {
    const h = (n >>> 0).toString(16).toUpperCase();
    return '0x' + '0'.repeat(Math.max(0, 8 - h.length)) + h;
  }

  function disasmOne(bytes, offset) {
    if (offset + 4 > bytes.length) return '';
    const b0 = bytes[offset] & 0xff, b1 = bytes[offset + 1] & 0xff, b2 = bytes[offset + 2] & 0xff, b3 = bytes[offset + 3] & 0xff;
    const ins = b0 | (b1 << 8) | (b2 << 16) | (b3 << 24);
    const opcode = ins & 0x7f;
    const rd = (ins >> 7) & 0x1f;
    const rs1 = (ins >> 15) & 0x1f;
    const rs2 = (ins >> 20) & 0x1f;
    const funct3 = (ins >> 12) & 0x7;
    const funct7 = (ins >> 25) & 0x7f;
    const imm_i = ((ins >> 20) & 0xfff) | ((ins >> 31) ? 0xfffff000 : 0);
    const REGS = ['x0', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
    const r = (i) => REGS[i] || ('x' + i);
    if (opcode === 0x13) {
      if (funct3 === 0) return 'addi ' + r(rd) + ', ' + r(rs1) + ', ' + imm_i;
      if (funct3 === 1) return 'slli ' + r(rd) + ', ' + r(rs1) + ', ' + (imm_i & 0x1f);
      if (funct3 === 4) return 'xori ' + r(rd) + ', ' + r(rs1) + ', ' + imm_i;
      if (funct3 === 5) return (funct7 === 0x20 ? 'srai ' : 'srli ') + r(rd) + ', ' + r(rs1) + ', ' + (imm_i & 0x1f);
      if (funct3 === 6) return 'ori ' + r(rd) + ', ' + r(rs1) + ', ' + imm_i;
      if (funct3 === 7) return 'andi ' + r(rd) + ', ' + r(rs1) + ', ' + imm_i;
    }
    if (opcode === 0x37) return 'lui ' + r(rd) + ', 0x' + ((ins >>> 12) & 0xfffff).toString(16);
    if (opcode === 0x6f) { const imm_j = ((ins >> 31) ? 0xfff00000 : 0) | ((ins >> 12) & 0xff) << 12 | ((ins >> 20) & 1) << 11 | ((ins >> 21) & 0x3ff) << 1; return 'jal ' + r(rd) + ', ' + imm_j; }
    if (opcode === 0x67) return 'jalr ' + r(rd) + ', ' + r(rs1) + ', ' + imm_i;
    if (opcode === 0x63) {
      const imm_b = ((ins >> 31) ? 0xfffff000 : 0) | ((ins >> 7) & 1) << 11 | ((ins >> 25) & 0x3f) << 5 | ((ins >> 8) & 0xf) << 1;
      const br = ['beq', 'bne', '???', '???', 'blt', 'bge', 'bltu', 'bgeu'][funct3];
      return br + ' ' + r(rs1) + ', ' + r(rs2) + ', ' + imm_b;
    }
    if (opcode === 0x33) {
      if (funct7 === 0x20 && funct3 === 0) return 'sub ' + r(rd) + ', ' + r(rs1) + ', ' + r(rs2);
      if (funct3 === 0) return 'add ' + r(rd) + ', ' + r(rs1) + ', ' + r(rs2);
      if (funct3 === 7) return 'and ' + r(rd) + ', ' + r(rs1) + ', ' + r(rs2);
      if (funct3 === 6) return 'or ' + r(rd) + ', ' + r(rs1) + ', ' + r(rs2);
      if (funct3 === 4) return 'xor ' + r(rd) + ', ' + r(rs1) + ', ' + r(rs2);
    }
    if (opcode === 0x03) { const ld = ['lb', 'lh', 'lw', '???', 'lbu', 'lhu'][funct3]; return (ld || 'lw') + ' ' + r(rd) + ', ' + imm_i + '(' + r(rs1) + ')'; }
    if (opcode === 0x23) { const st = ['sb', 'sh', 'sw'][funct3]; const imm_s = (imm_i & 0xfe0) | ((ins >> 7) & 0x1f); return (st || 'sw') + ' ' + r(rs2) + ', ' + imm_s + '(' + r(rs1) + ')'; }
    if (opcode === 0x73) return (imm_i === 0 ? 'ecall' : 'ebreak');
    return '';
  }

  function renderMachineCode(machineCode, disasmLines) {
    const bytes = Array.isArray(machineCode) ? machineCode : [];
    const lines = Array.isArray(disasmLines) ? disasmLines : [];
    if (bytes.length === 0) {
      el.machineCode.innerHTML = '<div class="machine-code-empty">(无)</div>';
      return;
    }
    let html = '<table class="machine-code-table"><thead><tr><th>地址</th><th>指令</th><th>机器码</th></tr></thead><tbody>';
    for (let i = 0; i < bytes.length; i += 4) {
      const addr = BASE_CODE + i;
      const word = (bytes[i] & 0xff) | ((bytes[i + 1] & 0xff) << 8) | ((bytes[i + 2] & 0xff) << 16) | ((bytes[i + 3] & 0xff) << 24);
      const hexStr = ('00000000' + (word >>> 0).toString(16)).slice(-8);
      const asm = lines[i / 4] != null && lines[i / 4] !== '(内置汇编)' ? lines[i / 4] : disasmOne(bytes, i);
      html += '<tr data-addr="' + addr + '"><td class="mc-addr">' + formatHex4(addr) + '</td><td class="mc-asm">' + escapeHtml(asm) + '</td><td class="mc-hex">' + hexStr + '</td></tr>';
    }
    html += '</tbody></table>';
    el.machineCode.innerHTML = html;
    if (simulator) updatePCHighlight(simulator.pc);
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function updatePCHighlight(pc) {
    if (pc == null || pc === undefined) return;
    var pcNum = pc | 0;
    if (!el.machineCode && !el.sourceGutter) return;
    if (el.machineCode) {
      el.machineCode.querySelectorAll('tr[data-addr]').forEach(function (row) {
        row.classList.toggle('pc-highlight', (parseInt(row.getAttribute('data-addr'), 10) === pcNum));
      });
    }
    if (el.sourceGutter) {
      el.sourceGutter.querySelectorAll('.gutter-row[data-addr]').forEach(function (row) {
        row.classList.toggle('pc-highlight', (parseInt(row.getAttribute('data-addr'), 10) === pcNum));
      });
    }
  }

  // 简易 C → 汇编（极小子集，仅用于演示）
  function compileSimpleC() {
    if (!el.cSource) {
      setStatus('当前页面不支持 C 源代码区域', true);
      return;
    }
    const src = (el.cSource.value || '').split(/\r?\n/);
    const varToReg = {}; // 变量名 -> 寄存器号
    // 仅用 a0-a7 分配给变量；t0-t6 专作临时/数组地址，避免与 for 上界 t4 冲突
    const regNames = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'];
    let regIdx = 0;
    const asm = [];
    // 简易“数据段”分配：所有数组放在 0x80000000 之后（模拟器数据区）
    const arrays = {}; // name -> { offset(bytes), length }
    let nextDataOffset = 0; // 字节偏移
    // 控制流块（for / if）栈
    const blockStack = []; // { type: 'for'|'if', condLabel?, endLabel, incAsm?[], singleStmt?: boolean }
    let labelCounter = 0;

    function allocReg(name) {
      if (varToReg[name] != null) return varToReg[name];
      if (regIdx >= regNames.length) throw new Error('变量过多，超出简易 C 支持的寄存器数量');
      varToReg[name] = regNames[regIdx++];
      return varToReg[name];
    }

    function getReg(name) {
      if (varToReg[name] == null) throw new Error('变量未声明: ' + name);
      return varToReg[name];
    }

    function isIdent(tok) {
      return /^[a-zA-Z_]\w*$/.test(tok);
    }

    function isNumber(tok) {
      return /^-?\d+$/.test(tok);
    }

    // 生成访问数组元素地址到 t6（根据索引，可为常量或变量）
    function emitArrayAddr(arrName, idxTok) {
      const arr = arrays[arrName];
      if (!arr) throw new Error('数组未声明: ' + arrName);
      const baseAddr = (0x80000000 + arr.offset) >>> 0;
      const hi20 = (baseAddr >>> 12) & 0xfffff;
      const lo12 = baseAddr & 0xfff;
      const loSgn = lo12 >= 0x800 ? lo12 - 0x1000 : lo12;
      asm.push('  lui  t6, 0x' + hi20.toString(16));
      if (loSgn !== 0) asm.push('  addi t6, t6, ' + loSgn);
      if (idxTok == null || idxTok === '') return;
      if (isNumber(idxTok)) {
        const idx = parseInt(idxTok, 10) | 0;
        const byteOff = idx * 4;
        if (byteOff !== 0) {
          if (byteOff < -2048 || byteOff > 2047) {
            throw new Error('数组索引过大，暂不支持：' + idx);
          }
          asm.push('  addi t6, t6, ' + byteOff);
        }
      } else if (isIdent(idxTok)) {
        const idxReg = getReg(idxTok);
        asm.push('  mv   t5, ' + idxReg);
        asm.push('  slli t5, t5, 2');
        asm.push('  add  t6, t6, t5');
      } else {
        throw new Error('不支持的数组索引: ' + idxTok);
      }
    }

    asm.push('.text');
    asm.push('.globl _start');
    asm.push('_start:');

    // 之前用来支持 for/if 单语句体的收尾逻辑，当前简化为 no-op，
    // 要求 for/if 一律使用带花括号的语句块。
    function finishSingleStmtBody() {}

    let inMain = false;
    let seenMain = false;

    try {
      for (let raw of src) {
        let line = raw.replace(/\/\/.*$/, '').trim();
        if (!line) continue;
        let m;

        // 忽略预处理、属性、asm 等
        if (/^#/.test(line) || /^__attribute__/.test(line) || /^_Pragma\b/.test(line) || /^asm\s*\(/.test(line)) {
          continue;
        }

        // 寻找 main：若有多个 main 则使用最后一个（便于多示例文件只编译当前示例）
        if (!seenMain) {
          if (/^int\s+main\s*\(/.test(line)) {
            seenMain = true;
            inMain = false;
            // 支持 "int main() {" 写在同一行的情况
            if (line.indexOf('{') !== -1) {
              inMain = true;
            }
          }
          continue;
        }
        // 若再次遇到 main，当作新的 main 开始，丢弃之前未进块的状态，用这个 main
        if (!inMain && /^int\s+main\s*\(/.test(line)) {
          if (line.indexOf('{') !== -1) {
            inMain = true;
          }
          continue;
        }

        // 已见 main 但尚未进入主体，等待首个左花括号
        if (!inMain) {
          if (line === '{') {
            inMain = true;
          }
          continue;
        }
        if (line === '}') {
          const blk = blockStack.pop();
          if (blk) {
            if (blk.type === 'for') {
              // for 尾部：自增 + 跳转到条件 + 结束标签
              (blk.incAsm || []).forEach(ins => asm.push(ins));
              asm.push('  j    ' + blk.condLabel);
              asm.push(blk.endLabel + ':');
            } else if (blk.type === 'if') {
              asm.push(blk.endLabel + ':');
            }
            continue;
          } else {
            // main 自身的结束
            inMain = false;
            break;
          }
        }

        // -------------------
        // for 循环（最简单形式）：for (int i=0; i< N; i++) { ... }
        // 仅支持 i++，条件支持 < / <=，N 可为变量或整型常量
        // -------------------
        // for 循环（要求带花括号）：for (int i = 0; i < N; i++) {
        if ((m = line.match(/^for\s*\(\s*(int\s+)?([a-zA-Z_]\w*)\s*=\s*(-?\d+)\s*;\s*([a-zA-Z_]\w*)\s*([<]=?)\s*([a-zA-Z_]\w*|-?\d+)\s*;\s*([a-zA-Z_]\w*)\s*\+\+\s*\)\s*\{$/))) {
          const hasInt = !!m[1];
          const iName = m[2];
          const initVal = parseInt(m[3], 10) | 0;
          const condVar = m[4];
          const op = m[5]; // < 或 <=
          const boundTok = m[6];
          const incVar = m[7];
          if (condVar !== iName || incVar !== iName) {
            throw new Error('for 语句当前仅支持形如 for (int i = ...; i < ...; i++)');
          }
          const iReg = hasInt ? allocReg(iName) : getReg(iName);
          asm.push('  li   ' + iReg + ', ' + initVal);
          // 处理上界：i <= N（常数）改为 i < N+1 生成，避免边界只跑一次
          let boundReg;
          if (isIdent(boundTok)) {
            boundReg = getReg(boundTok);
          } else if (isNumber(boundTok)) {
            const bVal = parseInt(boundTok, 10) | 0;
            boundReg = 't4';
            const effectiveBound = op === '<=' ? bVal + 1 : bVal;
            asm.push('  li   t4, ' + effectiveBound);
          } else {
            throw new Error('for 条件上界不支持: ' + boundTok);
          }
          const id = labelCounter++;
          const condLabel = 'L_for' + id;
          const endLabel = 'L_for' + id + '_end';
          blockStack.push({
            type: 'for',
            condLabel: condLabel,
            endLabel: endLabel,
            incAsm: ['  addi ' + iReg + ', ' + iReg + ', 1'],
          });
          asm.push(condLabel + ':');
          if (op === '<') {
            asm.push('  bge  ' + iReg + ', ' + boundReg + ', ' + endLabel);
          } else {
            // i <= N（常数）：上界已是 N+1，用 bge 退出
            if (isNumber(boundTok)) {
              asm.push('  bge  ' + iReg + ', ' + boundReg + ', ' + endLabel);
            } else {
              asm.push('  blt  ' + boundReg + ', ' + iReg + ', ' + endLabel);
            }
          }
          continue;
        }
        // 不带花括号的 for 暂不支持，避免错误翻译
        if (/^for\s*\(/.test(line)) {
          throw new Error('for 语句当前仅支持带 { } 的形式');
        }

        // -------------------
        // if 语句：单一比较 或 ( cond && cond ) / ( cond || cond )，要求带 { }
        // -------------------
        function emitIfCond(lhs, op, rhsTok, endLabel) {
          const lhsReg = getReg(lhs);
          let rhsReg;
          if (isIdent(rhsTok)) {
            rhsReg = getReg(rhsTok);
          } else if (isNumber(rhsTok)) {
            const v = parseInt(rhsTok, 10) | 0;
            rhsReg = 't4';
            asm.push('  li   t4, ' + v);
          } else {
            throw new Error('if 条件右侧不支持: ' + rhsTok);
          }
          if (op === '==') {
            asm.push('  bne  ' + lhsReg + ', ' + rhsReg + ', ' + endLabel);
          } else if (op === '!=') {
            asm.push('  beq  ' + lhsReg + ', ' + rhsReg + ', ' + endLabel);
          } else if (op === '<') {
            asm.push('  bge  ' + lhsReg + ', ' + rhsReg + ', ' + endLabel);
          } else if (op === '>') {
            asm.push('  bge  ' + rhsReg + ', ' + lhsReg + ', ' + endLabel);
          } else if (op === '<=') {
            asm.push('  blt  ' + rhsReg + ', ' + lhsReg + ', ' + endLabel);
          } else { // >=
            asm.push('  blt  ' + lhsReg + ', ' + rhsReg + ', ' + endLabel);
          }
        }
        // if (a < b && b > 0) {
        if ((m = line.match(/^if\s*\(\s*([a-zA-Z_]\w*)\s*(==|!=|<|>|<=|>=)\s*([a-zA-Z_]\w*|-?\d+)\s*&&\s*([a-zA-Z_]\w*)\s*(==|!=|<|>|<=|>=)\s*([a-zA-Z_]\w*|-?\d+)\s*\)\s*\{$/))) {
          const id = labelCounter++;
          const endLabel = 'L_if' + id + '_end';
          emitIfCond(m[1], m[2], m[3], endLabel);
          emitIfCond(m[4], m[5], m[6], endLabel);
          blockStack.push({ type: 'if', endLabel: endLabel });
          continue;
        }
        // if (a > b || b > 0) {
        if ((m = line.match(/^if\s*\(\s*([a-zA-Z_]\w*)\s*(==|!=|<|>|<=|>=)\s*([a-zA-Z_]\w*|-?\d+)\s*\|\|\s*([a-zA-Z_]\w*)\s*(==|!=|<|>|<=|>=)\s*([a-zA-Z_]\w*|-?\d+)\s*\)\s*\{$/))) {
          const id = labelCounter++;
          const endLabel = 'L_if' + id + '_end';
          const bodyLabel = 'L_if' + id + '_body';
          const lhs1 = m[1], op1 = m[2], rhs1 = m[3], lhs2 = m[4], op2 = m[5], rhs2 = m[6];
          let r1, r2;
          if (isIdent(rhs1)) { r1 = getReg(rhs1); } else { asm.push('  li   t4, ' + parseInt(rhs1, 10)); r1 = 't4'; }
          if (isIdent(rhs2)) { r2 = getReg(rhs2); } else { asm.push('  li   t4, ' + parseInt(rhs2, 10)); r2 = 't4'; }
          const l1 = getReg(lhs1), l2 = getReg(lhs2);
          function branchTrue(l, op, r, target) {
            if (op === '==') asm.push('  beq  ' + l + ', ' + r + ', ' + target);
            else if (op === '!=') asm.push('  bne  ' + l + ', ' + r + ', ' + target);
            else if (op === '<') asm.push('  blt  ' + l + ', ' + r + ', ' + target);
            else if (op === '>') asm.push('  blt  ' + r + ', ' + l + ', ' + target);
            else if (op === '<=') asm.push('  bge  ' + r + ', ' + l + ', ' + target);
            else asm.push('  bge  ' + l + ', ' + r + ', ' + target);
          }
          branchTrue(l1, op1, r1, bodyLabel);
          branchTrue(l2, op2, r2, bodyLabel);
          asm.push('  j    ' + endLabel);
          asm.push(bodyLabel + ':');
          blockStack.push({ type: 'if', endLabel: endLabel });
          continue;
        }
        // if (x < y) 单一比较，支持 == != < > <= >=
        if ((m = line.match(/^if\s*\(\s*([a-zA-Z_]\w*)\s*(==|!=|<|>|<=|>=)\s*([a-zA-Z_]\w*|-?\d+)\s*\)\s*\{$/))) {
          const id = labelCounter++;
          const endLabel = 'L_if' + id + '_end';
          emitIfCond(m[1], m[2], m[3], endLabel);
          blockStack.push({ type: 'if', endLabel: endLabel });
          continue;
        }
        if (/^if\s*\(/.test(line)) {
          throw new Error('if 条件仅支持: 单一比较 或 ( cond && cond ) / ( cond || cond )，且需带 { }');
        }

        // -------------------
        // 数组声明：int a[4];
        // -------------------
        if ((m = line.match(/^int\s+([a-zA-Z_]\w*)\s*\[\s*(\d+)\s*\]\s*;/))) {
          const name = m[1];
          const len = parseInt(m[2], 10) | 0;
          if (len <= 0) throw new Error('数组长度必须为正: ' + line);
          if (arrays[name]) throw new Error('数组重复声明: ' + name);
          arrays[name] = { offset: nextDataOffset, length: len };
          nextDataOffset += len * 4;
          continue;
        }

        // 数组写：a[i] = v;  (i / v 支持变量或整数常量)
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*|\d+)\s*\]\s*=\s*([a-zA-Z_]\w*|-?\d+)\s*;/))) {
          const arrName = m[1];
          const idxTok = m[2];
          const valTok = m[3];
          emitArrayAddr(arrName, idxTok);
          if (isIdent(valTok)) {
            const vReg = getReg(valTok);
            asm.push('  sw   ' + vReg + ', 0(t6)');
          } else if (isNumber(valTok)) {
            const v = parseInt(valTok, 10) | 0;
            asm.push('  li   t0, ' + v);
            asm.push('  sw   t0, 0(t6)');
          } else {
            throw new Error('数组赋值不支持的右值: ' + valTok);
          }
          finishSingleStmtBody();
          continue;
        }

        // 数组写 + 乘加：a[i] = a[i - 1] * 常数 + x;
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*|\d+)\s*\]\s*=\s*([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*)(?:\s*-\s*(\d+))?\s*\]\s*\*\s*(\d+)\s*\+\s*([a-zA-Z_]\w*|-?\d+)\s*;/))) {
          const arrDst = m[1];
          const idxDstTok = m[2];
          const arrSrc = m[3];
          const idxBaseTok = m[4];
          const idxOffTok = m[5];
          const multVal = parseInt(m[6], 10) | 0;
          const rhsTok = m[7];
          if (arrDst !== arrSrc) throw new Error('当前仅支持 a[i] = a[?] * 常数 + x，且左右数组名相同');
          let effIdxTok = idxBaseTok;
          if (idxOffTok) {
            const off = parseInt(idxOffTok, 10) | 0;
            if (off !== 0) effIdxTok = idxBaseTok + ' - ' + idxOffTok;
          }
          if (effIdxTok.indexOf('-') !== -1) {
            const mm = effIdxTok.match(/^([a-zA-Z_]\w*)\s*-\s*(\d+)$/);
            if (!mm) throw new Error('暂不支持的数组索引表达式: ' + effIdxTok);
            const baseVar = mm[1];
            const offVal = parseInt(mm[2], 10) | 0;
            const baseReg = getReg(baseVar);
            asm.push('  mv   t5, ' + baseReg);
            asm.push('  slli t5, t5, 2');
            if (offVal !== 0) {
              asm.push('  li   t0, ' + (offVal * 4));
              asm.push('  sub  t5, t5, t0');
            }
            const arrInfo = arrays[arrSrc];
            if (!arrInfo) throw new Error('数组未声明: ' + arrSrc);
            const baseAddr = (0x80000000 + arrInfo.offset) >>> 0;
            asm.push('  li   t6, 0x' + baseAddr.toString(16));
            asm.push('  add  t6, t6, t5');
          } else {
            emitArrayAddr(arrSrc, effIdxTok);
          }
          asm.push('  lw   t0, 0(t6)');
          asm.push('  li   t1, ' + multVal);
          asm.push('  mul  t0, t0, t1');
          if (isIdent(rhsTok)) {
            asm.push('  add  t0, t0, ' + getReg(rhsTok));
          } else if (isNumber(rhsTok)) {
            const v3 = parseInt(rhsTok, 10) | 0;
            asm.push('  addi t0, t0, ' + v3);
          } else {
            throw new Error('数组乘加赋值不支持的右值: ' + rhsTok);
          }
          emitArrayAddr(arrDst, idxDstTok);
          asm.push('  sw   t0, 0(t6)');
          continue;
        }

        // 数组写 + 简单表达式：a[i] = a[i - 1] + x;  （只支持 +，右边第二个是变量或常量）
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*|\d+)\s*\]\s*=\s*([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*)(?:\s*-\s*(\d+))?\s*\]\s*\+\s*([a-zA-Z_]\w*|-?\d+)\s*;/))) {
          const arrDst = m[1];
          const idxDstTok = m[2];
          const arrSrc = m[3];
          const idxBaseTok = m[4];
          const idxOffTok = m[5]; // 可能为 undefined
          const rhsTok = m[6];
          if (arrDst !== arrSrc) throw new Error('当前仅支持 a[i] = a[?] + x 形式，且左右数组名相同');
          // 1) 读 a[ idxBaseTok - idxOffTok ] 到 t0（不用 t4，避免覆盖 for 上界）
          let effIdxTok = idxBaseTok;
          if (idxOffTok) {
            const off = parseInt(idxOffTok, 10) | 0;
            if (off !== 0) {
              effIdxTok = idxBaseTok + ' - ' + idxOffTok;
            }
          }
          // 对 emitArrayAddr 增强：支持 simpleVar 或 simpleVar - const
          // 这里手动处理：如果是 "i - 1"
          if (effIdxTok.indexOf('-') !== -1) {
            const mm = effIdxTok.match(/^([a-zA-Z_]\w*)\s*-\s*(\d+)$/);
            if (!mm) throw new Error('暂不支持的数组索引表达式: ' + effIdxTok);
            const baseVar = mm[1];
            const offVal = parseInt(mm[2], 10) | 0;
            const baseReg = getReg(baseVar);
            // (i - k)*4 = i*4 - 4*k，用 sub 避免 addi 负立即数被误解析/显示
            asm.push('  mv   t5, ' + baseReg);
            asm.push('  slli t5, t5, 2');
            if (offVal !== 0) {
              asm.push('  li   t0, ' + (offVal * 4));
              asm.push('  sub  t5, t5, t0');
            }
            const arrInfo = arrays[arrSrc];
            if (!arrInfo) throw new Error('数组未声明: ' + arrSrc);
            const baseAddr = (0x80000000 + arrInfo.offset) >>> 0;
            const baseHex = '0x' + baseAddr.toString(16);
            asm.push('  li   t6, ' + baseHex);
            asm.push('  add  t6, t6, t5');
          } else {
            emitArrayAddr(arrSrc, effIdxTok);
          }
          asm.push('  lw   t0, 0(t6)');
          // 2) 加上 rhsTok
          if (isIdent(rhsTok)) {
            const rr = getReg(rhsTok);
            asm.push('  add  t0, t0, ' + rr);
          } else if (isNumber(rhsTok)) {
            const v3 = parseInt(rhsTok, 10) | 0;
            asm.push('  addi t0, t0, ' + v3);
          } else {
            throw new Error('数组复合赋值不支持的右值: ' + rhsTok);
          }
          // 3) 写回 a[idxDstTok]
          emitArrayAddr(arrDst, idxDstTok);
          asm.push('  sw   t0, 0(t6)');
          continue;
        }

        // 数组读：x = a[i];
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*|\d+)\s*\]\s*;/))) {
          const dst = m[1];
          const arrName = m[2];
          const idxTok = m[3];
          const dstReg = allocReg(dst);
          emitArrayAddr(arrName, idxTok);
          asm.push('  lw   ' + dstReg + ', 0(t6)');
          finishSingleStmtBody();
          continue;
        }

        // 变量 += 数组元素：sum += a[i];
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*\+=\s*([a-zA-Z_]\w*)\s*\[\s*([a-zA-Z_]\w*|\d+)\s*\]\s*;/))) {
          const varName = m[1];
          const arrName = m[2];
          const idxTok = m[3];
          const varReg = getReg(varName);
          emitArrayAddr(arrName, idxTok);
          asm.push('  lw   t0, 0(t6)');
          asm.push('  add  ' + varReg + ', ' + varReg + ', t0');
          finishSingleStmtBody();
          continue;
        }

        // -------------------
        // 标量语句
        // -------------------
        // 多个声明: int i, ans = 0;
        if ((m = line.match(/^int\s+(.+);$/))) {
          const decls = m[1].split(',');
          for (let d of decls) {
            const seg = d.trim();
            if (!seg) continue;
            let dm;
            // 跳过数组形式，已在上面单独处理
            if (/^\w+\s*\[/.test(seg)) continue;
            // 带初始化: name = imm
            if ((dm = seg.match(/^([a-zA-Z_]\w*)\s*=\s*(-?\d+)$/))) {
              const name = dm[1];
              const imm = parseInt(dm[2], 10) | 0;
              const regName = allocReg(name);
              asm.push('  li   ' + regName + ', ' + imm);
              continue;
            }
            // 仅声明: name
            if ((dm = seg.match(/^([a-zA-Z_]\w*)$/))) {
              allocReg(dm[1]); // 只分配寄存器，不初始化
              continue;
            }
            throw new Error('不支持的声明形式: int ' + seg + ';');
          }
          finishSingleStmtBody();
          continue;
        }
        // 单个声明: int x = 123;
        if ((m = line.match(/^int\s+([a-zA-Z_]\w*)\s*=\s*(-?\d+)\s*;/))) {
          const name = m[1];
          const imm = parseInt(m[2], 10) | 0;
          const regName = allocReg(name);
          asm.push('  li   ' + regName + ', ' + imm);
          finishSingleStmtBody();
          continue;
        }
        // 自加: x += 2;
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*\+=\s*(-?\d+)\s*;/))) {
          const name = m[1];
          const imm = parseInt(m[2], 10) | 0;
          const regName = getReg(name);
          asm.push('  addi ' + regName + ', ' + regName + ', ' + imm);
          finishSingleStmtBody();
          continue;
        }
        // x = expr;（支持加减乘除、取余、按位与或异或、逻辑与或、取反等基础运算）
        // 自增/自减语句: x++; x--;
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*(\+\+|--)\s*;$/))) {
          const name = m[1];
          const op = m[2];
          const rName = getReg(name);
          const delta = op === '++' ? 1 : -1;
          const deltaStr = delta < 0 ? ('0x' + ((delta >>> 0) & 0xfff).toString(16)) : String(delta);
          asm.push('  addi ' + rName + ', ' + rName + ', ' + deltaStr);
          finishSingleStmtBody();
          continue;
        }
        // 1) 一元运算: x = -y; x = !y; x = ~y; x = -123;
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*=\s*([!~-])\s*([a-zA-Z_]\w*|-?\d+)\s*;/))) {
          const dst = m[1];
          const op1 = m[2];
          const srcTok = m[3];
          const dstReg = allocReg(dst);
          // 先把操作数装到 t4
          if (isIdent(srcTok)) {
            const sReg = getReg(srcTok);
            asm.push('  mv   t4, ' + sReg);
          } else if (isNumber(srcTok)) {
            const v = parseInt(srcTok, 10) | 0;
            asm.push('  li   t4, ' + v);
          } else {
            throw new Error('不支持的一元表达式: ' + line);
          }
          if (op1 === '-') {
            // 算术取反
            asm.push('  neg  ' + dstReg + ', t4');
          } else if (op1 === '!') {
            // 逻辑非: dst = (t4 == 0) ? 1 : 0
            asm.push('  seqz ' + dstReg + ', t4');
          } else if (op1 === '~') {
            // 按位取反
            asm.push('  not  ' + dstReg + ', t4');
          }
          finishSingleStmtBody();
          continue;
        }
        // 2) 二元运算: x = a OP b;  (OP 为 +,-,*,/,%,&,|,^,&&,||)
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*|-?\d+)\s*(&&|\|\||[+\-*/%&|^])\s*([a-zA-Z_]\w*|-?\d+)\s*;/))) {
          const dst = m[1];
          const lhsTok = m[2];
          const op2 = m[3];
          const rhsTok = m[4];
          const dstReg = allocReg(dst);
          // lhs -> t4
          if (isIdent(lhsTok)) {
            const lr = getReg(lhsTok);
            asm.push('  mv   t4, ' + lr);
          } else if (isNumber(lhsTok)) {
            const v = parseInt(lhsTok, 10) | 0;
            asm.push('  li   t4, ' + v);
          }
          // rhs -> t5
          if (isIdent(rhsTok)) {
            const rr = getReg(rhsTok);
            asm.push('  mv   t5, ' + rr);
          } else if (isNumber(rhsTok)) {
            const v2 = parseInt(rhsTok, 10) | 0;
            asm.push('  li   t5, ' + v2);
          }
          switch (op2) {
            case '+':
              asm.push('  add  ' + dstReg + ', t4, t5');
              break;
            case '-':
              asm.push('  sub  ' + dstReg + ', t4, t5');
              break;
            case '*':
              asm.push('  mul  ' + dstReg + ', t4, t5');
              break;
            case '/':
              asm.push('  div  ' + dstReg + ', t4, t5');
              break;
            case '%':
              asm.push('  rem  ' + dstReg + ', t4, t5');
              break;
            case '&':
              asm.push('  and  ' + dstReg + ', t4, t5');
              break;
            case '|':
              asm.push('  or   ' + dstReg + ', t4, t5');
              break;
            case '^':
              asm.push('  xor  ' + dstReg + ', t4, t5');
              break;
            case '&&':
              asm.push('  snez t4, t4');
              asm.push('  snez t5, t5');
              asm.push('  and  ' + dstReg + ', t4, t5');
              break;
            case '||':
              asm.push('  snez t4, t4');
              asm.push('  snez t5, t5');
              asm.push('  or   ' + dstReg + ', t4, t5');
              break;
            default:
              throw new Error('不支持的二元运算: ' + op2);
          }
          finishSingleStmtBody();
          continue;
        }
        // 简单赋值: x = y;
        if ((m = line.match(/^([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)\s*;/))) {
          const dst = m[1];
          const srcVar = m[2];
          const dstReg = allocReg(dst);
          const srcReg = getReg(srcVar);
          asm.push('  mv   ' + dstReg + ', ' + srcReg);
          finishSingleStmtBody();
          continue;
        }
        // return x;
        if ((m = line.match(/^return\s+([a-zA-Z_]\w*)\s*;/))) {
          const name = m[1];
          const r = getReg(name);
          if (r !== 'a0') asm.push('  mv   a0, ' + r);
          asm.push('  li   a7, 93');
          asm.push('  ecall');
          finishSingleStmtBody();
          continue;
        }
        // 其他语句当前不支持：静默忽略（例如函数调用、复杂表达式等）
        continue;
      }

      // 如果没有显式 return，则默认以 a0 为返回值退出
      const hasExit = asm.some(l => /ecall/.test(l));
      if (!hasExit) {
        asm.push('  li   a7, 93');
        asm.push('  ecall');
      }

      el.source.value = asm.join('\n');
      setStatus('C → 汇编 成功（使用简易内置 C 编译器）');
      // 自动调用内置汇编，生成机器码
      doAssembleBuiltin();
    } catch (e) {
      setStatus('C 解析/转换错误: ' + (e.message || String(e)), true);
    }
  }

  function renderGutter() {
    if (!el.sourceGutter) return;
    var lines = (el.source.value || '').split(/\n/);
    var html = '';
    for (var i = 1; i <= lines.length; i++) {
      var addr = lastLineToAddr[i];
      var isSet = (addr !== undefined && breakpointAddrs.has(addr)) || breakpointLines.has(i);
      html += '<div class="gutter-row" data-line="' + i + '"' + (addr !== undefined ? ' data-addr="' + addr + '"' : '') + '>' +
        '<span class="bp-icon' + (isSet ? ' breakpoint-set' : '') + '" data-line="' + i + '" title="点击设置/取消断点"></span>' +
        '<span class="line-num">' + i + '</span></div>';
    }
    el.sourceGutter.innerHTML = html || '<div class="gutter-row"><span class="line-num">1</span></div>';
  }

  function onGutterClick(e) {
    var icon = e.target.closest('.bp-icon[data-line]');
    if (!icon) return;
    var line = parseInt(icon.getAttribute('data-line'), 10);
    var a = lastLineToAddr[line];
    if (a !== undefined) {
      if (breakpointAddrs.has(a)) breakpointAddrs.delete(a); else breakpointAddrs.add(a);
    } else {
      if (breakpointLines.has(line)) breakpointLines.delete(line); else breakpointLines.add(line);
    }
    if (simulator && typeof simulator.setBreakpoints === 'function') simulator.setBreakpoints(Array.from(breakpointAddrs));
    renderGutter();
  }

  function doAssembleBuiltin() {
    const src = el.source.value;
    const result = window.RISCVAssembler.assemble(src);
    if (result.errors && result.errors.length) {
      setStatus('汇编错误: ' + result.errors.join('; '), true);
      return;
    }
    lastMachineCode = result.machineCode;
    lastLineToAddr = result.lineToAddr || {};
    for (var line of breakpointLines) {
      var addr = lastLineToAddr[line];
      if (addr !== undefined) breakpointAddrs.add(addr);
    }
    lastDisasm = [];
    for (let i = 0; i < result.machineCode.length; i += 4) {
      lastDisasm.push(disasmOne(result.machineCode, i));
    }
    renderMachineCode(lastMachineCode, lastDisasm);
    renderGutter();
    setStatus('内置汇编成功，共 ' + (result.machineCode.length / 4) + ' 条指令');
  }

  function doAssembleToolchain() {
    // 工具链功能已移除，保留空实现以避免旧代码调用
    setStatus('当前 Demo 已移除外部工具链，仅支持内置汇编器。', true);
  }

  function onAssemble() {
    doAssembleBuiltin();
  }

  function loadSimulator() {
    if (lastMachineCode.length === 0) {
      setStatus('请先执行「汇编」', true);
      return;
    }
    var dataKB = 64;
    if (el.dataSizeKB) {
      dataKB = parseInt(el.dataSizeKB.value, 10) || 64;
      dataKB = dataKB < 1 ? 1 : (dataKB > 1024 ? 1024 : dataKB);
    }
    if (!simulator) simulator = new window.RISCVSimulator();
    simulator.load(lastMachineCode, dataKB, Array.from(breakpointAddrs));
    simulator.setDisasm(lastDisasm);
    BASE_CODE = simulator.baseCode;
    updateRegsAndPC();
    setStatus('已加载到模拟器（指令区 0x0，数据区 ' + (simulator.baseData >>> 0).toString(16) + ' 起 ' + (simulator.dataSize / 1024) + ' KB）');
  }

  function updateRegsAndPC() {
    if (!simulator || !el.regs) return;
    var regs = [];
    for (var i = 0; i < 32; i++) regs.push(simulator.regs[i] | 0);
    el.regs.innerHTML = REG_NAMES.map(function (name, i) {
      return '<div class="reg-row" data-r="' + i + '"><span class="reg-name">' + name + '(x' + i + ')</span><span class="reg-val">' + formatHex4(regs[i]) + '</span></div>';
    }).join('');
    el.pcVal.textContent = formatHex4(simulator.pc);
    updatePCHighlight(simulator.pc);
    if (el.dataMemory && typeof simulator.getDataRegion === 'function') {
      var rows = simulator.getDataRegion(64);
      el.dataMemory.innerHTML = '<table><thead><tr><th>地址</th><th>数值 (字)</th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr><td class="mem-addr">' + formatHex4(r.addr) + '</td><td class="mem-val">' + formatHex4(r.value) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
  }

  function step() {
    if (!simulator) {
      setStatus('请先点击「加载到模拟器」', true);
      return;
    }
    var r = simulator.step();
    updateRegsAndPC();
    if (r && r.done) setStatus('执行结束 (ecall exit)');
  }

  function run() {
    if (!simulator) return;
    simulator.running = true;
    el.btnRun.disabled = true;
    el.btnStep.disabled = true;
    el.btnStop.disabled = false;
    function tick() {
      if (!simulator.running) {
        el.btnRun.disabled = false;
        el.btnStep.disabled = false;
        el.btnStop.disabled = true;
        setStatus('已停止');
        return;
      }
      if (simulator.breakpoints.has(simulator.pc)) {
        const r = simulator.step();
        updateRegsAndPC();
        if (r && r.done) {
          simulator.running = false;
          el.btnRun.disabled = false;
          el.btnStep.disabled = false;
          el.btnStop.disabled = true;
          setStatus('执行结束');
          return;
        }
        if (simulator.breakpoints.has(simulator.pc)) {
          simulator.running = false;
          el.btnRun.disabled = false;
          el.btnStep.disabled = false;
          el.btnStop.disabled = true;
          setStatus('已暂停于断点');
          updateRegsAndPC();
          return;
        }
        runInterval = setTimeout(tick, 80);
        return;
      }
      const r = simulator.step();
      updateRegsAndPC();
      if (r && r.done) {
        simulator.running = false;
        el.btnRun.disabled = false;
        el.btnStep.disabled = false;
        el.btnStop.disabled = true;
        setStatus('执行结束');
        return;
      }
      if (simulator.breakpoints.has(simulator.pc)) {
        simulator.running = false;
        el.btnRun.disabled = false;
        el.btnStep.disabled = false;
        el.btnStop.disabled = true;
        setStatus('已暂停于断点');
        updateRegsAndPC();
        return;
      }
      runInterval = setTimeout(tick, 80);
    }
    tick();
  }

  function stop() {
    if (simulator) simulator.running = false;
    if (runInterval) clearTimeout(runInterval);
    runInterval = null;
    el.btnRun.disabled = false;
    el.btnStep.disabled = false;
    el.btnStop.disabled = true;
  }

  function reset() {
    if (simulator && lastMachineCode.length) {
      var dataKB = 64;
      if (el.dataSizeKB) {
        dataKB = parseInt(el.dataSizeKB.value, 10) || 64;
        dataKB = dataKB < 1 ? 1 : (dataKB > 1024 ? 1024 : dataKB);
      }
      simulator.load(lastMachineCode, dataKB, Array.from(breakpointAddrs));
      simulator.setDisasm(lastDisasm);
      updateRegsAndPC();
      setStatus('已重置');
    }
  }

  function setupEditor(ta, options) {
    var getTabSize = options.getTabSize || function () { return 4; };
    var getBracketMatch = options.getBracketMatch || function () { return true; };
    var enterInBraces = options.enterInBraces || false;
    ta.addEventListener('keydown', function (e) {
      var tabSize = getTabSize() | 0;
      if (tabSize < 1) tabSize = 4;
      var bracketMatch = getBracketMatch();
      if (e.key === 'Tab') {
        e.preventDefault();
        var start = ta.selectionStart, end = ta.selectionEnd, val = ta.value;
        var spaces = ' '.repeat(tabSize);
        ta.value = val.slice(0, start) + spaces + val.slice(end);
        ta.selectionStart = ta.selectionEnd = start + spaces.length;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return;
      }
      if (e.key === 'Enter' && enterInBraces) {
        var val = ta.value, pos = ta.selectionStart;
        var lineStart = val.lastIndexOf('\n', pos - 1) + 1;
        var lineEnd = val.indexOf('\n', pos);
        if (lineEnd < 0) lineEnd = val.length;
        var line = val.slice(lineStart, lineEnd);
        var openIdx = line.indexOf('{');
        var closeIdx = line.indexOf('}', openIdx >= 0 ? openIdx : 0);
        if (openIdx >= 0 && closeIdx > openIdx) {
          var col = pos - lineStart;
          if (col > openIdx && col < closeIdx) {
            var between = line.slice(openIdx + 1, closeIdx);
            if (/^\s*$/.test(between)) {
              e.preventDefault();
              var baseIndent = (line.match(/^\s*/) || [''])[0];
              var bodyIndent = baseIndent + ' '.repeat(tabSize);
              var insert = '\n' + bodyIndent + '\n' + baseIndent + '}';
              var before = val.slice(0, lineStart + openIdx + 1);
              var after = val.slice(lineStart + closeIdx + 1);
              ta.value = before + insert + after;
              ta.selectionStart = ta.selectionEnd = before.length + 1 + bodyIndent.length;
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              return;
            }
          }
        }
      }
      if (bracketMatch) {
        var pair = { '(': ')', '[': ']', '{': '}' };
        var closePair = { ')': '(', ']': '[', '}': '}' };
        if (pair[e.key]) {
          e.preventDefault();
          var s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
          var ch = e.key;
          ta.value = v.slice(0, s) + ch + pair[ch] + v.slice(en);
          ta.selectionStart = ta.selectionEnd = s + 1;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        if (closePair[e.key]) {
          var s2 = ta.selectionStart, v2 = ta.value;
          if (s2 < v2.length && v2[s2] === e.key) {
            e.preventDefault();
            ta.selectionStart = ta.selectionEnd = s2 + 1;
            return;
          }
        }
      }
    });
  }
  function syncTabSizeStyle(ta, size) {
    if (ta) ta.style.tabSize = (size | 0) || 4;
  }
  if (el.cSource) {
    var cAutoComplete = document.getElementById('cAutoComplete');
    var cTabSize = document.getElementById('cTabSize');
    syncTabSizeStyle(el.cSource, (cTabSize && parseInt(cTabSize.value, 10)) || 4);
    if (cTabSize) cTabSize.addEventListener('change', function () { syncTabSizeStyle(el.cSource, parseInt(cTabSize.value, 10)); });
    setupEditor(el.cSource, {
      getTabSize: function () { return (cTabSize && parseInt(cTabSize.value, 10)) || 4; },
      getBracketMatch: function () { return !(cAutoComplete && !cAutoComplete.checked); },
      enterInBraces: true
    });
  }
  if (el.source) {
    var asmTabSize = document.getElementById('asmTabSize');
    syncTabSizeStyle(el.source, (asmTabSize && parseInt(asmTabSize.value, 10)) || 4);
    if (asmTabSize) asmTabSize.addEventListener('change', function () { syncTabSizeStyle(el.source, parseInt(asmTabSize.value, 10)); });
    setupEditor(el.source, {
      getTabSize: function () { return (asmTabSize && parseInt(asmTabSize.value, 10)) || 4; },
      getBracketMatch: function () { return true; },
      enterInBraces: false
    });
  }

  if (el.sourceGutter) {
    renderGutter();
    el.sourceGutter.addEventListener('click', onGutterClick);
  }
  el.source.addEventListener('input', function () { renderGutter(); });

  el.btnAssemble.addEventListener('click', onAssemble);
  if (el.btnCompileC) {
    el.btnCompileC.addEventListener('click', compileSimpleC);
  }

  async function handleLoadInto(target) {
    try {
      if (target === 'c') {
        const mode = (el.cIoMode && el.cIoMode.value) || 'local';
        if (mode === 'localhost') {
          const name = (el.cIoName && el.cIoName.value) || 'c-source.txt';
          el.cSource.value = await localhostLoad(name);
          setStatus('已从 localhost 加载到 C 源代码：' + name);
          return;
        }
        const f = await pickLocalTextFile('.txt,.c,.h');
        if (el.cIoName) el.cIoName.value = f.name;
        el.cSource.value = f.text;
        setStatus('已从本地加载到 C 源代码：' + f.name);
        return;
      }
      if (target === 'asm') {
        const mode = (el.asmIoMode && el.asmIoMode.value) || 'local';
        if (mode === 'localhost') {
          const name = (el.asmIoName && el.asmIoName.value) || 'asm-source.txt';
          el.source.value = await localhostLoad(name);
          renderGutter();
          setStatus('已从 localhost 加载到汇编源码：' + name);
          return;
        }
        const f = await pickLocalTextFile('.txt,.s,.asm');
        if (el.asmIoName) el.asmIoName.value = f.name;
        el.source.value = f.text;
        renderGutter();
        setStatus('已从本地加载到汇编源码：' + f.name);
        return;
      }
      if (target === 'out') {
        const mode = (el.outIoMode && el.outIoMode.value) || 'local';
        if (mode === 'localhost') {
          const name = (el.outIoName && el.outIoName.value) || 'machine-disasm.txt';
          const text = await localhostLoad(name);
          renderOutputText(text);
          setStatus('已从 localhost 加载到输出窗口：' + name);
          return;
        }
        const f = await pickLocalTextFile('.txt');
        if (el.outIoName) el.outIoName.value = f.name;
        renderOutputText(f.text);
        setStatus('已从本地加载到输出窗口：' + f.name);
        return;
      }
    } catch (e) {
      setStatus('加载失败：' + (e.message || String(e)), true);
    }
  }

  async function handleSaveFrom(target) {
    try {
      if (target === 'c') {
        const text = (el.cSource && el.cSource.value) || '';
        const name = (el.cIoName && el.cIoName.value) || 'c-source.txt';
        const mode = (el.cIoMode && el.cIoMode.value) || 'local';
        if (mode === 'localhost') {
          await localhostSave(name, text);
          setStatus('已保存到 localhost：' + name);
          return;
        }
        const r = await saveLocalTextWithPicker(name, text);
        setStatus(r.method === 'picker' ? ('已保存到本地文件：' + name) : ('已保存为下载：' + name));
        return;
      }
      if (target === 'asm') {
        const text = (el.source && el.source.value) || '';
        const name = (el.asmIoName && el.asmIoName.value) || 'asm-source.txt';
        const mode = (el.asmIoMode && el.asmIoMode.value) || 'local';
        if (mode === 'localhost') {
          await localhostSave(name, text);
          setStatus('已保存到 localhost：' + name);
          return;
        }
        const r = await saveLocalTextWithPicker(name, text);
        setStatus(r.method === 'picker' ? ('已保存到本地文件：' + name) : ('已保存为下载：' + name));
        return;
      }
      if (target === 'out') {
        const text = buildMachineDisasmText();
        const name = (el.outIoName && el.outIoName.value) || 'machine-disasm.txt';
        const mode = (el.outIoMode && el.outIoMode.value) || 'local';
        if (mode === 'localhost') {
          await localhostSave(name, text);
          setStatus('已保存到 localhost：' + name);
          return;
        }
        const r = await saveLocalTextWithPicker(name, text);
        setStatus(r.method === 'picker' ? ('已保存到本地文件：' + name) : ('已保存为下载：' + name));
        return;
      }
    } catch (e) {
      setStatus('保存失败：' + (e.message || String(e)), true);
    }
  }

  if (el.btnCLoadTxt) el.btnCLoadTxt.addEventListener('click', () => handleLoadInto('c'));
  if (el.btnCSaveTxt) el.btnCSaveTxt.addEventListener('click', () => handleSaveFrom('c'));
  if (el.btnAsmLoadTxt) el.btnAsmLoadTxt.addEventListener('click', () => handleLoadInto('asm'));
  if (el.btnAsmSaveTxt) el.btnAsmSaveTxt.addEventListener('click', () => handleSaveFrom('asm'));
  if (el.btnOutLoadTxt) el.btnOutLoadTxt.addEventListener('click', () => handleLoadInto('out'));
  if (el.btnOutSaveTxt) el.btnOutSaveTxt.addEventListener('click', () => handleSaveFrom('out'));

  if (el.btnCloudToggle && el.cloudSidebar) {
    el.btnCloudToggle.addEventListener('click', () => {
      el.cloudSidebar.classList.toggle('collapsed');
    });
  }
  if (el.btnCloudRefresh) el.btnCloudRefresh.addEventListener('click', refreshCloudFiles);
  if (el.btnCloudNew) {
    el.btnCloudNew.addEventListener('click', async () => {
      try {
        const name = prompt('新建 txt 文件名（会自动补 .txt）：', 'new-file.txt');
        if (!name) return;
        await localhostCreateFile(name, '');
        setStatus('已新建云端文件：' + name);
        await refreshCloudFiles();
      } catch (e) {
        setStatus('新建失败：' + (e.message || String(e)), true);
      }
    });
  }
  if (el.cloudFiles) {
    el.cloudFiles.addEventListener('click', async (ev) => {
      const root = ev.target.closest('.cloud-file[data-name]');
      if (!root) return;
      const name = root.getAttribute('data-name');
      try {
        if (ev.target.classList.contains('cloud-edit')) {
          await cloudEdit(name);
          return;
        }
        if (ev.target.classList.contains('cloud-delete')) {
          if (!confirm('确认删除云端文件：' + name + ' ?')) return;
          await localhostDeleteFile(name);
          setStatus('已删除云端文件：' + name);
          await refreshCloudFiles();
          return;
        }
        if (ev.target.classList.contains('cloud-rename')) {
          const to = prompt('重命名为：', name);
          if (!to || to === name) return;
          await localhostRenameFile(name, to);
          setStatus('已重命名：' + name + ' → ' + to);
          await refreshCloudFiles();
          return;
        }
      } catch (e) {
        setStatus('操作失败：' + (e.message || String(e)), true);
      }
    });
  }

  if (el.cloudModal) {
    el.cloudModal.addEventListener('click', (ev) => {
      if (ev.target && ev.target.getAttribute && ev.target.getAttribute('data-close') === '1') {
        closeCloudModal();
      }
    });
  }
  if (el.btnCloudModalClose) el.btnCloudModalClose.addEventListener('click', closeCloudModal);
  if (el.btnCloudModalSave) {
    el.btnCloudModalSave.addEventListener('click', async () => {
      try {
        if (!cloudEditingName) { setStatus('未选择要保存的文件', true); return; }
        const text = (el.cloudModalText && el.cloudModalText.value) || '';
        await localhostSave(cloudEditingName, text);
        setStatus('已保存：' + cloudEditingName);
        closeCloudModal();
        await refreshCloudFiles();
      } catch (e) {
        setStatus('保存失败：' + (e.message || String(e)), true);
      }
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && el.cloudModal && !el.cloudModal.classList.contains('hidden')) {
      closeCloudModal();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && el.cloudModal && !el.cloudModal.classList.contains('hidden')) {
      e.preventDefault();
      if (el.btnCloudModalSave) el.btnCloudModalSave.click();
    }
  });

  // 初始加载云端文件列表
  if (el.cloudFiles) refreshCloudFiles();

  el.btnLoad.addEventListener('click', loadSimulator);
  el.btnStep.addEventListener('click', step);
  el.btnRun.addEventListener('click', run);
  el.btnStop.addEventListener('click', stop);
  el.btnReset.addEventListener('click', reset);
})();
