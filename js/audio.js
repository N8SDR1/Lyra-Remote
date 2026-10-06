/* Plays Lyra's TCI receive-audio frames in the browser.
   A frame is a 64-byte little-endian header plus samples.
   Type 1 is receive audio. The header rate is the playback rate. */
(function () {
  "use strict";

  var HEADER = 64;
  var LEAD = 0.18;
  var CHUNK_S = 0.02;

  function RxAudio() {
    this.ctx = null;
    this.gain = null;
    this.level = 0.7;
    this.pending = [];
    this.pendingSamples = 0;
    this.nextTime = 0;
    this.timer = null;
    this.primed = false;
    this.rate = 48000;
    this.active = false;
    this.onState = null;
  }

  RxAudio.prototype.setLevel = function (linear) {
    var v = Number(linear);
    if (!isFinite(v)) v = 0;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    this.level = v;
    if (this.gain) this.gain.gain.value = v;
  };

  RxAudio.prototype.start = function () {
    var self = this;
    this.stop();
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return Promise.reject(new Error("no audio"));
    this.ctx = new Ctx();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = this.level;
    this.gain.connect(this.ctx.destination);
    this.active = true;
    this._state("Buffering");
    this.timer = setInterval(function () { self._pump(); }, 20);
    return this.ctx.resume();
  };

  RxAudio.prototype.stop = function () {
    this.active = false;
    this.primed = false;
    this.pending = [];
    this.pendingSamples = 0;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.ctx) {
      var ctx = this.ctx;
      this.ctx = null;
      this.gain = null;
      ctx.close();
    }
    this._state("Off");
  };

  RxAudio.prototype.push = function (buffer) {
    if (!this.active) return;
    var frame = decode(buffer);
    if (!frame) return;
    if (frame.rate > 0) this.rate = frame.rate;
    this.pending.push(frame.mono);
    this.pendingSamples += frame.mono.length;
    var cap = this.rate;
    while (this.pendingSamples > cap && this.pending.length > 1) {
      var drop = this.pending.shift();
      this.pendingSamples -= drop.length;
    }
  };

  RxAudio.prototype._pump = function () {
    var ctx = this.ctx;
    if (!ctx || !this.active) return;
    if (!this.primed) {
      if (this.pendingSamples < this.rate * LEAD) return;
      this.primed = true;
      this.nextTime = ctx.currentTime + 0.05;
      this._state("On");
    }
    if (this.nextTime < ctx.currentTime) {
      this.primed = false;
      this._state("Buffering");
      return;
    }
    var chunk = Math.max(1, Math.round(this.rate * CHUNK_S));
    var horizon = ctx.currentTime + 0.35;
    while (this.nextTime < horizon && this.pendingSamples >= chunk) {
      var data = this._take(chunk);
      var buf = ctx.createBuffer(1, data.length, this.rate);
      buf.getChannelData(0).set(data);
      var src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gain);
      src.start(this.nextTime);
      this.nextTime += data.length / this.rate;
    }
  };

  RxAudio.prototype._take = function (n) {
    var out = new Float32Array(n);
    var filled = 0;
    while (filled < n) {
      var head = this.pending[0];
      var need = n - filled;
      if (head.length <= need) {
        out.set(head, filled);
        filled += head.length;
        this.pending.shift();
      } else {
        out.set(head.subarray(0, need), filled);
        this.pending[0] = head.subarray(need);
        filled = n;
      }
    }
    this.pendingSamples -= n;
    return out;
  };

  RxAudio.prototype._state = function (text) {
    if (this.onState) this.onState(text);
  };

  function decode(buffer) {
    if (!buffer || buffer.byteLength < HEADER) return null;
    var hdr = new DataView(buffer);
    var rate = hdr.getUint32(4, true);
    var fmt = hdr.getUint32(8, true);
    var length = hdr.getUint32(20, true);
    var type = hdr.getUint32(24, true);
    var chans = hdr.getUint32(28, true);
    if (type !== 1 || length === 0) return null;
    if (chans !== 1 && chans !== 2) chans = 1;
    var bps = fmt === 0 ? 2 : fmt === 1 ? 3 : 4;
    var view = new DataView(buffer, HEADER);
    var scalars = Math.floor(view.byteLength / bps);
    if (length < scalars) scalars = length;
    var frames = Math.floor(scalars / chans);
    if (frames <= 0) return null;
    var mono = new Float32Array(frames);
    for (var i = 0; i < frames; i++) {
      mono[i] = scalar(view, i * chans * bps, fmt);
    }
    return { mono: mono, rate: rate };
  }

  function scalar(view, offset, fmt) {
    if (fmt === 3) return view.getFloat32(offset, true);
    if (fmt === 0) return view.getInt16(offset, true) / 32768;
    if (fmt === 2) return view.getInt32(offset, true) / 2147483648;
    var s = view.getUint8(offset) |
      (view.getUint8(offset + 1) << 8) |
      (view.getUint8(offset + 2) << 16);
    if (s & 0x800000) s |= 0xFF000000;
    return (s | 0) / 8388608;
  }

  window.RxAudio = RxAudio;
})();
