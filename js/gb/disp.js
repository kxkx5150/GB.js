"use strict";
var dpixels = new Uint8Array(160 * 144);
var dctx = document.getElementById("output").getContext("2d");
var dImgData = dctx.getImageData(0, 0, 160, 144);
initCanvas();
const pixelDecoder = [];
for (var d1 = 0; d1 < 256; d1++) {
  pixelDecoder[d1] = [];
  for (var d2 = 0; d2 < 256; d2++)
    pixelDecoder[d1][d2] = [
      ((d1 & 128) + 2 * (d2 & 128)) >> 7,
      ((d1 & 64) + 2 * (d2 & 64)) >> 6,
      ((d1 & 32) + 2 * (d2 & 32)) >> 5,
      ((d1 & 16) + 2 * (d2 & 16)) >> 4,
      ((d1 & 8) + 2 * (d2 & 8)) >> 3,
      ((d1 & 4) + 2 * (d2 & 4)) >> 2,
      ((d1 & 2) + 2 * (d2 & 2)) >> 1,
      (d1 & 1) + 2 * (d2 & 1),
    ];
}

function disp(cycles) {
  if (LCD_enabled) {
    LCD_scan += cycles;

    var mode = 0,
      coincidence = false,
      draw = false;
    if (LCD_scan <= 80) mode = 2;
    else if (LCD_scan <= 252) mode = 3;
    else if (LCD_scan < 456) {
      draw = LCD_lastmode != 0;
      mode = 0;
    } else {
      mode = 2;
      LCD_scan -= 456;
      MEM[0xff44]++;
      if (MEM[0xff44] > 153) MEM[0xff44] = 0;
      coincidence = MEM[0xff44] == MEM[0xff45];
    }
    if (MEM[0xff44] >= 144) mode = 1;
    else if (draw) {
      var LY = MEM[0xff44];
      var dpy = LY * 160;
      var drawWindow = MEM[0xff40] & (1 << 5) && LY >= MEM[0xff4a];
      var bgStopX = drawWindow ? MEM[0xff4b] - 7 : 160;

      var baseTileOffset, tileSigned;

      if (MEM[0xff40] & (1 << 4)) {
        baseTileOffset = 0x8000;
        tileSigned = false;
      } else {
        baseTileOffset = 0x9000;
        tileSigned = true;
      }
      var bgpalette = [
        MEM[0xff47] & 3,
        (MEM[0xff47] >> 2) & 3,
        (MEM[0xff47] >> 4) & 3,
        (MEM[0xff47] >> 6) & 3,
      ];
      function grabTile(n, offset) {
        if (tileSigned && n > 127) {
          var tileptr = offset + (n - 256) * 16;
        } else {
          var tileptr = offset + n * 16;
        }
        var d1 = MEM[tileptr],
          d2 = MEM[tileptr + 1];
        return pixelDecoder[d1][d2];
      }
      if (MEM[0xff40] & 1) {
        var bgTileMapAddr = MEM[0xff40] & (1 << 3) ? 0x9c00 : 0x9800;

        var x = MEM[0xff43] >> 3;
        var xoff = MEM[0xff43] & 7;
        var y = (LY + MEM[0xff42]) & 0xff;

        bgTileMapAddr += ~~(y / 8) * 32;
        var tileOffset = baseTileOffset + (y & 7) * 2;
        var pix = grabTile(MEM[bgTileMapAddr + x], tileOffset);
        for (var i = 0; i < bgStopX; i++) {
          dpixels[dpy + i] = bgpalette[pix[xoff++]];
          if (xoff == 8) {
            x = (x + 1) & 0x1f;
            pix = grabTile(MEM[bgTileMapAddr + x], tileOffset);
            xoff = 0;
          }
        }
      }

      if (drawWindow) {
        var wdTileMapAddr = MEM[0xff40] & (1 << 6) ? 0x9c00 : 0x9800;
        var xoff = 0;
        var y = LY - MEM[0xff4a];
        wdTileMapAddr += ~~(y / 8) * 32;
        var tileOffset = baseTileOffset + (y & 7) * 2;
        pix = grabTile(MEM[wdTileMapAddr], tileOffset);
        for (var i = Math.max(0, bgStopX); i < 160; i++) {
          dpixels[dpy + i] = bgpalette[pix[xoff++]];
          if (xoff == 8) {
            pix = grabTile(MEM[++wdTileMapAddr], tileOffset);
            xoff = 0;
          }
        }
      }
      if (MEM[0xff40] & 2) {
        var height, tileNumMask;
        if (MEM[0xff40] & (1 << 2)) {
          height = 16;
          tileNumMask = 0xfe;
        } else {
          height = 8;
          tileNumMask = 0xff;
        }
        var OBP0 = [0, (MEM[0xff48] >> 2) & 3, (MEM[0xff48] >> 4) & 3, (MEM[0xff48] >> 6) & 3],
          OBP1 = [0, (MEM[0xff49] >> 2) & 3, (MEM[0xff49] >> 4) & 3, (MEM[0xff49] >> 6) & 3],
          background = bgpalette[0];

        for (var i = 0xfe9c; i >= 0xfe00; i -= 4) {
          var ypos = MEM[i] - 16 + height;
          if (LY >= ypos - height && LY < ypos) {
            var tileNum = 0x8000 + (MEM[i + 2] & tileNumMask) * 16,
              xpos = MEM[i + 1],
              att = MEM[i + 3];

            var palette = att & (1 << 4) ? OBP1 : OBP0;
            var behind = att & (1 << 7);

            if (att & (1 << 6)) {
              tileNum += (ypos - LY - 1) * 2;
            } else {
              tileNum += (LY - ypos + height) * 2;
            }
            var d1 = MEM[tileNum],
              d2 = MEM[tileNum + 1],
              row = pixelDecoder[d1][d2];
            if (att & (1 << 5)) {
              if (behind) {
                for (var j = 0; j < Math.min(xpos, 8); j++) {
                  if (dpixels[dpy + xpos - 1 - j] == background && row[j])
                    dpixels[dpy + xpos - 1 - j] = palette[row[j]];
                }
              } else {
                for (var j = 0; j < Math.min(xpos, 8); j++) {
                  if (row[j]) dpixels[dpy + xpos - (j + 1)] = palette[row[j]];
                }
              }
            } else {
              if (behind) {
                for (var j = Math.max(8 - xpos, 0); j < 8; j++) {
                  if (dpixels[dpy + xpos - 8 + j] == background && row[j])
                    dpixels[dpy + xpos - 8 + j] = palette[row[j]];
                }
              } else {
                for (var j = Math.max(8 - xpos, 0); j < 8; j++) {
                  if (row[j]) dpixels[dpy + xpos - 8 + j] = palette[row[j]];
                }
              }
            }
          }
        }
      }
    }

    if (coincidence) {
      if (MEM[0xff41] & (1 << 6)) {
        MEM[0xff0f] |= 1 << 1;
        MEM[0xff41] |= 1 << 2;
      }
    } else MEM[0xff41] &= 0xfb;
    if (LCD_lastmode != mode) {
      if (mode == 0) {
        if (MEM[0xff41] & (1 << 3)) MEM[0xff0f] |= 1 << 1;
      } else if (mode == 1) {
        if (MEM[0xff41] & (1 << 4)) MEM[0xff0f] |= 1 << 1;

        if (MEM[0xffff] & 1) MEM[0xff0f] |= 1 << 0;
        renderDisplayCanvas();
      } else if (mode == 2) {
        if (MEM[0xff41] & (1 << 5)) MEM[0xff0f] |= 1 << 1;
      }
      MEM[0xff41] &= 0xf8;
      MEM[0xff41] += mode;
      LCD_lastmode = mode;
    }
  }
}
function renderDisplayCanvas() {
  var R = [224, 136, 52, 8],
    G = [248, 192, 104, 24],
    B = [208, 112, 86, 32];
  for (var i = 0, j = 0; i < 160 * 144; i++) {
    dImgData.data[j++] = R[dpixels[i]];
    dImgData.data[j++] = G[dpixels[i]];
    dImgData.data[j] = B[dpixels[i]];
    j += 2;
  }
  dctx.putImageData(dImgData, 0, 0);
}
function initCanvas() {
  for (var i = 0; i < 160 * 144; i++) {
    dImgData.data[4 * i + 3] = 255;
  }
  dctx.putImageData(dImgData, 0, 0);
}
