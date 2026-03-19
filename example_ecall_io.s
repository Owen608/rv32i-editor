.text
.globl _start
_start:
  # readInt -> a0, then printInt(a0)
  li   a7, 1
  ecall
  li   a7, 2
  ecall

  # readChar -> a0, then printChar(a0)
  li   a7, 3
  ecall
  li   a7, 4
  ecall

  # readString(a0=bufAddr, a1=maxLen) then printString(a0=bufAddr)
  # 数据区从 0x80000000 开始，本例直接使用固定地址作为缓冲区
  la   a0, 0x80000000
  li   a1, 32
  li   a7, 5
  ecall
  la   a0, 0x80000000
  li   a7, 6
  ecall

  li   a7, 93
  ecall
