/**
 * RV32I + M 扩展 模拟器（用于单步/断点/连续执行）
 * 指令区：0x00000000 起；数据区：0x80000000 起，大小可配置（最大 1MB）
 */
(function (global) {
  const BASE_CODE = 0x00000000;
  const BASE_DATA = 0x80000000;
  const CODE_SIZE = 64 * 1024;
  const DATA_SIZE_MAX = 1024 * 1024;

  function Simulator() {
    this.regs = new Int32Array(32);
    this.pc = BASE_CODE;
    this.memory = null;
    this.memView = null;
    this.code = [];
    this.disasmLines = [];
    this.running = false;
    this.breakpoints = new Set();
    this.baseCode = BASE_CODE;
    this.baseData = BASE_DATA;
    this.codeSize = CODE_SIZE;
    this.dataSize = 64 * 1024;
  }

  Simulator.prototype.load = function (machineCode, dataSizeKB, breakpoints) {
    this.code = Array.isArray(machineCode) ? machineCode : Array.from(machineCode);
    this.pc = BASE_CODE;
    this.regs.fill(0);
    this.breakpoints = breakpoints != null ? new Set(breakpoints) : new Set();
    var dKB = (dataSizeKB == null || isNaN(dataSizeKB)) ? 64 : (dataSizeKB | 0);
    dKB = dKB < 1 ? 1 : (dKB > 1024 ? 1024 : dKB);
    this.dataSize = dKB * 1024;
    var totalSize = CODE_SIZE + this.dataSize;
    this.memory = new ArrayBuffer(totalSize);
    this.memView = new DataView(this.memory);
    this.regs[2] = BASE_DATA + this.dataSize - 4;
    var view = new Uint8Array(this.memory);
    view.fill(0);
    for (var i = 0; i < this.code.length && i < CODE_SIZE; i++) view[i] = (this.code[i] & 0xff);
    this.disasmLines = [];
  };

  Simulator.prototype.setBreakpoints = function (addrs) {
    this.breakpoints = addrs != null ? new Set(addrs) : new Set();
  };

  Simulator.prototype.toggleBreakpoint = function (addr) {
    if (this.breakpoints.has(addr)) this.breakpoints.delete(addr);
    else this.breakpoints.add(addr);
  };

  Simulator.prototype.setDisasm = function (lines) {
    this.disasmLines = lines || [];
  };

  Simulator.prototype.read32 = function (addr) {
    var a = (addr - BASE_CODE) >>> 0;
    if (a < CODE_SIZE && a + 4 <= CODE_SIZE && this.memView) return this.memView.getUint32(a, true);
    var d = (addr - BASE_DATA) >>> 0;
    if (d >= 0 && d < this.dataSize - 3) return this.memView.getUint32(CODE_SIZE + d, true);
    return 0;
  };

  Simulator.prototype.write32 = function (addr, val) {
    var d = (addr - BASE_DATA) >>> 0;
    if (d >= 0 && d < this.dataSize - 3) this.memView.setUint32(CODE_SIZE + d, val >>> 0, true);
  };

  Simulator.prototype.write8 = function (addr, val) {
    var d = (addr - BASE_DATA) >>> 0;
    if (d >= 0 && d < this.dataSize) this.memView.setUint8(CODE_SIZE + d, val & 0xff);
  };

  Simulator.prototype.read8 = function (addr) {
    var d = (addr - BASE_DATA) >>> 0;
    if (d >= 0 && d < this.dataSize) return this.memView.getUint8(CODE_SIZE + d);
    return 0;
  };

  Simulator.prototype.fetch = function () {
    var off = (this.pc - BASE_CODE) >>> 0;
    if (off + 4 > this.code.length || this.memView == null) return 0;
    return this.memView.getUint32(off, true);
  };

  function sext(x, bits) {
    const m = 1 << (bits - 1);
    return (x ^ m) - m;
  }

  Simulator.prototype.step = function () {
    const ins = this.fetch();
    if (ins === 0 && this.pc === BASE_CODE && (this.code.length === 0 || this.code[0] === 0)) return { done: true };
    const opcode = ins & 0x7f;
    const rd = (ins >> 7) & 0x1f;
    const rs1 = (ins >> 15) & 0x1f;
    const rs2 = (ins >> 20) & 0x1f;
    const funct3 = (ins >> 12) & 0x7;
    const funct7 = (ins >> 25) & 0x7f;
    const imm_i = sext(ins >> 20, 12);
    const imm_s = sext(((ins >> 7) & 0x1f) | ((ins >> 25) << 5), 12);
    const imm_b = sext(((ins >> 8) & 0xf) << 1 | ((ins >> 25) & 0x3f) << 5 | ((ins >> 7) & 1) << 11 | ((ins >>> 31) << 12), 13);
    const imm_u = (ins >>> 12) << 12;
    const imm_j = sext(((ins >> 21) & 0x3ff) << 1 | ((ins >> 20) & 1) << 11 | ((ins >> 12) & 0xff) << 12 | ((ins >>> 31) << 20), 21);
    const v1 = this.regs[rs1] | 0;
    const v2 = this.regs[rs2] | 0;

    if (opcode === 0x73) {
      if ((ins >> 20) === 0) {
        const a7 = this.regs[17] | 0;
        if (a7 === 64) { this.regs[10] = 0; }
        if (a7 === 93) { this.running = false; return { done: true }; }
      }
      this.pc += 4;
      return { pc: this.pc, ins };
    }

    switch (opcode) {
      case 0x37: this.regs[rd] = imm_u; this.pc += 4; break;
      case 0x17: this.regs[rd] = (this.pc + imm_u) | 0; this.pc += 4; break;
      case 0x6f: this.regs[rd] = (this.pc + 4) | 0; this.pc = (this.pc + imm_j) | 0; break;
      case 0x67: this.regs[rd] = (this.pc + 4) | 0; this.pc = ((v1 + imm_i) & -2) | 0; break;
      case 0x63:
        let take = false;
        switch (funct3) {
          case 0: take = v1 === v2; break;
          case 1: take = v1 !== v2; break;
          case 4: take = (v1 | 0) < (v2 | 0); break;
          case 5: take = (v1 | 0) >= (v2 | 0); break;
          case 6: take = (v1 >>> 0) < (v2 >>> 0); break;
          case 7: take = (v1 >>> 0) >= (v2 >>> 0); break;
        }
        this.pc = take ? (this.pc + imm_b) | 0 : (this.pc + 4) | 0;
        break;
      case 0x03: {
        const addr = (v1 + imm_i) | 0;
        let val = 0;
        switch (funct3) {
          case 0: val = this.read8(addr); val = sext(val, 8); break;
          case 1: val = this.read8(addr) | (this.read8(addr + 1) << 8); val = sext(val, 16); break;
          case 2: val = this.read32(addr); val = sext(val, 32); break;
          case 4: val = this.read8(addr); break;
          case 5: val = this.read8(addr) | (this.read8(addr + 1) << 8); break;
          default: val = this.read32(addr) | 0;
        }
        this.regs[rd] = val;
        this.pc += 4;
        break;
      }
      case 0x23: {
        const addr = (v1 + imm_s) | 0;
        if (funct3 === 0) { this.write8(addr, v2); this.write8(addr + 1, v2 >> 8); this.write8(addr + 2, v2 >> 16); this.write8(addr + 3, v2 >> 24); }
        else if (funct3 === 1) { this.write8(addr, v2); this.write8(addr + 1, v2 >> 8); }
        else if (funct3 === 2) this.write32(addr, v2);
        this.pc += 4;
        break;
      }
      case 0x13: {
        let res = 0;
        switch (funct3) {
          case 0: res = (v1 + imm_i) | 0; break;
          case 2: res = (v1 | 0) < (imm_i | 0) ? 1 : 0; break;
          case 3: res = (v1 >>> 0) < (imm_i >>> 0) ? 1 : 0; break;
          case 4: res = v1 ^ imm_i; break;
          case 6: res = v1 | imm_i; break;
          case 7: res = v1 & imm_i; break;
          case 1: res = (v1 << (imm_i & 0x1f)) | 0; break;
          case 5: res = funct7 === 0x20 ? (v1 >> (imm_i & 0x1f)) | 0 : (v1 >>> (imm_i & 0x1f)) | 0; break;
          default: res = (v1 + imm_i) | 0;
        }
        this.regs[rd] = res;
        this.pc += 4;
        break;
      }
      case 0x33: {
        let r = 0;
        if (funct7 === 0x01) {
          if (funct3 === 0) r = (v1 * v2) | 0;
          else if (funct3 === 1) r = Math.imul(v1, v2);
          else if (funct3 === 2) r = ((v1 | 0) * (v2 >>> 0)) | 0;
          else if (funct3 === 3) r = (v1 >>> 0) * (v2 >>> 0);
          else if (funct3 === 4) r = (v2 !== 0 && (v1 === -2147483648 && v2 === -1)) ? v1 : (v1 / v2) | 0;
          else if (funct3 === 5) r = (v2 !== 0) ? ((v1 >>> 0) / (v2 >>> 0)) | 0 : -1;
          else if (funct3 === 6) r = (v2 !== 0 && (v1 === -2147483648 && v2 === -1)) ? 0 : (v1 % v2) | 0;
          else if (funct3 === 7) r = (v2 !== 0) ? ((v1 >>> 0) % (v2 >>> 0)) | 0 : v1 >>> 0;
        } else {
          switch (funct3) {
            case 0: r = funct7 === 0x20 ? (v1 - v2) | 0 : (v1 + v2) | 0; break;
            case 1: r = (v1 << (v2 & 0x1f)) | 0; break;
            case 2: r = (v1 | 0) < (v2 | 0) ? 1 : 0; break;
            case 3: r = (v1 >>> 0) < (v2 >>> 0) ? 1 : 0; break;
            case 4: r = v1 ^ v2; break;
            case 5: r = funct7 === 0x20 ? (v1 >> (v2 & 0x1f)) | 0 : (v1 >>> (v2 & 0x1f)) | 0; break;
            case 6: r = v1 | v2; break;
            case 7: r = v1 & v2; break;
            default: r = (v1 + v2) | 0;
          }
        }
        this.regs[rd] = r;
        this.pc += 4;
        break;
      }
      default: this.pc += 4;
    }
    this.regs[0] = 0;
    return { pc: this.pc, ins };
  };

  Simulator.prototype.getRegs = function () {
    const r = [];
    for (let i = 0; i < 32; i++) r.push(this.regs[i] | 0);
    return r;
  };

  Simulator.prototype.getPC = function () { return this.pc; };

  Simulator.prototype.getDataRegion = function (maxWords) {
    if (this.memView == null) return [];
    var n = (maxWords == null || maxWords <= 0) ? 64 : (maxWords | 0);
    var CODE_SIZE = 64 * 1024;
    var BASE_DATA = 0x80000000;
    var out = [];
    for (var i = 0; i < n && i * 4 < this.dataSize; i++) {
      var addr = BASE_DATA + i * 4;
      var val = this.read32(addr);
      out.push({ addr: addr, value: val });
    }
    return out;
  };

  global.RISCVSimulator = Simulator;
})(typeof window !== 'undefined' ? window : globalThis);
