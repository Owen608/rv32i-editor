/**
 * 最小 RV32I + 部分 M 扩展 + 伪指令 的内置汇编器（仅用于 demo，无工具链时使用）
 */
(function (global) {
  const regNames = ['zero', 'ra', 'sp', 'gp', 'tp', 't0', 't1', 't2', 's0', 's1', 'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10', 's11', 't3', 't4', 't5', 't6'];
  const regMap = {};
  regNames.forEach((r, i) => { regMap[r] = i; });
  regMap.x0 = 0; regMap.x1 = 1; regMap.x2 = 2; regMap.x3 = 3; regMap.x4 = 4; regMap.x5 = 5;
  regMap.x6 = 6; regMap.x7 = 7; regMap.x8 = 8; regMap.x9 = 9; regMap.x10 = 10; regMap.x11 = 11;
  regMap.x12 = 12; regMap.x13 = 13; regMap.x14 = 14; regMap.x15 = 15; regMap.x16 = 16; regMap.x17 = 17;
  regMap.x18 = 18; regMap.x19 = 19; regMap.x20 = 20; regMap.x21 = 21; regMap.x22 = 22; regMap.x23 = 23;
  regMap.x24 = 24; regMap.x25 = 25; regMap.x26 = 26; regMap.x27 = 27; regMap.x28 = 28; regMap.x29 = 29;
  regMap.x30 = 30; regMap.x31 = 31;

  function parseImm(s) {
    s = (s || '').trim();
    if (!s) return null;
    if (/^-?0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16) | 0;
    if (/^-?\d+$/.test(s)) return parseInt(s, 10) | 0;
    return null;
  }

  function reg(s) {
    const r = (s || '').trim().toLowerCase();
    if (regMap[r] !== undefined) return regMap[r];
    const m = r.match(/^x(\d+)$/);
    if (m) { const n = parseInt(m[1], 10); if (n >= 0 && n <= 31) return n; }
    return -1;
  }

  function parseOffsetBase(s) {
    const t = (s || '').trim();
    const m = t.match(/^\s*(-?[0-9a-fA-FxX]+)\s*\(\s*([a-zA-Z0-9_]+)\s*\)\s*$/);
    if (!m) return null;
    const imm = parseImm(m[1].trim());
    const rs1 = reg(m[2].trim());
    return imm !== null && rs1 >= 0 ? { imm: imm, rs1: rs1 } : null;
  }

  function encodeR(opcode, rd, rs1, rs2, funct3, funct7) {
    const i = (funct7 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode;
    return [(i >> 0) & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff, (i >> 24) & 0xff];
  }
  function encodeI(opcode, rd, rs1, imm, funct3) {
    const i = ((imm << 20) >> 20) & 0xfff;
    const ins = (i << 20) | (rs1 << 15) | (funct3 << 12) | (rd << 7) | opcode;
    return [(ins >> 0) & 0xff, (ins >> 8) & 0xff, (ins >> 16) & 0xff, (ins >> 24) & 0xff];
  }
  function encodeS(opcode, rs1, rs2, imm, funct3) {
    const imm11_5 = (imm >> 5) & 0x7f, imm4_0 = imm & 0x1f;
    const ins = (imm11_5 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (imm4_0 << 7) | opcode;
    return [(ins >> 0) & 0xff, (ins >> 8) & 0xff, (ins >> 16) & 0xff, (ins >> 24) & 0xff];
  }
  function encodeB(opcode, rs1, rs2, imm, funct3) {
    const imm13 = ((imm << 19) >> 19) & 0x1fff;
    const b12 = (imm13 >> 12) & 1, b11 = (imm13 >> 11) & 1, b10_5 = (imm13 >> 5) & 0x3f, b4_1 = (imm13 >> 1) & 0xf;
    const ins = (b12 << 31) | (b10_5 << 25) | (rs2 << 20) | (rs1 << 15) | (funct3 << 12) | (b4_1 << 8) | (b11 << 7) | opcode;
    return [(ins >> 0) & 0xff, (ins >> 8) & 0xff, (ins >> 16) & 0xff, (ins >> 24) & 0xff];
  }
  function encodeU(opcode, rd, imm) {
    const u = imm & 0xfffff000;
    const ins = u | (rd << 7) | opcode;
    return [(ins >> 0) & 0xff, (ins >> 8) & 0xff, (ins >> 16) & 0xff, (ins >> 24) & 0xff];
  }
  function encodeJ(opcode, rd, imm) {
    const j20 = (imm >> 20) & 1, j19_12 = (imm >> 12) & 0xff, j11 = (imm >> 11) & 1, j10_1 = (imm >> 1) & 0x3ff;
    const ins = (j20 << 31) | (j19_12 << 12) | (j11 << 20) | (j10_1 << 21) | (rd << 7) | opcode;
    return [(ins >> 0) & 0xff, (ins >> 8) & 0xff, (ins >> 16) & 0xff, (ins >> 24) & 0xff];
  }

  function assemble(source) {
    const lines = source.split(/\r?\n/);
    const labels = {};
    const output = [];
    const errors = [];
    const lineToAddr = {};
    let pc = 0;

    const insList = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const commentIdx = line.indexOf(';');
      const code = (commentIdx >= 0 ? line.slice(0, commentIdx) : line).trim();
      if (!code) continue;
      const labelMatch = code.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/);
      if (labelMatch) {
        labels[labelMatch[1]] = pc;
        const rest = code.slice(labelMatch[0].length).trim();
        if (!rest) continue;
      }
      const rawParts = code.replace(/^[^:]+:\s*/, '').split(/\s+/).filter(Boolean);
      if (rawParts.length === 0) continue;
      const m = rawParts[0].toLowerCase();
      if (m.startsWith('.')) continue;
      const parts = rawParts.slice(1).map(function (s) { return s.replace(/,/g, '').trim(); }).filter(Boolean);
      let size = 4;
      if (m === 'li' && parts[1]) {
        const v = parseImm(parts[1]);
        const v32 = v !== null ? v >>> 0 : 0;
        if (v !== null && (v < -2048 || v > 2047) && (v32 & 0xfff) !== 0) size = 8;
      }
      insList.push({ pc, mnemonic: m, args: parts, lineNum: i + 1 });
      pc += size;
    }

    let addr = 0;
    for (const ins of insList) {
      const { mnemonic, args, lineNum } = ins;
      if (mnemonic.startsWith('.')) continue;
      lineToAddr[lineNum] = addr;
      try {
        const rd = args[0] !== undefined ? reg(args[0]) : -1;
        const rs1 = args[1] !== undefined ? reg(args[1]) : -1;
        const rs2 = args[2] !== undefined ? reg(args[2]) : -1;
        const imm = parseImm(args[args.length - 1] || '');
        const resolveLabel = (name) => labels[name] !== undefined ? labels[name] - addr : null;

        let bytes = null;
        switch (mnemonic) {
          case 'nop':
            bytes = encodeI(0x13, 0, 0, 0, 0);
            break;
          case 'add': bytes = encodeR(0x33, rd, rs1, rs2, 0, 0); break;
          case 'sub': bytes = encodeR(0x33, rd, rs1, rs2, 0, 0x20); break;
          case 'mul': bytes = encodeR(0x33, rd, rs1, rs2, 0, 0x01); break;
          case 'div': bytes = encodeR(0x33, rd, rs1, rs2, 4, 0x01); break;
          case 'rem': bytes = encodeR(0x33, rd, rs1, rs2, 6, 0x01); break;
          case 'and': bytes = encodeR(0x33, rd, rs1, rs2, 7, 0); break;
          case 'or': bytes = encodeR(0x33, rd, rs1, rs2, 6, 0); break;
          case 'xor': bytes = encodeR(0x33, rd, rs1, rs2, 4, 0); break;
          case 'sll': bytes = encodeR(0x33, rd, rs1, rs2, 1, 0); break;
          case 'slt': bytes = encodeR(0x33, rd, rs1, rs2, 2, 0); break;
          case 'sltu': bytes = encodeR(0x33, rd, rs1, rs2, 3, 0); break;
          case 'srl': bytes = encodeR(0x33, rd, rs1, rs2, 5, 0); break;
          case 'sra': bytes = encodeR(0x33, rd, rs1, rs2, 5, 0x20); break;
          case 'addi': bytes = encodeI(0x13, rd, rs1, imm !== null ? imm : 0, 0); break;
          case 'andi': bytes = encodeI(0x13, rd, rs1, imm !== null ? imm : 0, 7); break;
          case 'ori': bytes = encodeI(0x13, rd, rs1, imm !== null ? imm : 0, 6); break;
          case 'xori': bytes = encodeI(0x13, rd, rs1, imm !== null ? imm : 0, 4); break;
          case 'slli': bytes = encodeI(0x13, rd, rs1, (imm !== null ? imm : 0) & 0x1f, 1); break;
          case 'slti': bytes = encodeI(0x13, rd, rs1, imm !== null ? imm : 0, 2); break;
          case 'sltiu': bytes = encodeI(0x13, rd, rs1, imm !== null ? imm : 0, 3); break;
          case 'srli': bytes = encodeI(0x13, rd, rs1, (imm !== null ? imm : 0) & 0x1f, 5); break;
          case 'srai': bytes = encodeI(0x13, rd, rs1, 0x20 | ((imm !== null ? imm : 0) & 0x1f), 5); break;
          case 'lui': bytes = encodeU(0x37, rd, ((imm !== null ? imm : 0) & 0xfffff) << 12); break;
          case 'auipc': bytes = encodeU(0x17, rd, ((imm !== null ? imm : 0) & 0xfffff) << 12); break;
          case 'jal': {
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeJ(0x6f, rd, off !== null ? off : 0);
            break;
          }
          case 'jalr': bytes = encodeI(0x67, rd, rs1, imm !== null ? imm : 0, 0); break;
          case 'beq': {
            const b_rs1 = args[0] !== undefined ? reg(args[0]) : 0;
            const b_rs2 = args[1] !== undefined ? reg(args[1]) : 0;
            const off = args[2] !== undefined ? (parseImm(args[2]) !== null ? parseImm(args[2]) : resolveLabel(args[2])) : 0;
            bytes = encodeB(0x63, b_rs1, b_rs2, off !== null ? off : 0, 0);
            break;
          }
          case 'bne': {
            const b_rs1 = args[0] !== undefined ? reg(args[0]) : 0;
            const b_rs2 = args[1] !== undefined ? reg(args[1]) : 0;
            const off = args[2] !== undefined ? (parseImm(args[2]) !== null ? parseImm(args[2]) : resolveLabel(args[2])) : 0;
            bytes = encodeB(0x63, b_rs1, b_rs2, off !== null ? off : 0, 1);
            break;
          }
          case 'blt': {
            const b_rs1 = args[0] !== undefined ? reg(args[0]) : 0;
            const b_rs2 = args[1] !== undefined ? reg(args[1]) : 0;
            const off = args[2] !== undefined ? (parseImm(args[2]) !== null ? parseImm(args[2]) : resolveLabel(args[2])) : 0;
            bytes = encodeB(0x63, b_rs1, b_rs2, off !== null ? off : 0, 4);
            break;
          }
          case 'bge': {
            const b_rs1 = args[0] !== undefined ? reg(args[0]) : 0;
            const b_rs2 = args[1] !== undefined ? reg(args[1]) : 0;
            const off = args[2] !== undefined ? (parseImm(args[2]) !== null ? parseImm(args[2]) : resolveLabel(args[2])) : 0;
            bytes = encodeB(0x63, b_rs1, b_rs2, off !== null ? off : 0, 5);
            break;
          }
          case 'bltu': {
            const b_rs1 = args[0] !== undefined ? reg(args[0]) : 0;
            const b_rs2 = args[1] !== undefined ? reg(args[1]) : 0;
            const off = args[2] !== undefined ? (parseImm(args[2]) !== null ? parseImm(args[2]) : resolveLabel(args[2])) : 0;
            bytes = encodeB(0x63, b_rs1, b_rs2, off !== null ? off : 0, 6);
            break;
          }
          case 'bgeu': {
            const b_rs1 = args[0] !== undefined ? reg(args[0]) : 0;
            const b_rs2 = args[1] !== undefined ? reg(args[1]) : 0;
            const off = args[2] !== undefined ? (parseImm(args[2]) !== null ? parseImm(args[2]) : resolveLabel(args[2])) : 0;
            bytes = encodeB(0x63, b_rs1, b_rs2, off !== null ? off : 0, 7);
            break;
          }
          case 'lw': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeI(0x03, rd, ob.rs1, ob.imm, 2);
            break;
          }
          case 'lh': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeI(0x03, rd, ob.rs1, ob.imm, 1);
            break;
          }
          case 'lb': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeI(0x03, rd, ob.rs1, ob.imm, 0);
            break;
          }
          case 'lbu': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeI(0x03, rd, ob.rs1, ob.imm, 4);
            break;
          }
          case 'lhu': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeI(0x03, rd, ob.rs1, ob.imm, 5);
            break;
          }
          case 'sw': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeS(0x23, ob.rs1, reg(args[0]), ob.imm, 2);
            break;
          }
          case 'sh': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeS(0x23, ob.rs1, reg(args[0]), ob.imm, 1);
            break;
          }
          case 'sb': {
            const ob = parseOffsetBase(args[1]);
            if (ob) bytes = encodeS(0x23, ob.rs1, reg(args[0]), ob.imm, 0);
            break;
          }
          // ============================
          // RV32I 常用伪指令展开（仅展开到本实现支持的基指令）
          // ============================
          case 'j': { // j label -> jal x0, label
            const off = args[0] !== undefined ? (parseImm(args[0]) !== null ? parseImm(args[0]) : resolveLabel(args[0])) : 0;
            bytes = encodeJ(0x6f, 0, off !== null ? off : 0);
            break;
          }
          case 'jr': { // jr rs -> jalr x0, 0(rs)
            const r1 = args[0] !== undefined ? reg(args[0]) : -1;
            bytes = encodeI(0x67, 0, r1, 0, 0);
            break;
          }
          case 'beqz': { // beqz rs, label -> beq rs, x0, label
            const r1 = args[0] !== undefined ? reg(args[0]) : 0;
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeB(0x63, r1, 0, off !== null ? off : 0, 0);
            break;
          }
          case 'bnez': { // bnez rs, label -> bne rs, x0, label
            const r1 = args[0] !== undefined ? reg(args[0]) : 0;
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeB(0x63, r1, 0, off !== null ? off : 0, 1);
            break;
          }
          case 'bgez': { // bgez rs, label -> bge rs, x0, label
            const r1 = args[0] !== undefined ? reg(args[0]) : 0;
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeB(0x63, r1, 0, off !== null ? off : 0, 5);
            break;
          }
          case 'bltz': { // bltz rs, label -> blt rs, x0, label
            const r1 = args[0] !== undefined ? reg(args[0]) : 0;
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeB(0x63, r1, 0, off !== null ? off : 0, 4);
            break;
          }
          case 'blez': { // blez rs, label -> bge x0, rs, label   (0 >= rs)
            const r1 = args[0] !== undefined ? reg(args[0]) : 0;
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeB(0x63, 0, r1, off !== null ? off : 0, 5);
            break;
          }
          case 'bgtz': { // bgtz rs, label -> blt x0, rs, label   (0 < rs)
            const r1 = args[0] !== undefined ? reg(args[0]) : 0;
            const off = args[1] !== undefined ? (parseImm(args[1]) !== null ? parseImm(args[1]) : resolveLabel(args[1])) : 0;
            bytes = encodeB(0x63, 0, r1, off !== null ? off : 0, 4);
            break;
          }
          case 'neg': { // neg rd, rs -> sub rd, x0, rs
            const d = args[0] !== undefined ? reg(args[0]) : -1;
            const s = args[1] !== undefined ? reg(args[1]) : -1;
            bytes = encodeR(0x33, d, 0, s, 0, 0x20);
            break;
          }
          case 'not': { // not rd, rs -> xori rd, rs, -1
            const d = args[0] !== undefined ? reg(args[0]) : -1;
            const s = args[1] !== undefined ? reg(args[1]) : -1;
            bytes = encodeI(0x13, d, s, -1, 4);
            break;
          }
          case 'seqz': { // seqz rd, rs -> sltiu rd, rs, 1
            const d = args[0] !== undefined ? reg(args[0]) : -1;
            const s = args[1] !== undefined ? reg(args[1]) : -1;
            bytes = encodeI(0x13, d, s, 1, 3);
            break;
          }
          case 'snez': { // snez rd, rs -> sltu rd, x0, rs
            const d = args[0] !== undefined ? reg(args[0]) : -1;
            const s = args[1] !== undefined ? reg(args[1]) : -1;
            bytes = encodeR(0x33, d, 0, s, 3, 0);
            break;
          }
          case 'sltz': { // sltz rd, rs -> slt rd, rs, x0
            const d = args[0] !== undefined ? reg(args[0]) : -1;
            const s = args[1] !== undefined ? reg(args[1]) : -1;
            bytes = encodeR(0x33, d, s, 0, 2, 0);
            break;
          }
          case 'sgtz': { // sgtz rd, rs -> slt rd, x0, rs
            const d = args[0] !== undefined ? reg(args[0]) : -1;
            const s = args[1] !== undefined ? reg(args[1]) : -1;
            bytes = encodeR(0x33, d, 0, s, 2, 0);
            break;
          }
          case 'mv': bytes = encodeI(0x13, rd, rs1, 0, 0); break;
          case 'ret': bytes = encodeI(0x67, 0, 1, 0, 0); break;
          case 'li': {
            if (imm !== null && imm >= -2048 && imm <= 2047) bytes = encodeI(0x13, rd, 0, imm, 0);
            else if (imm !== null) {
              const imm32 = imm >>> 0;
              const lo12 = imm32 & 0xfff;
              const loSgn = lo12 >= 0x800 ? lo12 - 0x1000 : lo12;
              const hi = ((imm32 - loSgn) >>> 0) & 0xfffff000;
              output.push(...encodeU(0x37, rd, hi));
              addr += 4;
              if (lo12 !== 0) {
                output.push(...encodeI(0x13, rd, rd, loSgn, 0));
                addr += 4;
              }
            }
            break;
          }
          case 'ecall': bytes = encodeI(0x73, 0, 0, 0, 0); break;
          case 'ebreak': bytes = encodeI(0x73, 0, 0, 1, 0); break;
          default:
            errors.push(`第 ${lineNum} 行: 不支持的指令或伪指令 "${mnemonic}"`);
        }
        if (bytes) { output.push(...bytes); addr += bytes.length; }
      } catch (e) {
        errors.push(`第 ${lineNum} 行: ${e.message || String(e)}`);
      }
    }
    return { machineCode: output, errors: errors.length ? errors : null, lineToAddr: lineToAddr };
  }

  global.RISCVAssembler = { assemble };
})(typeof window !== 'undefined' ? window : globalThis);
