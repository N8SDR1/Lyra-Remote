/* Panadapter + waterfall for Lyra Remote.

   Lyra sends the receiver's raw I/Q as binary frames (type 0, float32,
   two channels). This page turns those into a spectrum. The radio's
   sample clock puts higher RF on the negative side of baseband, so a
   plain left-to-right FFT would mirror the band. Drawing uses
   RF = centre − baseband, which puts the low edge on the left. */
(function () {
  "use strict";

  var HEADER = 64;
  var FFT_N = 4096;
  var RING = 16384;
  var FFT_MS = 40;
  var TUNE_MS = 80;

  function fftRadix2(re, im) {
    var n = re.length;
    var j = 0;
    var i, m, size, half, i0, k, p, q;
    var tr, ti, wr, wi, wpr, wpi, nwr, theta;
    for (i = 0; i < n; i++) {
      if (i < j) {
        tr = re[i]; re[i] = re[j]; re[j] = tr;
        ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
      m = n >> 1;
      while (m >= 1 && j >= m) {
        j -= m;
        m >>= 1;
      }
      j += m;
    }
    for (size = 2; size <= n; size <<= 1) {
      half = size >> 1;
      theta = -2 * Math.PI / size;
      wpr = Math.cos(theta);
      wpi = Math.sin(theta);
      for (i0 = 0; i0 < n; i0 += size) {
        wr = 1;
        wi = 0;
        for (k = 0; k < half; k++) {
          p = i0 + k;
          q = p + half;
          tr = wr * re[q] - wi * im[q];
          ti = wr * im[q] + wi * re[q];
          re[q] = re[p] - tr;
          im[q] = im[p] - ti;
          re[p] += tr;
          im[p] += ti;
          nwr = wr * wpr - wi * wpi;
          wi = wr * wpi + wi * wpr;
          wr = nwr;
        }
      }
    }
  }

  function binForBb(bb, rate, n) {
    var k = Math.round(bb / rate * n);
    return ((k % n) + n) % n;
  }

  function hann(n) {
    var w = new Float64Array(n);
    var i;
    for (i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (n - 1)));
    return w;
  }

  function niceStep(span) {
    var raw = span / 8;
    if (!(raw > 0)) return 1000;
    var pow = Math.pow(10, Math.floor(Math.log10(raw)));
    var err = raw / pow;
    var mult = err >= 5 ? 5 : err >= 2 ? 2 : 1;
    return mult * pow;
  }

  function fmtTick(hz, step) {
    if (step >= 100000) return (hz / 1e6).toFixed(step >= 1000000 ? 1 : 2);
    if (step >= 1000) return (hz / 1e3).toFixed(0);
    return (hz / 1e3).toFixed(1);
  }

  function fmtMhz(hz, span) {
    var digits = span < 20000 ? 6 : span < 200000 ? 4 : 3;
    return (hz / 1e6).toFixed(digits) + " MHz";
  }

  function fmtSpan(hz) {
    if (hz >= 1000000) return (hz / 1e6).toFixed(hz % 1000000 ? 2 : 0) + " MHz";
    if (hz >= 1000) return (hz / 1e3).toFixed(hz % 1000 ? 1 : 0) + " kHz";
    return Math.round(hz) + " Hz";
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  var PALETTES = {
    lyra: {
      trace: "#00e5ff",
      fill: "rgba(0, 229, 255, 0.16)",
      pass: "rgba(0, 229, 255, 0.14)",
      stops: [[0, 6, 16, 24], [0.45, 8, 48, 72], [0.78, 0, 229, 255], [1, 255, 171, 71]]
    },
    heat: {
      trace: "#ffab47",
      fill: "rgba(255, 171, 71, 0.18)",
      pass: "rgba(255, 171, 71, 0.14)",
      stops: [[0, 0, 0, 0], [0.35, 120, 0, 0], [0.65, 255, 80, 0], [0.85, 255, 220, 40], [1, 255, 255, 255]]
    },
    gray: {
      trace: "#cdd9e5",
      fill: "rgba(205, 217, 229, 0.14)",
      pass: "rgba(205, 217, 229, 0.12)",
      stops: [[0, 4, 6, 8], [1, 230, 236, 242]]
    },
    green: {
      trace: "#34c759",
      fill: "rgba(52, 199, 89, 0.16)",
      pass: "rgba(52, 199, 89, 0.14)",
      stops: [[0, 0, 8, 4], [0.5, 0, 80, 30], [0.8, 40, 220, 90], [1, 220, 255, 220]]
    },
    ice: {
      trace: "#7ec8ff",
      fill: "rgba(126, 200, 255, 0.16)",
      pass: "rgba(126, 200, 255, 0.14)",
      stops: [[0, 2, 6, 16], [0.4, 10, 40, 90], [0.75, 80, 160, 255], [1, 230, 245, 255]]
    }
  };

  // Slider 0 is slow, 100 is fast. 50 matches the old middle setting.
  function speedUnit(v) {
    if (v === "fast") return 1;
    if (v === "slow") return 0;
    if (v === "med") return 0.5;
    var n = Number(v);
    if (!isFinite(n)) return 0.5;
    if (n > 1) n /= 100;
    if (n < 0) n = 0;
    if (n > 1) n = 1;
    return n;
  }

  function holdFromSpeed(v) {
    var t = speedUnit(v);
    if (t <= 0.5) return lerp(0.96, 0.82, t / 0.5);
    return lerp(0.82, 0.4, (t - 0.5) / 0.5);
  }

  function wfFromSpeed(v) {
    var t = speedUnit(v);
    if (t <= 0.5) return lerp(360, 90, t / 0.5);
    return lerp(90, 0, (t - 0.5) / 0.5);
  }

  function palRgb(name, t) {
    var stops = (PALETTES[name] || PALETTES.lyra).stops;
    var i;
    for (i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        var a = stops[i - 1];
        var b = stops[i];
        var u = (t - a[0]) / ((b[0] - a[0]) || 1);
        return [lerp(a[1], b[1], u) | 0, lerp(a[2], b[2], u) | 0, lerp(a[3], b[3], u) | 0];
      }
    }
    var last = stops[stops.length - 1];
    return [last[1], last[2], last[3]];
  }

  function Panadapter(canvas, readout) {
    this.canvas = canvas;
    this.readout = readout;
    this.onTune = null;
    this.onBandwidth = null;
    this.onSpan = null;
    this.bands = [];
    this.mode = "";
    this.hann = hann(FFT_N);
    this.iq = new Float32Array(RING * 2);
    this.re = new Float64Array(FFT_N);
    this.im = new Float64Array(FFT_N);
    this.sm = new Float64Array(FFT_N);
    this.sm.fill(-160);
    this.w = 0;
    this.filled = 0;
    this.dirty = false;
    this.haveSpec = false;
    this.lastFft = 0;
    this.rate = 0;
    this.center = null;
    this.vfo = null;
    this.filterLo = null;
    this.filterHi = null;
    this.preview = null;
    this.filterDrag = false;
    this.lastBw = null;
    this.lastBwAt = 0;
    this.connected = false;
    this.transmitting = false;
    this.viewSpan = 0;
    this.hoverHz = null;
    this.drag = null;
    this.lastSent = null;
    this.lastTuneAt = 0;
    this.dbTop = -40;
    this.dbBot = -120;
    this.scaleAuto = true;
    this._scaleSeeded = false;
    this.manualTop = -40;
    this.manualBot = -120;
    this.palette = "lyra";
    this.specHold = holdFromSpeed(50);
    this.wfMs = wfFromSpeed(50);
    this.traceSmooth = 25;
    this.lastWf = 0;
    this.onScale = null;
    this.wf = null;
    this.wfW = 0;
    this.wfH = 0;
    this.wfDirty = false;
    var saved = 0;
    try { saved = Number(localStorage.getItem("lyra-remote-span")) || 0; } catch (err) { saved = 0; }
    if (saved >= 8000) this.viewSpan = saved;
    var self = this;
    canvas.addEventListener("pointerdown", function (ev) { self._down(ev); });
    canvas.addEventListener("pointermove", function (ev) { self._move(ev); });
    canvas.addEventListener("pointerup", function (ev) { self._up(ev); });
    canvas.addEventListener("pointercancel", function () {
      self.drag = null;
      self.filterDrag = false;
      self.preview = null;
      self.canvas.style.cursor = "crosshair";
    });
    canvas.addEventListener("pointerleave", function () {
      if (!self.drag) {
        self.hoverHz = null;
        self._paintReadout();
      }
    });
    canvas.addEventListener("wheel", function (ev) { self._wheel(ev); }, { passive: false });
    this._tick = function () { self._frame(); };
    requestAnimationFrame(this._tick);
  }

  Panadapter.prototype.push = function (buffer) {
    if (!buffer || buffer.byteLength < HEADER + 8) return;
    var view = new DataView(buffer);
    if (view.getUint32(24, true) !== 0) return;
    if (view.getUint32(8, true) !== 3) return;
    if (view.getUint32(28, true) !== 2) return;
    var rate = view.getUint32(4, true);
    if (rate >= 8000 && rate <= 384000) this.rate = rate;
    var frames = Math.floor(view.getUint32(20, true) / 2);
    var maxFrames = Math.floor((buffer.byteLength - HEADER) / 8);
    if (frames > maxFrames) frames = maxFrames;
    if (frames < 1) return;
    var src = new Float32Array(buffer, HEADER, frames * 2);
    if (frames >= RING) {
      this.iq.set(src.subarray((frames - RING) * 2));
      this.w = 0;
      this.filled = RING;
    } else {
      var n1 = Math.min(frames, RING - this.w);
      this.iq.set(src.subarray(0, n1 * 2), this.w * 2);
      if (frames > n1) this.iq.set(src.subarray(n1 * 2), 0);
      this.w = (this.w + frames) % RING;
      this.filled = Math.min(RING, this.filled + frames);
    }
    this.dirty = true;
  };

  Panadapter.prototype.setDisplay = function (opts) {
    if (!opts) return;
    if (opts.scaleAuto != null) this.scaleAuto = !!opts.scaleAuto;
    if (opts.dbTop != null && isFinite(opts.dbTop)) this.manualTop = opts.dbTop;
    if (opts.dbBot != null && isFinite(opts.dbBot)) this.manualBot = opts.dbBot;
    if (!this.scaleAuto) {
      var hi = this.manualTop;
      var lo = this.manualBot;
      if (hi - lo < 10) lo = hi - 10;
      this.dbTop = hi;
      this.dbBot = lo;
    }
    if (opts.palette && PALETTES[opts.palette] && opts.palette !== this.palette) {
      this.palette = opts.palette;
      this.wf = null;
    }
    if (opts.specSpeed != null) this.specHold = holdFromSpeed(opts.specSpeed);
    if (opts.wfSpeed != null) this.wfMs = wfFromSpeed(opts.wfSpeed);
    if (opts.smooth != null && isFinite(opts.smooth)) {
      var smooth = opts.smooth;
      if (smooth < 0) smooth = 0;
      if (smooth > 100) smooth = 100;
      this.traceSmooth = smooth;
    }
  };

  Panadapter.prototype.setRadio = function (s) {
    this.connected = !!s.connected;
    this.center = s.dds != null ? s.dds : s.vfoA;
    this.vfo = s.vfoA;
    this.mode = (s.mode || "").toUpperCase();
    if (!this.filterDrag) {
      this.filterLo = s.filterLo;
      this.filterHi = s.filterHi;
    }
    this.transmitting = !!s.transmitting;
    if (!this.rate && s.iqRate) this.rate = s.iqRate;
    this._clampSpan();
    this._paintReadout();
  };

  Panadapter.prototype.setBands = function (bands) {
    this.bands = bands || [];
  };

  Panadapter.prototype.setSpan = function (hz) {
    var rate = this.rate || 0;
    var n = Number(hz) || 0;
    if (!n || (rate && n >= rate * 0.98)) this.viewSpan = 0;
    else this.viewSpan = Math.max(8000, n);
    this._clampSpan();
    this.wf = null;
    this._persistSpan();
    this._paintReadout();
    this._emitSpan();
  };

  Panadapter.prototype._persistSpan = function () {
    try {
      if (this.viewSpan) localStorage.setItem("lyra-remote-span", String(Math.round(this.viewSpan)));
      else localStorage.removeItem("lyra-remote-span");
    } catch (err) { /* private mode */ }
  };

  Panadapter.prototype._emitSpan = function () {
    if (this.onSpan) this.onSpan(this.viewSpan || 0);
  };

  Panadapter.prototype.clear = function () {
    this.filled = 0;
    this.w = 0;
    this.dirty = false;
    this.haveSpec = false;
    this._scaleSeeded = false;
    this.sm.fill(-160);
    this.wf = null;
    this.hoverHz = null;
    this.drag = null;
    this.filterDrag = false;
    this.preview = null;
    this.lastSent = null;
    this.lastBw = null;
    this.rate = 0;
    this.center = null;
    this.connected = false;
    this._paintReadout();
  };

  Panadapter.prototype._span = function () {
    var rate = this.rate || 0;
    if (!this.viewSpan || this.viewSpan >= rate) return rate;
    return this.viewSpan;
  };

  Panadapter.prototype._clampSpan = function () {
    var rate = this.rate || 0;
    if (!rate || !this.viewSpan) return;
    if (this.viewSpan >= rate) this.viewSpan = 0;
    else if (this.viewSpan < 8000) this.viewSpan = 8000;
  };

  Panadapter.prototype._layout = function () {
    var canvas = this.canvas;
    var dpr = window.devicePixelRatio || 1;
    var cssW = canvas.clientWidth || 0;
    var cssH = canvas.clientHeight || 0;
    var w = Math.max(1, Math.round(cssW * dpr));
    var h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      this.wf = null;
    }
    var specH = Math.round(h * 0.72);
    return {
      dpr: dpr,
      w: w,
      h: h,
      specH: specH,
      plotL: Math.round(8 * dpr),
      plotR: w - Math.round(8 * dpr),
      plotT: Math.round(8 * dpr),
      plotB: specH - Math.round(16 * dpr)
    };
  };

  Panadapter.prototype._frame = function () {
    var now = performance.now();
    if (this.dirty && this.filled >= FFT_N && now - this.lastFft >= FFT_MS) {
      this._fft();
      this.lastFft = now;
      this.dirty = false;
      this.haveSpec = true;
    }
    this._draw(this._layout());
    requestAnimationFrame(this._tick);
  };

  Panadapter.prototype._fft = function () {
    var n = FFT_N;
    var start = this.w - n;
    if (start < 0) start += RING;
    var i;
    for (i = 0; i < n; i++) {
      var f = (start + i) % RING;
      var win = this.hann[i];
      this.re[i] = this.iq[f * 2] * win;
      this.im[i] = this.iq[f * 2 + 1] * win;
    }
    fftRadix2(this.re, this.im);
    var scale = n * n;
    for (i = 0; i < n; i++) {
      var p = this.re[i] * this.re[i] + this.im[i] * this.im[i];
      var db = 10 * Math.log10(p / scale + 1e-20);
      var hold = this.specHold;
      if (db > this.sm[i]) this.sm[i] = db;
      else this.sm[i] = this.sm[i] * hold + db * (1 - hold);
    }
    this.wfDirty = true;
  };

  Panadapter.prototype._dbAtBb = function (bb) {
    var n = FFT_N;
    var pos = bb / this.rate * n;
    var k0 = Math.floor(pos);
    var frac = pos - k0;
    var i0 = ((k0 % n) + n) % n;
    var i1 = ((k0 + 1) % n + n) % n;
    return this.sm[i0] * (1 - frac) + this.sm[i1] * frac;
  };

  Panadapter.prototype._dbAtRf = function (rf, center) {
    return this._dbAtBb(center - rf);
  };

  function sideband(mode) {
    if (mode === "USB" || mode === "DIGU") return 1;
    if (mode === "LSB" || mode === "DIGL") return -1;
    return 0;
  }

  Panadapter.prototype._shownEdges = function () {
    if (this.preview) return this.preview;
    return { lo: this.filterLo, hi: this.filterHi };
  };

  Panadapter.prototype._sample = function (box, center, span) {
    var left = center - span / 2;
    var width = box.plotR - box.plotL;
    if (width < 8 || !this.rate) return null;
    if (!this._scaleBuf) this._scaleBuf = new Float64Array(4096);
    var buf = this._scaleBuf;
    var step = Math.max(1, Math.ceil((width + 1) / buf.length));
    var count = 0;
    var peak = -300;
    var x;
    for (x = 0; x <= width; x += step) {
      var db = this._dbAtRf(left + (x / width) * span, center);
      if (!isFinite(db)) continue;
      buf[count++] = db;
      if (db > peak) peak = db;
    }
    if (count < 8 || peak < -250) return null;
    buf.subarray(0, count).sort();
    var noise = buf[Math.floor((count - 1) * 0.50)];
    return { noise: noise, peak: peak };
  };

  Panadapter.prototype._range = function (box, center, span) {
    var sample = this._sample(box, center, span);
    if (!sample) return;
    if (!this.scaleAuto) return;
    var peak = sample.peak;
    var noise = sample.noise;
    var top = peak + 3;
    var bot = noise - 6;
    if (top - bot < 16) {
      var extra = 16 - (top - bot);
      bot -= extra * 0.25;
      top += extra * 0.75;
    }
    if (!this._scaleSeeded) {
      this.dbTop = top;
      this.dbBot = bot;
      this._scaleSeeded = true;
    } else {
      this.dbTop += 0.35 * (top - this.dbTop);
      this.dbBot += 0.35 * (bot - this.dbBot);
    }
    if (this.onScale) this.onScale(this.dbTop, this.dbBot);
  };

  Panadapter.prototype._y = function (db, box) {
    var t = (db - this.dbBot) / Math.max(1, this.dbTop - this.dbBot);
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return box.plotB - t * (box.plotB - box.plotT);
  };

  Panadapter.prototype._xOfRf = function (rf, box, center, span) {
    var left = center - span / 2;
    return box.plotL + (rf - left) / span * (box.plotR - box.plotL);
  };

  Panadapter.prototype._rfAtX = function (x, box, center, span) {
    var frac = (x - box.plotL) / Math.max(1, box.plotR - box.plotL);
    if (frac < 0) frac = 0;
    if (frac > 1) frac = 1;
    return center - span / 2 + frac * span;
  };

  Panadapter.prototype._draw = function (box) {
    var canvas = this.canvas;
    var ctx = canvas.getContext("2d");
    var dpr = box.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#10141c";
    ctx.fillRect(0, 0, box.w, box.h);
    var center = this.center;
    var span = this._span();
    if (!this.connected || center == null || !span || box.plotR <= box.plotL) {
      this._message(ctx, box, this.connected ? "Waiting for spectrum" : "Connect to see the band");
      return;
    }
    if (this.haveSpec) {
      this._range(box, center, span);
      this._trace(ctx, box, center, span);
      this._waterfall(ctx, box, center, span);
    } else {
      this._message(ctx, box, "Waiting for spectrum");
    }
    this._grid(ctx, box, center, span);
    this._passband(ctx, box, center, span);
    this._bandEdges(ctx, box, center, span);
    this._marker(ctx, box, center, span);
  };

  Panadapter.prototype._message = function (ctx, box, text) {
    ctx.fillStyle = "#5a7080";
    ctx.font = Math.round(13 * box.dpr) + "px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, (box.plotL + box.plotR) / 2, (box.plotT + box.plotB) / 2);
  };

  Panadapter.prototype._smoothLine = function (src, dst, n, dpr) {
    var amount = this.traceSmooth;
    if (!(amount > 0)) {
      dst.set(src.subarray(0, n));
      return;
    }
    var tau = Math.max(1, (amount / 100) * 16 * (dpr || 1));
    var alpha = 1 - Math.exp(-1 / tau);
    var i;
    var prev = src[0];
    for (i = 0; i < n; i++) {
      prev = alpha * src[i] + (1 - alpha) * prev;
      dst[i] = prev;
    }
    prev = dst[n - 1];
    for (i = n - 1; i >= 0; i--) {
      prev = alpha * dst[i] + (1 - alpha) * prev;
      dst[i] = prev;
    }
  };

  Panadapter.prototype._trace = function (ctx, box, center, span) {
    var left = center - span / 2;
    var width = box.plotR - box.plotL;
    var n = Math.floor(width) + 1;
    if (n < 2) return;
    if (!this._traceDb || this._traceDb.length < n) {
      this._traceDb = new Float64Array(n);
      this._traceSm = new Float64Array(n);
    }
    var raw = this._traceDb;
    var smooth = this._traceSm;
    var x;
    for (x = 0; x < n; x++) {
      raw[x] = this._dbAtRf(left + (x / (n - 1)) * span, center);
    }
    this._smoothLine(raw, smooth, n, box.dpr);
    ctx.beginPath();
    for (x = 0; x < n; x++) {
      var y = this._y(smooth[x], box);
      if (x === 0) ctx.moveTo(box.plotL, y);
      else ctx.lineTo(box.plotL + x, y);
    }
    var pal = PALETTES[this.palette] || PALETTES.lyra;
    ctx.strokeStyle = pal.trace;
    ctx.lineWidth = Math.max(1, box.dpr);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.lineTo(box.plotR, box.plotB);
    ctx.lineTo(box.plotL, box.plotB);
    ctx.closePath();
    ctx.fillStyle = pal.fill;
    ctx.fill();
  };

  Panadapter.prototype._waterfall = function (ctx, box, center, span) {
    var wfH = box.h - box.specH;
    if (wfH < 4) return;
    var width = box.plotR - box.plotL;
    if (!this.wf || this.wfW !== width || this.wfH !== wfH) {
      this.wf = ctx.createImageData(width, wfH);
      this.wfW = width;
      this.wfH = wfH;
      this.wfDirty = true;
    }
    if (this.wfDirty && this.wfMs > 0 && performance.now() - this.lastWf < this.wfMs) {
      ctx.putImageData(this.wf, box.plotL, box.specH);
      return;
    }
    if (!this.wfDirty) {
      ctx.putImageData(this.wf, box.plotL, box.specH);
      return;
    }
    this.wfDirty = false;
    this.lastWf = performance.now();
    var data = this.wf.data;
    var rowBytes = width * 4;
    data.copyWithin(rowBytes, 0);
    var left = center - span / 2;
    var x;
    for (x = 0; x < width; x++) {
      var db = this._dbAtRf(left + (x / Math.max(1, width - 1)) * span, center);
      var t = (db - this.dbBot) / Math.max(1, this.dbTop - this.dbBot);
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      var rgb = palRgb(this.palette, t);
      var o = x * 4;
      data[o] = rgb[0];
      data[o + 1] = rgb[1];
      data[o + 2] = rgb[2];
      data[o + 3] = 255;
    }
    ctx.putImageData(this.wf, box.plotL, box.specH);
  };

  Panadapter.prototype._grid = function (ctx, box, center, span) {
    var left = center - span / 2;
    var step = niceStep(span);
    var first = Math.ceil(left / step) * step;
    ctx.font = Math.round(11 * box.dpr) + "px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.lineWidth = 1;
    var hz;
    for (hz = first; hz < left + span; hz += step) {
      var x = this._xOfRf(hz, box, center, span);
      ctx.strokeStyle = "rgba(90, 112, 128, 0.35)";
      ctx.beginPath();
      ctx.moveTo(x, box.plotT);
      ctx.lineTo(x, box.plotB);
      ctx.stroke();
      ctx.fillStyle = "#5a7080";
      ctx.fillText(fmtTick(hz, step), x, box.plotB + 2);
    }
  };

  Panadapter.prototype._passband = function (ctx, box, center, span) {
    var edges = this._shownEdges();
    if (this.vfo == null || edges.lo == null || edges.hi == null) return;
    var a = this._xOfRf(this.vfo + edges.lo, box, center, span);
    var b = this._xOfRf(this.vfo + edges.hi, box, center, span);
    var x0 = Math.max(box.plotL, Math.min(a, b));
    var x1 = Math.min(box.plotR, Math.max(a, b));
    if (x1 <= x0) return;
    ctx.fillStyle = (PALETTES[this.palette] || PALETTES.lyra).pass;
    ctx.fillRect(x0, box.plotT, x1 - x0, box.plotB - box.plotT);
  };

  Panadapter.prototype._bandEdges = function (ctx, box, center, span) {
    var bands = this.bands;
    if (!bands || !bands.length) return;
    var left = center - span / 2;
    var right = left + span;
    ctx.save();
    ctx.lineWidth = Math.max(1, box.dpr);
    ctx.setLineDash([5 * box.dpr, 4 * box.dpr]);
    ctx.strokeStyle = "rgba(0, 229, 255, 0.55)";
    ctx.fillStyle = "rgba(0, 229, 255, 0.9)";
    ctx.font = Math.round(11 * box.dpr) + "px Segoe UI, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    var i, b, x, visLo, visHi, labelRf;
    for (i = 0; i < bands.length; i++) {
      b = bands[i];
      if (b.hi < left || b.lo > right) continue;
      if (b.lo >= left && b.lo <= right) {
        x = this._xOfRf(b.lo, box, center, span);
        ctx.beginPath();
        ctx.moveTo(x, box.plotT);
        ctx.lineTo(x, box.plotB);
        ctx.stroke();
      }
      if (b.hi >= left && b.hi <= right) {
        x = this._xOfRf(b.hi, box, center, span);
        ctx.beginPath();
        ctx.moveTo(x, box.plotT);
        ctx.lineTo(x, box.plotB);
        ctx.stroke();
      }
      visLo = Math.max(b.lo, left);
      visHi = Math.min(b.hi, right);
      if (visHi - visLo < span * 0.04) continue;
      labelRf = visLo + Math.min(span * 0.02, (visHi - visLo) * 0.15);
      x = this._xOfRf(labelRf, box, center, span);
      ctx.fillText(b.name, x + 4 * box.dpr, box.plotT + 3 * box.dpr);
    }
    ctx.restore();
  };

  Panadapter.prototype._marker = function (ctx, box, center, span) {
    if (this.vfo == null) return;
    var x = this._xOfRf(this.vfo, box, center, span);
    if (x < box.plotL || x > box.plotR) return;
    ctx.strokeStyle = this.transmitting ? "#ff4136" : "#ffab47";
    ctx.lineWidth = Math.max(1, box.dpr);
    ctx.beginPath();
    ctx.moveTo(x, box.plotT);
    ctx.lineTo(x, box.h);
    ctx.stroke();
  };

  Panadapter.prototype._eventX = function (ev) {
    var rect = this.canvas.getBoundingClientRect();
    return (ev.clientX - rect.left) / Math.max(1, rect.width) * this.canvas.width;
  };

  Panadapter.prototype._inPlot = function (x, box) {
    return x >= box.plotL && x <= box.plotR;
  };

  Panadapter.prototype._edgeHit = function (x, box) {
    var edges = this._shownEdges();
    if (this.vfo == null || edges.lo == null || edges.hi == null || !this._span()) return null;
    var span = this._span();
    var xl = this._xOfRf(this.vfo + edges.lo, box, this.center, span);
    var xh = this._xOfRf(this.vfo + edges.hi, box, this.center, span);
    var slop = 8 * box.dpr;
    var side = sideband(this.mode);
    if (side > 0) return Math.abs(x - xh) <= slop ? "hi" : null;
    if (side < 0) return Math.abs(x - xl) <= slop ? "lo" : null;
    var dl = Math.abs(x - xl);
    var dh = Math.abs(x - xh);
    if (dl <= slop && dl <= dh) return "lo";
    if (dh <= slop) return "hi";
    return null;
  };

  Panadapter.prototype._applyEdge = function (edge, rf) {
    var lo = this.filterLo;
    var hi = this.filterHi;
    if (lo == null || hi == null || this.vfo == null) return null;
    var off = rf - this.vfo;
    var side = sideband(this.mode);
    var bw;
    var floor;
    if (side > 0 && edge === "hi") {
      bw = Math.round(off);
      floor = Math.max(10, Math.round(lo) + 10);
      if (bw < floor) bw = floor;
      if (bw > 20000) bw = 20000;
      this.preview = { lo: lo, hi: bw };
      return bw;
    }
    if (side < 0 && edge === "lo") {
      bw = Math.round(-off);
      floor = Math.max(10, Math.round(-hi) + 10);
      if (bw < floor) bw = floor;
      if (bw > 20000) bw = 20000;
      this.preview = { lo: -bw, hi: hi };
      return bw;
    }
    if (side === 0) {
      var mid = (lo + hi) / 2;
      var half = Math.abs(off - mid);
      if (half < 5) half = 5;
      if (half > 10000) half = 10000;
      bw = Math.round(half * 2);
      if (bw < 10) bw = 10;
      if (bw > 20000) bw = 20000;
      half = bw / 2;
      this.preview = { lo: mid - half, hi: mid + half };
      return bw;
    }
    return null;
  };

  Panadapter.prototype._down = function (ev) {
    if (!this.connected || this.center == null || !this._span()) return;
    var box = this._layout();
    var x = this._eventX(ev);
    if (!this._inPlot(x, box)) return;
    try { this.canvas.setPointerCapture(ev.pointerId); } catch (err) { /* synthetic events */ }
    var edge = this._edgeHit(x, box);
    if (edge) {
      this.filterDrag = true;
      this.drag = { kind: "filter", edge: edge, x: x, moved: false };
      this.canvas.style.cursor = "ew-resize";
      return;
    }
    this.filterDrag = false;
    var span = this._span();
    this.drag = {
      kind: "tune",
      x: x,
      rf: this._rfAtX(x, box, this.center, span),
      span: span,
      center: this.center,
      moved: false
    };
  };

  Panadapter.prototype._move = function (ev) {
    var box = this._layout();
    var x = this._eventX(ev);
    if (!this.drag) {
      if (this.connected && this.center != null && this._span() && this._inPlot(x, box)) {
        this.hoverHz = this._rfAtX(x, box, this.center, this._span());
        this.canvas.style.cursor = this._edgeHit(x, box) ? "ew-resize" : "crosshair";
      } else {
        this.hoverHz = null;
        this.canvas.style.cursor = "crosshair";
      }
      this._paintReadout();
      return;
    }
    if (this.drag.kind === "filter") {
      var dxf = x - this.drag.x;
      if (Math.abs(dxf) > 3 * box.dpr) this.drag.moved = true;
      var rf = this._rfAtX(x, box, this.center, this._span());
      var bw = this._applyEdge(this.drag.edge, rf);
      this.hoverHz = rf;
      this._paintReadout();
      if (this.drag.moved && bw != null) this._emitBw(bw, false);
      return;
    }
    var dx = x - this.drag.x;
    if (Math.abs(dx) > 3 * box.dpr) this.drag.moved = true;
    var width = Math.max(1, box.plotR - box.plotL);
    var hz = this.drag.rf + dx / width * this.drag.span;
    this.hoverHz = hz;
    this._paintReadout();
    if (this.drag.moved) this._emitTune(hz, false);
  };

  Panadapter.prototype._up = function (ev) {
    if (!this.drag) return;
    var box = this._layout();
    var x = this._eventX(ev);
    if (this.drag.kind === "filter") {
      if (this.drag.moved) {
        var rf = this._rfAtX(x, box, this.center, this._span());
        var bw = this._applyEdge(this.drag.edge, rf);
        if (bw != null) this._emitBw(bw, true);
      }
      this.drag = null;
      this.filterDrag = false;
      this.preview = null;
      this.canvas.style.cursor = "crosshair";
      this._paintReadout();
      return;
    }
    var width = Math.max(1, box.plotR - box.plotL);
    var hz = this.drag.moved
      ? this.drag.rf + (x - this.drag.x) / width * this.drag.span
      : this.drag.rf;
    this.drag = null;
    this.hoverHz = hz;
    this._paintReadout();
    this._emitTune(hz, true);
  };

  Panadapter.prototype._emitBw = function (bw, force) {
    var n = Math.round(bw);
    if (!isFinite(n)) return;
    var now = performance.now();
    if (!force && now - this.lastBwAt < TUNE_MS) return;
    if (n === this.lastBw) return;
    this.lastBw = n;
    this.lastBwAt = now;
    if (this.onBandwidth) this.onBandwidth(n);
  };

  Panadapter.prototype._emitTune = function (hz, force) {
    var n = Math.round(hz);
    if (!isFinite(n)) return;
    var now = performance.now();
    if (!force && now - this.lastTuneAt < TUNE_MS) return;
    if (n === this.lastSent) return;
    this.lastSent = n;
    this.lastTuneAt = now;
    if (this.onTune) this.onTune(n);
  };

  Panadapter.prototype._wheel = function (ev) {
    if (!this.rate) return;
    ev.preventDefault();
    var span = this._span();
    var next = ev.deltaY > 0 ? span * 1.25 : span / 1.25;
    var min = Math.min(this.rate, 8000);
    if (next < min) next = min;
    if (next > this.rate * 0.98) next = this.rate;
    this.viewSpan = next >= this.rate ? 0 : next;
    this.wf = null;
    this._persistSpan();
    this._paintReadout();
    this._emitSpan();
  };

  Panadapter.prototype._paintReadout = function () {
    if (!this.readout) return;
    var span = this._span();
    var parts = [];
    if (this.hoverHz != null && span) parts.push(fmtMhz(this.hoverHz, span));
    if (span) parts.push(fmtSpan(span) + " span");
    this.readout.textContent = parts.join("  ·  ");
  };

  if (typeof window !== "undefined") window.Panadapter = Panadapter;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { fftRadix2: fftRadix2, binForBb: binForBb };
  }
})();
