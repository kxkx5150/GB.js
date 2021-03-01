"use strict";
var targ = 0x10000;
var requestStop = true;
var joypad_dpad = 0xef,
  joypad_buttons = 0xdf;
var keys_dpad = 0xef,
  keys_buttons = 0xdf;
var vram_dma_source = 0;
var vram_dma_destination = 0;
var vram_dma_running = 0;
var ROM = new Uint8Array(512);
var MEM = new Uint8Array(0x10000);
var Sound = new GBC_sound();
var gamepad = new GBC_gamepad();
var cartRAM = new Uint8Array(0x8000);
var select_video = 0;
var cpu_speed = 0;
var gamepad_instaval = 0;
const frameClocks = 4194304 / 59.7;
const frameIntervalMs = 1000 / 59.7;

var filename = "";
var lazySaveTimerID = null;
var lazyLoadTimerID = null;

var FirstROMPage;
var ROMbank = 1;
var ROMbankoffset = (ROMbank - 1) * 0x4000;
var RAMbank = 0;
var RAMbankoffset = RAMbank * 0x2000 - 0xa000;
var RAMenabled = false;

var MBCRamMode = 0;
var divPrescaler = 0;
var timerPrescaler = 0;
var timerLength = 1;
var timerEnable = false;
var LCD_enabled = false;
var LCD_lastmode = 1;
var LCD_scan = 0;
var limitFrameRate = true;
var frameCountdown = frameClocks;
var thisFrame;
var lastFrame = performance.now();

function get_dma_array(start_address, length) {
  var new_array = new Uint8Array(length);
  for (var i = 0; i < length; ++i) {
    new_array[i] = readMem(start_address + i);
  }
  return new_array;
}
function readMem(addr) {
  if (addr >= 0xff10 && addr <= 0xff26) {
    return Sound.readMem(addr);
  }
  if (addr >= 0xff30 && addr <= 0xff3f) {
    return Sound.readMem(addr);
  }

  if (addr <= 0x3fff) return ROM[addr];
  if (addr <= 0x7fff) return ROM[addr + ROMbankoffset];
  if (addr >= 0xa000 && addr <= 0xbfff){

    return cartRAM[addr + RAMbankoffset];
  }
  if (addr == 0xff00) {
    if (MEM[0xff00] & 0x20) {
      return joypad_dpad & keys_dpad;
    } else if (MEM[0xff00] & 0x10) {
      return joypad_buttons & keys_buttons;
    } else return 0xff;
  }
  return MEM[addr];
}
function storeData(){
  clearTimeout(lazySaveTimerID)
  lazySaveTimerID = setTimeout(function(e){
    let binary = "";
    for (let i in cartRAM) {
      binary += String.fromCharCode(cartRAM[i]);
    }
    window.localStorage.setItem(filename, binary);
    console.log("save");
  },2000)
}
function writeMem(addr, data) {
  if (addr >= 0xff10 && addr <= 0xff26) {
    Sound.soundMapper(addr, data);
    return;
  }
  if (addr >= 0xff30 && addr <= 0xff3f) {
    Sound.nodes[3].waveChanged = true;
    Sound.MEM2[addr] = data;
    return;
  }

  if (addr <= 0x7fff) {
    doMBC(addr, data);
    return;
  }
  if (addr >= 0xa000 && addr <= 0xbfff && RAMenabled) {
    cartRAM[addr + RAMbankoffset] = data;
    storeData(cartRAM)
    return;
  }

  if (addr == 0xff04) {
    MEM[0xff04] = 0;
    return;
  }

  if (addr == 0xff07) {
    timerEnable = (data & (1 << 2)) != 0;
    timerLength = [1024, 16, 64, 256][data & 0x3];
    timerPrescaler = timerLength;
    MEM[addr] = 0xf8 | data;
    return;
  }

  if (addr == 0xff40) {
    var cc = data & (1 << 7);
    if (LCD_enabled != cc) {
      LCD_enabled = !!cc;
      if (!LCD_enabled) {
        LCD_scan = 0;
        MEM[0xff41] = (MEM[0xff41] & 0xfc) + 1;
      }
    }
  }
  if (addr == 0xff41) {
    MEM[0xff41] &= 0x3;
    data &= 0xfc;
    MEM[0xff41] |= 0x80 | data;
    return;
  }

  if (addr == 0xff44) {
    MEM[0xff44] = 0;
    return;
  }

  if (addr == 0xff46) {
    var st = data << 8;
    for (var i = 0; i <= 0x9f; i++) MEM[0xfe00 + i] = readMem(st + i);
    return;
  }

  if (addr == 0xff50) {
    for (var i = 0; i < 256; i++) ROM[i] = FirstROMPage[i];
    return;
  }

  MEM[addr] = data;
}
function triggerInterrupt(vector) {
  cpu_halted = false;
  writeMem16((SP -= 2), PC >> 8, PC & 0xff);
  PC = vector;
  IME = false;
  return 20;
}
function raise_interrupt(val) {
  if (val === 0x48) MEM[0xff0f] |= 1 << 1;
  else if (val === 0x40) MEM[0xff0f] |= 1 << 0;
}
function cpu() {
  var cycles = 4;
  if (!cpu_halted) {
    cycles = opcodes[readMem(PC)]();
  }

  if ((divPrescaler += cycles) > 255) {
    divPrescaler -= 256;
    MEM[0xff04]++;
  }
  if (timerEnable) {
    timerPrescaler -= cycles;
    while (timerPrescaler < 0) {
      timerPrescaler += timerLength;
      if (MEM[0xff05]++ == 0xff) {
        MEM[0xff05] = MEM[0xff06];
        MEM[0xff0f] |= 1 << 2;
        cpu_halted = false;
      }
    }
  }

  if (IME) {
    var i = MEM[0xff0f] & MEM[0xffff];
    if (i & (1 << 0)) {
      MEM[0xff0f] &= ~(1 << 0);
      cycles += triggerInterrupt(0x40);
    } else if (i & (1 << 1)) {
      MEM[0xff0f] &= ~(1 << 1);
      cycles += triggerInterrupt(0x48);
    } else if (i & (1 << 2)) {
      MEM[0xff0f] &= ~(1 << 2);
      cycles += triggerInterrupt(0x50);
    } else if (i & (1 << 3)) {
      MEM[0xff0f] &= ~(1 << 3);
      cycles += triggerInterrupt(0x58);
    } else if (i & (1 << 4)) {
      MEM[0xff0f] &= ~(1 << 4);
      cycles += triggerInterrupt(0x60);
    }
  }
  return cycles;
}
function run(time) {
  thisFrame = time || performance.now();
  if (limitFrameRate) {
    let d = thisFrame - lastFrame;
    if (d >= frameIntervalMs - 0.1) {
      lastFrame = thisFrame - (d % frameIntervalMs);
    } else {
      requestAnimationFrame(run);
      return;
    }
  }
  if(gamepad_instaval % 3 === 0)gamepad.updateGamepad();
  gamepad_instaval++
  while (true) {
    var cycles = cpu();
    Sound.countDown(cycles);
    if (select_video) video.clock(cycles * (cpu_speed ? 0.5 : 1)) * (cpu_speed ? 2 : 1);
    else disp(cycles);

    frameCountdown -= cycles;
    if (frameCountdown < 0) {
      frameCountdown += frameClocks;
      break;
    }
    if (PC == targ) break;
  }
  if (PC != targ && !requestStop) {
    window.requestAnimationFrame(run);
  }
}
function start(arybuf,name) {
  filename = name;
  ROM = new Uint8Array(arybuf);
  FirstROMPage = ROM.slice(0, 256);
  for (var i = 0; i < 256; i++) ROM[i] = bootCode[i];

  MEM[0xff41] = 1;
  MEM[0xff43] = 0;

  ROMbank = 1;
  ROMbankoffset = (ROMbank - 1) * 0x4000;
  RAMbank = 0;
  RAMbankoffset = RAMbank * 0x2000 - 0xa000;
  RAMenabled = false;
  MBCRamMode = 0;
  (divPrescaler = 0), (timerPrescaler = 0), (timerLength = 1), (timerEnable = false);
  (LCD_enabled = false), (LCD_lastmode = 1), (LCD_scan = 0);
  (PC = 0), (SP = 0), (IME = false), (cpu_halted = false);
  requestStop = false;

  loadData();
  run();
}
function loadData(){
  let lbj = localStorage.getItem(filename);
  if(lbj){
    let buf = new ArrayBuffer(lbj.length);
    let bufView = new Uint8Array(buf);
    for (let i = 0; i < lbj.length; i++) {
      bufView[i] = lbj.charCodeAt(i);
    }
    cartRAM = new Uint8Array(buf);
  }
}
function writeMem16(addr, dataH, dataL) {
  writeMem(addr, dataL);
  writeMem(addr + 1, dataH);
}
function readMem16(addr) {
  return [readMem(addr + 1), readMem(addr)];
}
function doMBC(addr, data) {
  switch (ROM[0x147]) {
    case 0:
      break;
    case 0x01:
    case 0x02:
    case 0x03:
      if (addr <= 0x1fff) {
        RAMenabled = (data & 0x0f) == 0xa;
      } else if (addr <= 0x3fff) {
        data &= 0x1f;
        if (data == 0) data = 1;

        ROMbank = (ROMbank & 0xe0) | (data & 0x1f);
        ROMbankoffset = ((ROMbank - 1) * 0x4000) % ROM.length;
      } else if (addr <= 0x5fff) {
        data &= 0x3;
        if (MBCRamMode == 0) {
          ROMbank = (ROMbank & 0x1f) | (data << 5);
          ROMbankoffset = ((ROMbank - 1) * 0x4000) % ROM.length;
        } else {
          RAMbank = data;
          RAMbankoffset = RAMbank * 0x2000 - 0xa000;
        }
      } else {
        MBCRamMode = data & 1;
        if (MBCRamMode == 0) {
          RAMbank = 0;
          RAMbankoffset = RAMbank * 0x2000 - 0xa000;
        } else {
          ROMbank &= 0x1f;
          ROMbankoffset = ((ROMbank - 1) * 0x4000) % ROM.length;
        }
      }

      break;
    case 0x05:
    case 0x06:
      if (addr <= 0x1fff) {
        if ((addr & 0x0100) == 0) RAMenabled = (data & 0x0f) == 0xa;
      } else if (addr <= 0x3fff) {
        data &= 0x0f;
        if (data == 0) data = 1;
        ROMbank = data;
        ROMbankoffset = ((ROMbank - 1) * 0x4000) % ROM.length;
      }
      break;

    case 0x11:
    case 0x12:
    case 0x13:
      if (addr <= 0x1fff) {
        RAMenabled = (data & 0x0f) == 0xa;
      } else if (addr <= 0x3fff) {
        if (data == 0) data = 1;
        ROMbank = data & 0x7f;
        ROMbankoffset = ((ROMbank - 1) * 0x4000) % ROM.length;
      } else if (addr <= 0x5fff) {
        if (data < 8) {
          RAMbank = data;
          RAMbankoffset = RAMbank * 0x2000 - 0xa000;
        } else {
        }
      } else {
      }
      break;
    case 0x19:
    case 0x1a:
    case 0x1b:
      if (addr <= 0x1fff) {
        RAMenabled = (data & 0x0f) == 0xa;
      } else if (addr <= 0x2fff) {
        ROMbank &= 0x100;
        ROMbank |= data;
        ROMbankoffset = (ROMbank - 1) * 0x4000;
        while (ROMbankoffset > ROM.length) ROMbankoffset -= ROM.length;
      } else if (addr <= 0x3fff) {
        ROMbank &= 0xff;
        if (data & 1) ROMbank += 0x100;
        ROMbankoffset = (ROMbank - 1) * 0x4000;
        while (ROMbankoffset > ROM.length) ROMbankoffset -= ROM.length;
      } else if (addr <= 0x5fff) {
        RAMbank = data & 0x0f;
        RAMbankoffset = RAMbank * 0x2000 - 0xa000;
      }
      break;

    default:
      throw Error("Unimplemented memory controller");
  }
}

