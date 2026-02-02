# 内置汇编器：指令与 opcode/编码对照表

RV32I 指令格式与编码（本实现使用的 opcode / funct3 / funct7）。

## 一、基本格式

| 类型 | opcode(6:0) | 字段布局 |
|------|-------------|----------|
| R    | 见下表      | funct7(31:25) \| rs2(24:20) \| rs1(19:15) \| funct3(14:12) \| rd(11:7) \| opcode(6:0) |
| I    | 0x13, 0x03, 0x67, 0x73 | imm(31:20) \| rs1(19:15) \| funct3(14:12) \| rd(11:7) \| opcode(6:0) |
| S    | 0x23 | imm[11:5](31:25) \| rs2(24:20) \| rs1(19:15) \| funct3(14:12) \| imm[4:0](11:7) \| opcode(6:0) |
| B    | 0x63 | imm[12\|10:5] \| rs2 \| rs1 \| funct3 \| imm[4:1\|11] \| opcode |
| U    | 0x37, 0x17 | imm(31:12) \| rd(11:7) \| opcode(6:0) |
| J    | 0x6f | imm[20\|10:1\|11\|19:12] \| rd(11:7) \| opcode(6:0) |

立即数均为符号扩展；imm 在指令中的位段以 RISC-V 规范为准。

---

## 二、按 opcode 列出的指令

### opcode = 0x13 (0010011) — I-type 算术/逻辑立即数

| 助记符 | funct3 | 编码说明 | 示例机器码 |
|--------|--------|----------|------------|
| addi   | 0      | rd, rs1, imm(-2048~2047) | addi a0, x0, 1 → **0x00100513** |
| slli   | 1      | rd, rs1, shamt(0~31)     | slli a0, a0, 2 → 0x00251513 |
| slti   | 2      | rd, rs1, imm             | — |
| sltiu  | 3      | rd, rs1, imm             | — |
| xori   | 4      | rd, rs1, imm             | xori a0, a0, -1 |
| srli   | 5      | rd, rs1, shamt; funct7=0 | srli a0, a0, 1 |
| srai   | 5      | rd, rs1, shamt; funct7=0x20 | srai a0, a0, 1 |
| ori    | 6      | rd, rs1, imm             | ori a0, a0, 0 |
| andi   | 7      | rd, rs1, imm             | andi a0, a0, 0 |

**编码公式（I-type）**：`ins = (imm12 & 0xfff)<<20 | rs1<<15 | funct3<<12 | rd<<7 | 0x13`，小端字节序输出。

---

### opcode = 0x33 (0110011) — R-type 算术/逻辑

| 助记符 | funct3 | funct7 | 说明 |
|--------|--------|--------|------|
| add    | 0 | 0x00 | rd=rs1+rs2 → **add a0, a0, a1 → 0x00b50533** |
| sub    | 0 | 0x20 | rd=rs1-rs2 |
| sll    | 1 | 0x00 | rd=rs1<<rs2[4:0] |
| slt    | 2 | 0x00 | rd = (rs1<rs2 signed) ? 1 : 0 |
| sltu   | 3 | 0x00 | rd = (rs1<rs2 unsigned) ? 1 : 0 |
| xor    | 4 | 0x00 | rd=rs1^rs2 |
| srl    | 5 | 0x00 | rd=rs1>>rs2[4:0] (逻辑) |
| sra    | 5 | 0x20 | rd=rs1>>rs2[4:0] (算术) |
| or     | 6 | 0x00 | rd=rs1\|rs2 |
| and    | 7 | 0x00 | rd=rs1&rs2 |

**编码公式（R-type）**：`ins = funct7<<25 | rs2<<20 | rs1<<15 | funct3<<12 | rd<<7 | 0x33`。

---

### opcode = 0x03 (0000011) — I-type 取数

| 助记符 | funct3 | 说明 |
|--------|--------|------|
| lb     | 0 | 字节有符号 |
| lh     | 1 | 半字有符号 |
| lw     | 2 | 字 |
| lbu    | 4 | 字节无符号 |
| lhu    | 5 | 半字无符号 |

格式：`lw rd, imm(rs1)`，imm 12 位有符号。

---

### opcode = 0x23 (0100011) — S-type 存数

| 助记符 | funct3 | 说明 |
|--------|--------|------|
| sb     | 0 | 存字节 |
| sh     | 1 | 存半字 |
| sw     | 2 | 存字 |

格式：`sw rs2, imm(rs1)`，imm 12 位有符号。

---

### opcode = 0x63 (1100011) — B-type 分支

| 助记符 | funct3 | 说明 |
|--------|--------|------|
| beq    | 0 | rs1==rs2 则跳 imm |
| bne    | 1 | rs1!=rs2 则跳 imm |
| blt    | 4 | 有符号 < |
| bge    | 5 | 有符号 >= |
| bltu   | 6 | 无符号 < |
| bgeu   | 7 | 无符号 >= |

imm 为相对当前 PC 的偏移，低 1 位为 0（2 字节对齐）。

---

### opcode = 0x37 (0110111) — U-type

| 助记符 | 说明 |
|--------|------|
| lui    | rd = imm << 12，imm 取高 20 位 |

---

### opcode = 0x17 (0010111) — U-type

| 助记符 | 说明 |
|--------|------|
| auipc  | rd = pc + (imm << 12) |

---

### opcode = 0x6f (1101111) — J-type

| 助记符 | 说明 |
|--------|------|
| jal    | rd = pc+4; pc += imm，imm 低 1 位为 0 |

---

### opcode = 0x67 (1100111) — I-type

| 助记符 | funct3=0 | 说明 |
|--------|---------|------|
| jalr   | 0 | rd = pc+4; pc = (rs1 + imm) & -2 |

---

### opcode = 0x73 (1110011) — 系统/环境调用

| 助记符 | imm[11:0] | 说明 |
|--------|-----------|------|
| ecall  | 0 | 环境调用 → **0x00000073** |
| ebreak | 1 | 断点 |

编码：I-type，rd=0, rs1=0, funct3=0，imm=0 为 ecall，imm=1 为 ebreak。

---

## 三、你当前测试应得到的机器码（无伪指令）

用**纯基指令**写等价程序：

```asm
.text
.globl _start
_start:
  addi a0, x0, 1    ; 0x00100513
  addi a1, x0, 2    ; 0x00200593
  add  a0, a0, a1   ; 0x00b50533
  addi a7, x0, 93   ; 0x05d00893
  ecall             ; 0x00000073
```

| 地址        | 机器码     | 反汇编           |
|-------------|------------|------------------|
| 0x80000000  | 0x00100513 | addi a0, x0, 1   |
| 0x80000004  | 0x00200593 | addi a1, x0, 2   |
| 0x80000008  | 0x00b50533 | add a0, a0, a1   |
| 0x8000000c  | 0x05d00893 | addi a7, x0, 93  |
| 0x80000010  | 0x00000073 | ecall            |

---

## 四、伪指令与本实现的对应关系（仅供参考）

| 伪指令 | 等价基指令（展开） |
|--------|------------|
| li rd, imm ( \|imm\|≤2047 ) | addi rd, x0, imm |
| li rd, imm ( 大立即数 )    | lui rd, hi; addi rd, rd, lo |
| mv rd, rs  | addi rd, rs, 0 |
| ret        | jalr x0, ra, 0 |
| nop        | addi x0, x0, 0 |
| j label / j imm | jal x0, label/imm |
| jr rs | jalr x0, rs, 0 |
| beqz rs, label | beq rs, x0, label |
| bnez rs, label | bne rs, x0, label |
| bgez rs, label | bge rs, x0, label |
| bltz rs, label | blt rs, x0, label |
| blez rs, label | bge x0, rs, label |
| bgtz rs, label | blt x0, rs, label |
| neg rd, rs | sub rd, x0, rs |
| not rd, rs | xori rd, rs, -1 |
| seqz rd, rs | sltiu rd, rs, 1 |
| snez rd, rs | sltu rd, x0, rs |
| sltz rd, rs | slt rd, rs, x0 |
| sgtz rd, rs | slt rd, x0, rs |

本表中列出的 opcode/funct3/funct7 与 `assembler.js` 中编码一致，可用于逐条对照检查。
