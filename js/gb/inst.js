const A = 0b111;
const B = 0b000;
const C = 0b001;
const D = 0b010;
const E = 0b011;
const H = 0b100;
const L = 0b101;
const HL = 0b110;
const Immediate = 257;
const BC = 258;
const DE = 259;
const SPr = 260;

const ADD = 1;
const ADC = 2;
const SUB = 3;
const SBC = 4;
const AND = 5;
const OR = 6;
const XOR = 7;
const CP = 8;

const RLC = 1;
const RRC = 2;
const RL = 3;
const RR = 4;
const SLA = 5;
const SRA = 6;
const SRL = 7;

var REG = new Uint8Array(8);
var FLAGS = {
  Z: false,
  N: false,
  H: false,
  C: false,
};
var PC = 0;
var SP = 0;
var IME = false;
var cpu_halted = false;

function ld(a, b) {
  if (b == Immediate)
    return function () {
      REG[a] = readMem(PC + 1);
      PC += 2;
      return 8;
    };
  return function () {
    REG[a] = REG[b];
    PC++;
    return 4;
  };
}
function ld_from_mem(a, b, c) {
  if (b == Immediate)
    return function () {
      REG[a] = readMem(readMem(PC + 1) + (readMem(PC + 2) << 8));
      PC += 3;
      return 16;
    };
  return function () {
    REG[a] = readMem((REG[b] << 8) + REG[c]);
    PC++;
    return 8;
  };
}
function ld_to_mem(a, b, c) {
  if (a == Immediate)
    return function () {
      writeMem(readMem(PC + 1) + (readMem(PC + 2) << 8), REG[b]);
      PC += 3;
      return 16;
    };
  if (c == Immediate)
    return function () {
      writeMem((REG[a] << 8) + REG[b], readMem(PC + 1));
      PC += 2;
      return 12;
    };
  return function () {
    writeMem((REG[a] << 8) + REG[b], REG[c]);
    PC++;
    return 8;
  };
}
function ld16(a, b, c) {
  if (b == Immediate) {
    if (a == HL)
      return function () {
        var s = readMem16(readMem(PC + 1) + (readMem(PC + 2) << 8));
        REG[H] = s[0];
        REG[L] = s[1];
        PC += 3;
        return 12;
      };

    return function () {
      SP = readMem(PC + 1) + (readMem(PC + 2) << 8);
      PC += 3;
      return 12;
    };
  }
  if (c == Immediate)
    return function () {
      REG[a] = readMem(PC + 2);
      REG[b] = readMem(PC + 1);
      PC += 3;
      return 12;
    };

  return function () {
    SP = (REG[H] << 8) + REG[L];
    PC++;
    return 8;
  };
}
function ldd(a, b) {
  if (a == HL)
    return function () {
      writeMem((REG[H] << 8) + REG[L], REG[A]);
      if (REG[L] == 0) REG[H]--;
      REG[L]--;

      PC++;
      return 8;
    };
  return function () {
    REG[A] = readMem((REG[H] << 8) + REG[L]);
    if (REG[L] == 0) REG[H]--;
    REG[L]--;
    PC++;
    return 8;
  };
}
function ldi(a, b) {
  if (a == HL)
    return function () {
      writeMem((REG[H] << 8) + REG[L], REG[A]);

      if (REG[L] == 255) REG[H]++;
      REG[L]++;

      PC++;
      return 8;
    };
  return function () {
    REG[A] = readMem((REG[H] << 8) + REG[L]);
    if (REG[L] == 255) REG[H]++;
    REG[L]++;
    PC++;
    return 8;
  };
}
function ldc(a, b) {
  if (a == A)
    return function () {
      REG[A] = readMem(0xff00 + REG[C]);
      PC++;
      return 8;
    };
  return function () {
    writeMem(0xff00 + REG[C], REG[A]);
    PC++;
    return 8;
  };
}
function ldh(a, b) {
  if (a == A)
    return function () {
      REG[A] = readMem(0xff00 + readMem(PC + 1));
      PC += 2;
      return 12;
    };
  return function () {
    writeMem(0xff00 + readMem(PC + 1), REG[A]);
    PC += 2;
    return 12;
  };
}
function ALU(op, a, b) {
  if (b == Immediate)
    return function () {
      REG[A] = ALU_process_8bit(op, readMem(PC + 1));
      PC += 2;
      return 8;
    };
  if (b == HL)
    return function () {
      REG[A] = ALU_process_8bit(op, readMem((REG[H] << 8) + REG[L]));
      PC++;
      return 8;
    };
  return function () {
    REG[A] = ALU_process_8bit(op, REG[b]);
    PC++;
    return 4;
  };
}
function ALU_process_8bit(op, b) {
  var result = REG[A];
  FLAGS.N = false;
  switch (op) {
    case ADD:
      FLAGS.H = !!(((REG[A] & 0x0f) + (b & 0x0f)) & 0x10);
      result += b;
      break;
    case ADC:
      FLAGS.H = !!(((REG[A] & 0x0f) + (b & 0x0f) + FLAGS.C) & 0x10);
      result += b + FLAGS.C;
      break;
    case SUB:
      result -= b;
      FLAGS.N = true;
      FLAGS.H = !!(((REG[A] & 0x0f) - (b & 0x0f)) & 0x10);
      break;
    case CP:
      result -= b;
      FLAGS.N = true;
      FLAGS.H = !!(((REG[A] & 0x0f) - (b & 0x0f)) & 0x10);
      FLAGS.Z = (result & 0xff) == 0;
      FLAGS.C = result > 255 || result < 0;
      return REG[A];
    case SBC:
      result -= b + FLAGS.C;
      FLAGS.N = true;
      FLAGS.H = !!(((REG[A] & 0x0f) - (b & 0x0f) - FLAGS.C) & 0x10);
      break;
    case AND:
      result &= b;
      FLAGS.H = true;
      break;
    case OR:
      result |= b;
      FLAGS.H = false;
      break;
    case XOR:
      result ^= b;
      FLAGS.H = false;
      break;
  }
  FLAGS.Z = (result & 0xff) == 0;
  FLAGS.C = result > 255 || result < 0;
  return result & 0xff;
}
function inc(a) {
  return incdec(a, 1);
}
function dec(a) {
  return incdec(a, -1);
}
function incdec(r, offset) {
  if (r == HL)
    return function () {
      writeMem((REG[H] << 8) + REG[L], incdec_process_8bit(readMem((REG[H] << 8) + REG[L]), offset));
      PC++;
      return 12;
    };
  return function () {
    REG[r] = incdec_process_8bit(REG[r], offset);
    PC++;
    return 4;
  };
}
function incdec_process_8bit(a, offset) {
  var result = a + offset;
  FLAGS.H = !!(((a & 0x0f) + offset) & 0x10);
  FLAGS.N = offset == -1;
  FLAGS.Z = (result & 0xff) == 0;
  return result;
}
function inc16(a, b) {
  if (a == SPr)
    return function () {
      SP++;
      PC++;
      return 8;
    };
  return function () {
    if (REG[b] == 255) REG[a]++;
    REG[b]++;
    PC++;
    return 8;
  };
}
function dec16(a, b) {
  if (a == SPr)
    return function () {
      SP--;
      PC++;
      return 8;
    };
  return function () {
    if (REG[b] == 0) REG[a]--;
    REG[b]--;
    PC++;
    return 8;
  };
}
function signedOffset(b) {
  return b > 127 ? b - 256 : b;
}
function jrNZ() {
  if (FLAGS.Z) {
    PC += 2;
    return 8;
  }
  PC += 2 + signedOffset(readMem(PC + 1));
  return 12;
}
function jrNC() {
  if (FLAGS.C) {
    PC += 2;
    return 8;
  }
  PC += 2 + signedOffset(readMem(PC + 1));
  return 12;
}
function jrZ() {
  if (!FLAGS.Z) {
    PC += 2;
    return 8;
  }
  PC += 2 + signedOffset(readMem(PC + 1));
  return 12;
}
function jrC() {
  if (!FLAGS.C) {
    PC += 2;
    return 8;
  }
  PC += 2 + signedOffset(readMem(PC + 1));
  return 12;
}
function jr() {
  PC += 2 + signedOffset(readMem(PC + 1));
  return 12;
}
function jp() {
  PC = readMem(PC + 1) + (readMem(PC + 2) << 8);
  return 16;
}
function jpNZ() {
  if (FLAGS.Z) {
    PC += 3;
    return 12;
  }
  PC = readMem(PC + 1) + (readMem(PC + 2) << 8);
  return 16;
}
function jpNC() {
  if (FLAGS.C) {
    PC += 3;
    return 12;
  }
  PC = readMem(PC + 1) + (readMem(PC + 2) << 8);
  return 16;
}
function jpZ() {
  if (!FLAGS.Z) {
    PC += 3;
    return 12;
  }
  PC = readMem(PC + 1) + (readMem(PC + 2) << 8);
  return 16;
}
function jpC() {
  if (!FLAGS.C) {
    PC += 3;
    return 12;
  }
  PC = readMem(PC + 1) + (readMem(PC + 2) << 8);
  return 16;
}
function jpHL() {
  PC = (REG[H] << 8) + REG[L];
  return 4;
}
function push(a, b) {
  if (a == A)
    return function () {
      var flags = (FLAGS.Z << 7) + (FLAGS.N << 6) + (FLAGS.H << 5) + (FLAGS.C << 4);
      SP -= 2;
      writeMem16(SP, REG[A], flags);
      PC++;
      return 16;
    };
  return function () {
    SP -= 2;
    writeMem16(SP, REG[a], REG[b]);
    PC++;
    return 16;
  };
}
function pop(a, b) {
  if (a == A)
    return function () {
      var s = readMem16(SP);
      REG[A] = s[0];
      FLAGS.Z = (s[1] & (1 << 7)) != 0;
      FLAGS.N = (s[1] & (1 << 6)) != 0;
      FLAGS.H = (s[1] & (1 << 5)) != 0;
      FLAGS.C = (s[1] & (1 << 4)) != 0;
      SP += 2;
      PC++;
      return 12;
    };
  return function () {
    var s = readMem16(SP);
    REG[a] = s[0];
    REG[b] = s[1];
    SP += 2;
    PC++;
    return 12;
  };
}
function call() {
  SP -= 2;
  var npc = PC + 3;
  writeMem16(SP, npc >> 8, npc & 0xff);
  PC = readMem(PC + 1) + (readMem(PC + 2) << 8);
  return 24;
}
function callNZ() {
  if (FLAGS.Z) {
    PC += 3;
    return 12;
  }
  return call();
}
function callNC() {
  if (FLAGS.C) {
    PC += 3;
    return 12;
  }
  return call();
}
function callZ() {
  if (!FLAGS.Z) {
    PC += 3;
    return 12;
  }
  return call();
}
function callC() {
  if (!FLAGS.C) {
    PC += 3;
    return 12;
  }
  return call();
}
function ret() {
  var s = readMem16(SP);
  SP += 2;
  PC = (s[0] << 8) + s[1];
  return 16;
}
function retNZ() {
  if (FLAGS.Z) {
    PC++;
    return 8;
  }
  ret();
  return 20;
}
function retNC() {
  if (FLAGS.C) {
    PC++;
    return 8;
  }
  ret();
  return 20;
}
function retZ() {
  if (!FLAGS.Z) {
    PC++;
    return 8;
  }
  ret();
  return 20;
}
function retC() {
  if (!FLAGS.C) {
    PC++;
    return 8;
  }
  ret();
  return 20;
}
function reti() {
  IME = true;
  return ret();
}
function ei() {
  IME = true;
  PC++;
  return 4;
}
function di() {
  IME = false;
  PC++;
  return 4;
}
function rst(a) {
  return function () {
    SP -= 2;
    var npc = PC + 1;
    writeMem16(SP, npc >> 8, npc & 0xff);
    PC = a;
    return 16;
  };
}
function shift_fast(op, a) {
  return function () {
    REG[a] = shift_process(op, REG[a]);
    FLAGS.Z = false;
    PC++;
    return 4;
  };
}
function shift(op, a) {
  if (a == HL)
    return function () {
      var addr = (REG[H] << 8) + REG[L];
      writeMem(addr, shift_process(op, readMem(addr)));
      PC++;
      return 16;
    };
  return function () {
    REG[a] = shift_process(op, REG[a]);
    PC++;
    return 8;
  };
}
function shift_process(op, a) {
  var bit7 = a >> 7,
    bit0 = a & 1;
  switch (op) {
    case RLC:
      a = ((a << 1) & 0xff) + bit7;
      FLAGS.C = !!bit7;
      break;
    case RRC:
      a = ((a >> 1) & 0xff) + (bit0 << 7);
      FLAGS.C = !!bit0;
      break;
    case RL:
      a = ((a << 1) & 0xff) + FLAGS.C;
      FLAGS.C = !!bit7;
      break;
    case RR:
      a = ((a >> 1) & 0xff) + (FLAGS.C << 7);
      FLAGS.C = !!bit0;
      break;
    case SLA:
      a = (a << 1) & 0xff;
      FLAGS.C = !!bit7;
      break;
    case SRA:
      a = ((a >> 1) & 0xff) + (bit7 << 7);
      FLAGS.C = !!bit0;
      break;
    case SRL:
      a = (a >> 1) & 0xff;
      FLAGS.C = !!bit0;
      break;
  }
  FLAGS.N = false;
  FLAGS.H = false;
  FLAGS.Z = (a & 0xff) == 0;
  return a;
}
function ccf() {
  FLAGS.N = false;
  FLAGS.H = false;
  FLAGS.C = !FLAGS.C;
  PC++;
  return 4;
}
function scf() {
  FLAGS.N = false;
  FLAGS.H = false;
  FLAGS.C = true;
  PC++;
  return 4;
}
function cpl() {
  REG[A] = ~REG[A];
  FLAGS.N = true;
  FLAGS.H = true;
  PC++;
  return 4;
}
function addHL(a, b) {
  if (a == SPr)
    return function () {
      var c = (REG[L] += SP & 0xff) > 255 ? 1 : 0;
      var h = REG[H] + (SP >> 8) + c;
      FLAGS.H = !!(((REG[H] & 0x0f) + ((SP >> 8) & 0x0f) + c) & 0x10);
      REG[H] = h;
      FLAGS.C = h > 255;
      FLAGS.N = false;
      PC++;
      return 8;
    };
  return function () {
    var c = (REG[L] += REG[b]) > 255 ? 1 : 0;
    var h = REG[H] + REG[a] + c;
    FLAGS.H = !!(((REG[H] & 0x0f) + (REG[a] & 0x0f) + c) & 0x10);
    REG[H] = h;
    FLAGS.C = h > 255;
    FLAGS.N = false;
    PC++;
    return 8;
  };
}
function daa() {
  if (FLAGS.N) {
    if (FLAGS.C) REG[A] -= 0x60;
    if (FLAGS.H) REG[A] -= 0x06;
  } else {
    if (REG[A] > 0x99 || FLAGS.C) {
      REG[A] += 0x60;
      FLAGS.C = true;
    }
    if ((REG[A] & 0x0f) > 0x09 || FLAGS.H) REG[A] += 0x06;
  }
  FLAGS.Z = REG[A] == 0;
  FLAGS.H = false;
  PC++;
  return 4;
}
function ld_imm_sp() {
  writeMem16(readMem(PC + 1) + (readMem(PC + 2) << 8), SP >> 8, SP & 0xff);
  PC += 3;
  return 20;
}
function ld_hl_spdd() {
  var b = signedOffset(readMem(PC + 1));
  FLAGS.H = !!(((SP & 0x0f) + (b & 0x0f)) & 0x010);
  FLAGS.C = !!(((SP & 0xff) + (b & 0xff)) & 0x100);
  var n = SP + b;
  REG[H] = n >> 8;
  REG[L] = n & 0xff;
  FLAGS.N = false;
  FLAGS.Z = false;
  PC += 2;
  return 12;
}
function add_sp_n() {
  var b = signedOffset(readMem(PC + 1));
  FLAGS.H = !!(((SP & 0x0f) + (b & 0x0f)) & 0x010);
  FLAGS.C = !!(((SP & 0xff) + (b & 0xff)) & 0x100);
  SP += b;
  FLAGS.N = false;
  FLAGS.Z = false;
  SP &= 0xffff;
  PC += 2;
  return 16;
}
function halt() {
  cpu_halted = true;
  PC++;
  return 4;
}
function stop() {
  PC += 2;
  return 4;
}
const unused = function () {
  return 4;
};
const opcodes = Array(256);
for (var i = 0; i < 256; i++)
  opcodes[i] = function () {
    throw Error("Undefined Opcode");
  };
const CBcodes = Array(256);
for (var i = 0; i < 256; i++)
  CBcodes[i] = function () {
    throw Error("Undefined 0xCB Opcode");
  };
opcodes[0x00] = function nop() {
  PC++;
  return 4;
};
opcodes[0x01] = ld16(B, C, Immediate);
opcodes[0x02] = ld_to_mem(B, C, A);
opcodes[0x03] = inc16(B, C);
opcodes[0x04] = inc(B);
opcodes[0x05] = dec(B);
opcodes[0x06] = ld(B, Immediate);
opcodes[0x07] = shift_fast(RLC, A);
opcodes[0x08] = ld_imm_sp;
opcodes[0x09] = addHL(B, C);
opcodes[0x0a] = ld_from_mem(A, B, C);
opcodes[0x0b] = dec16(B, C);
opcodes[0x0c] = inc(C);
opcodes[0x0d] = dec(C);
opcodes[0x0e] = ld(C, Immediate);
opcodes[0x0f] = shift_fast(RRC, A);
opcodes[0x10] = stop;
opcodes[0x11] = ld16(D, E, Immediate);
opcodes[0x12] = ld_to_mem(D, E, A);
opcodes[0x13] = inc16(D, E);
opcodes[0x14] = inc(D);
opcodes[0x15] = dec(D);
opcodes[0x16] = ld(D, Immediate);
opcodes[0x17] = shift_fast(RL, A);
opcodes[0x18] = jr;
opcodes[0x19] = addHL(D, E);
opcodes[0x1a] = ld_from_mem(A, D, E);
opcodes[0x1b] = dec16(D, E);
opcodes[0x1c] = inc(E);
opcodes[0x1d] = dec(E);
opcodes[0x1e] = ld(E, Immediate);
opcodes[0x1f] = shift_fast(RR, A);
opcodes[0x20] = jrNZ;
opcodes[0x21] = ld16(H, L, Immediate);
opcodes[0x22] = ldi(HL, A);
opcodes[0x23] = inc16(H, L);
opcodes[0x24] = inc(H);
opcodes[0x25] = dec(H);
opcodes[0x26] = ld(H, Immediate);
opcodes[0x27] = daa;
opcodes[0x28] = jrZ;
opcodes[0x29] = addHL(H, L);
opcodes[0x2a] = ldi(A, HL);
opcodes[0x2b] = dec16(H, L);
opcodes[0x2c] = inc(L);
opcodes[0x2d] = dec(L);
opcodes[0x2e] = ld(L, Immediate);
opcodes[0x2f] = cpl;
opcodes[0x30] = jrNC;
opcodes[0x31] = ld16(SPr, Immediate);
opcodes[0x32] = ldd(HL, A);
opcodes[0x33] = inc16(SPr);
opcodes[0x34] = inc(HL);
opcodes[0x35] = dec(HL);
opcodes[0x36] = ld_to_mem(H, L, Immediate);
opcodes[0x37] = scf;
opcodes[0x38] = jrC;
opcodes[0x39] = addHL(SPr);
opcodes[0x3a] = ldd(A, HL);
opcodes[0x3b] = dec16(SPr);
opcodes[0x3c] = inc(A);
opcodes[0x3d] = dec(A);
opcodes[0x3e] = ld(A, Immediate);
opcodes[0x3f] = ccf;
opcodes[0x40] = ld(B, B);
opcodes[0x41] = ld(B, C);
opcodes[0x42] = ld(B, D);
opcodes[0x43] = ld(B, E);
opcodes[0x44] = ld(B, H);
opcodes[0x45] = ld(B, L);
opcodes[0x46] = ld_from_mem(B, H, L);
opcodes[0x47] = ld(B, A);
opcodes[0x48] = ld(C, B);
opcodes[0x49] = ld(C, C);
opcodes[0x4a] = ld(C, D);
opcodes[0x4b] = ld(C, E);
opcodes[0x4c] = ld(C, H);
opcodes[0x4d] = ld(C, L);
opcodes[0x4e] = ld_from_mem(C, H, L);
opcodes[0x4f] = ld(C, A);
opcodes[0x50] = ld(D, B);
opcodes[0x51] = ld(D, C);
opcodes[0x52] = ld(D, D);
opcodes[0x53] = ld(D, E);
opcodes[0x54] = ld(D, H);
opcodes[0x55] = ld(D, L);
opcodes[0x56] = ld_from_mem(D, H, L);
opcodes[0x57] = ld(D, A);
opcodes[0x58] = ld(E, B);
opcodes[0x59] = ld(E, C);
opcodes[0x5a] = ld(E, D);
opcodes[0x5b] = ld(E, E);
opcodes[0x5c] = ld(E, H);
opcodes[0x5d] = ld(E, L);
opcodes[0x5e] = ld_from_mem(E, H, L);
opcodes[0x5f] = ld(E, A);
opcodes[0x60] = ld(H, B);
opcodes[0x61] = ld(H, C);
opcodes[0x62] = ld(H, D);
opcodes[0x63] = ld(H, E);
opcodes[0x64] = ld(H, H);
opcodes[0x65] = ld(H, L);
opcodes[0x66] = ld_from_mem(H, H, L);
opcodes[0x67] = ld(H, A);
opcodes[0x68] = ld(L, B);
opcodes[0x69] = ld(L, C);
opcodes[0x6a] = ld(L, D);
opcodes[0x6b] = ld(L, E);
opcodes[0x6c] = ld(L, H);
opcodes[0x6d] = ld(L, L);
opcodes[0x6e] = ld_from_mem(L, H, L);
opcodes[0x6f] = ld(L, A);
opcodes[0x70] = ld_to_mem(H, L, B);
opcodes[0x71] = ld_to_mem(H, L, C);
opcodes[0x72] = ld_to_mem(H, L, D);
opcodes[0x73] = ld_to_mem(H, L, E);
opcodes[0x74] = ld_to_mem(H, L, H);
opcodes[0x75] = ld_to_mem(H, L, L);
opcodes[0x76] = halt;
opcodes[0x77] = ld_to_mem(H, L, A);
opcodes[0x78] = ld(A, B);
opcodes[0x79] = ld(A, C);
opcodes[0x7a] = ld(A, D);
opcodes[0x7b] = ld(A, E);
opcodes[0x7c] = ld(A, H);
opcodes[0x7d] = ld(A, L);
opcodes[0x7e] = ld_from_mem(A, H, L);
opcodes[0x7f] = ld(A, A);
opcodes[0x80] = ALU(ADD, A, B);
opcodes[0x81] = ALU(ADD, A, C);
opcodes[0x82] = ALU(ADD, A, D);
opcodes[0x83] = ALU(ADD, A, E);
opcodes[0x84] = ALU(ADD, A, H);
opcodes[0x85] = ALU(ADD, A, L);
opcodes[0x86] = ALU(ADD, A, HL);
opcodes[0x87] = ALU(ADD, A, A);
opcodes[0x88] = ALU(ADC, A, B);
opcodes[0x89] = ALU(ADC, A, C);
opcodes[0x8a] = ALU(ADC, A, D);
opcodes[0x8b] = ALU(ADC, A, E);
opcodes[0x8c] = ALU(ADC, A, H);
opcodes[0x8d] = ALU(ADC, A, L);
opcodes[0x8e] = ALU(ADC, A, HL);
opcodes[0x8f] = ALU(ADC, A, A);
opcodes[0x90] = ALU(SUB, A, B);
opcodes[0x91] = ALU(SUB, A, C);
opcodes[0x92] = ALU(SUB, A, D);
opcodes[0x93] = ALU(SUB, A, E);
opcodes[0x94] = ALU(SUB, A, H);
opcodes[0x95] = ALU(SUB, A, L);
opcodes[0x96] = ALU(SUB, A, HL);
opcodes[0x97] = ALU(SUB, A, A);
opcodes[0x98] = ALU(SBC, A, B);
opcodes[0x99] = ALU(SBC, A, C);
opcodes[0x9a] = ALU(SBC, A, D);
opcodes[0x9b] = ALU(SBC, A, E);
opcodes[0x9c] = ALU(SBC, A, H);
opcodes[0x9d] = ALU(SBC, A, L);
opcodes[0x9e] = ALU(SBC, A, HL);
opcodes[0x9f] = ALU(SBC, A, A);
opcodes[0xa0] = ALU(AND, A, B);
opcodes[0xa1] = ALU(AND, A, C);
opcodes[0xa2] = ALU(AND, A, D);
opcodes[0xa3] = ALU(AND, A, E);
opcodes[0xa4] = ALU(AND, A, H);
opcodes[0xa5] = ALU(AND, A, L);
opcodes[0xa6] = ALU(AND, A, HL);
opcodes[0xa7] = ALU(AND, A, A);
opcodes[0xa8] = ALU(XOR, A, B);
opcodes[0xa9] = ALU(XOR, A, C);
opcodes[0xaa] = ALU(XOR, A, D);
opcodes[0xab] = ALU(XOR, A, E);
opcodes[0xac] = ALU(XOR, A, H);
opcodes[0xad] = ALU(XOR, A, L);
opcodes[0xae] = ALU(XOR, A, HL);
opcodes[0xaf] = ALU(XOR, A, A);
opcodes[0xb0] = ALU(OR, A, B);
opcodes[0xb1] = ALU(OR, A, C);
opcodes[0xb2] = ALU(OR, A, D);
opcodes[0xb3] = ALU(OR, A, E);
opcodes[0xb4] = ALU(OR, A, H);
opcodes[0xb5] = ALU(OR, A, L);
opcodes[0xb6] = ALU(OR, A, HL);
opcodes[0xb7] = ALU(OR, A, A);
opcodes[0xb8] = ALU(CP, A, B);
opcodes[0xb9] = ALU(CP, A, C);
opcodes[0xba] = ALU(CP, A, D);
opcodes[0xbb] = ALU(CP, A, E);
opcodes[0xbc] = ALU(CP, A, H);
opcodes[0xbd] = ALU(CP, A, L);
opcodes[0xbe] = ALU(CP, A, HL);
opcodes[0xbf] = ALU(CP, A, A);
opcodes[0xc0] = retNZ;
opcodes[0xc1] = pop(B, C);
opcodes[0xc2] = jpNZ;
opcodes[0xc3] = jp;
opcodes[0xc4] = callNZ;
opcodes[0xc5] = push(B, C);
opcodes[0xc6] = ALU(ADD, A, Immediate);
opcodes[0xc7] = rst(0x00);
opcodes[0xc8] = retZ;
opcodes[0xc9] = ret;
opcodes[0xca] = jpZ;
opcodes[0xcb] = function () {
  return CBcodes[readMem(++PC)]();
};
opcodes[0xcc] = callZ;
opcodes[0xcd] = call;
opcodes[0xce] = ALU(ADC, A, Immediate);
opcodes[0xcf] = rst(0x08);
opcodes[0xd0] = retNC;
opcodes[0xd1] = pop(D, E);
opcodes[0xd2] = jpNC;
opcodes[0xd3] = unused;
opcodes[0xd4] = callNC;
opcodes[0xd5] = push(D, E);
opcodes[0xd6] = ALU(SUB, A, Immediate);
opcodes[0xd7] = rst(0x10);
opcodes[0xd8] = retC;
opcodes[0xd9] = reti;
opcodes[0xda] = jpC;
opcodes[0xdb] = unused;
opcodes[0xdc] = callC;
opcodes[0xdd] = unused;
opcodes[0xde] = ALU(SBC, A, Immediate);
opcodes[0xdf] = rst(0x18);
opcodes[0xe0] = ldh(Immediate, A);
opcodes[0xe1] = pop(H, L);
opcodes[0xe2] = ldc(C, A);
opcodes[0xe3] = unused;
opcodes[0xe4] = unused;
opcodes[0xe5] = push(H, L);
opcodes[0xe6] = ALU(AND, A, Immediate);
opcodes[0xe7] = rst(0x20);
opcodes[0xe8] = add_sp_n;
opcodes[0xe9] = jpHL;
opcodes[0xea] = ld_to_mem(Immediate, A);
opcodes[0xeb] = unused;
opcodes[0xec] = unused;
opcodes[0xed] = unused;
opcodes[0xee] = ALU(XOR, A, Immediate);
opcodes[0xef] = rst(0x28);
opcodes[0xf0] = ldh(A, Immediate);
opcodes[0xf1] = pop(A, FLAGS);
opcodes[0xf2] = ldc(A, C);
opcodes[0xf3] = di;
opcodes[0xf4] = unused;
opcodes[0xf5] = push(A, FLAGS);
opcodes[0xf6] = ALU(OR, A, Immediate);
opcodes[0xf7] = rst(0x30);
opcodes[0xf8] = ld_hl_spdd;
opcodes[0xf9] = ld16();
opcodes[0xfa] = ld_from_mem(A, Immediate);
opcodes[0xfb] = ei;
opcodes[0xfc] = unused;
opcodes[0xfd] = unused;
opcodes[0xfe] = ALU(CP, A, Immediate);
opcodes[0xff] = rst(0x38);
CBcodes[0x00] = shift(RLC, B);
CBcodes[0x01] = shift(RLC, C);
CBcodes[0x02] = shift(RLC, D);
CBcodes[0x03] = shift(RLC, E);
CBcodes[0x04] = shift(RLC, H);
CBcodes[0x05] = shift(RLC, L);
CBcodes[0x06] = shift(RLC, HL);
CBcodes[0x07] = shift(RLC, A);
CBcodes[0x08] = shift(RRC, B);
CBcodes[0x09] = shift(RRC, C);
CBcodes[0x0a] = shift(RRC, D);
CBcodes[0x0b] = shift(RRC, E);
CBcodes[0x0c] = shift(RRC, H);
CBcodes[0x0d] = shift(RRC, L);
CBcodes[0x0e] = shift(RRC, HL);
CBcodes[0x0f] = shift(RRC, A);
CBcodes[0x10] = shift(RL, B);
CBcodes[0x11] = shift(RL, C);
CBcodes[0x12] = shift(RL, D);
CBcodes[0x13] = shift(RL, E);
CBcodes[0x14] = shift(RL, H);
CBcodes[0x15] = shift(RL, L);
CBcodes[0x16] = shift(RL, HL);
CBcodes[0x17] = shift(RL, A);
CBcodes[0x18] = shift(RR, B);
CBcodes[0x19] = shift(RR, C);
CBcodes[0x1a] = shift(RR, D);
CBcodes[0x1b] = shift(RR, E);
CBcodes[0x1c] = shift(RR, H);
CBcodes[0x1d] = shift(RR, L);
CBcodes[0x1e] = shift(RR, HL);
CBcodes[0x1f] = shift(RR, A);
CBcodes[0x20] = shift(SLA, B);
CBcodes[0x21] = shift(SLA, C);
CBcodes[0x22] = shift(SLA, D);
CBcodes[0x23] = shift(SLA, E);
CBcodes[0x24] = shift(SLA, H);
CBcodes[0x25] = shift(SLA, L);
CBcodes[0x26] = shift(SLA, HL);
CBcodes[0x27] = shift(SLA, A);
CBcodes[0x28] = shift(SRA, B);
CBcodes[0x29] = shift(SRA, C);
CBcodes[0x2a] = shift(SRA, D);
CBcodes[0x2b] = shift(SRA, E);
CBcodes[0x2c] = shift(SRA, H);
CBcodes[0x2d] = shift(SRA, L);
CBcodes[0x2e] = shift(SRA, HL);
CBcodes[0x2f] = shift(SRA, A);
CBcodes[0x38] = shift(SRL, B);
CBcodes[0x39] = shift(SRL, C);
CBcodes[0x3a] = shift(SRL, D);
CBcodes[0x3b] = shift(SRL, E);
CBcodes[0x3c] = shift(SRL, H);
CBcodes[0x3d] = shift(SRL, L);
CBcodes[0x3e] = shift(SRL, HL);
CBcodes[0x3f] = shift(SRL, A);
CBcodes[0x30] = swap(B);
CBcodes[0x31] = swap(C);
CBcodes[0x32] = swap(D);
CBcodes[0x33] = swap(E);
CBcodes[0x34] = swap(H);
CBcodes[0x35] = swap(L);
CBcodes[0x36] = swap(HL);
CBcodes[0x37] = swap(A);
for (var i = 0; i < 8; i++) {
  for (var j = 0; j < 8; j++) {
    CBcodes[0x40 + i * 8 + j] = bit(i, j);
    CBcodes[0x80 + i * 8 + j] = res(i, j);
    CBcodes[0xc0 + i * 8 + j] = set(i, j);
  }
}
function swap(r) {
  if (r == HL)
    return function () {
      var a = readMem((REG[H] << 8) + REG[L]);
      a = (a >> 4) + ((a << 4) & 0xff);
      writeMem((REG[H] << 8) + REG[L], a);
      FLAGS.Z = a == 0;
      FLAGS.N = false;
      FLAGS.H = false;
      FLAGS.C = false;
      PC++;
      return 16;
    };
  return function () {
    REG[r] = (REG[r] >> 4) + ((REG[r] << 4) & 0xff);
    FLAGS.Z = REG[r] == 0;
    FLAGS.N = false;
    FLAGS.H = false;
    FLAGS.C = false;
    PC++;
    return 8;
  };
}
function bit(b, r) {
  b = 1 << b;
  if (r == HL)
    return function () {
      FLAGS.Z = (readMem((REG[H] << 8) + REG[L]) & b) == 0;
      FLAGS.H = true;
      FLAGS.N = false;
      PC++;
      return 12;
    };
  return function () {
    FLAGS.Z = (REG[r] & b) == 0;
    FLAGS.H = true;
    FLAGS.N = false;
    PC++;
    return 8;
  };
}
function set(b, r) {
  b = 1 << b;
  if (r == HL)
    return function () {
      writeMem((REG[H] << 8) + REG[L], readMem((REG[H] << 8) + REG[L]) | b);
      PC++;
      return 16;
    };
  return function () {
    REG[r] |= b;
    PC++;
    return 8;
  };
}
function res(b, r) {
  b = ~(1 << b);
  if (r == HL)
    return function () {
      writeMem((REG[H] << 8) + REG[L], readMem((REG[H] << 8) + REG[L]) & b);
      PC++;
      return 16;
    };
  return function () {
    REG[r] &= b;
    PC++;
    return 8;
  };
}