/* TCI client. Lyra sends "command:args;" lines and a few bare words
   (start, ready). Binary frames are handed to onBinary. */
(function () {
  "use strict";

  var MODES = ["LSB", "USB", "CW", "CWU", "CWL", "AM", "DIGU", "DIGL", "FM", "SAM", "DSB"];

  function blankState() {
    return {
      connected: false,
      ready: false,
      protocol: "",
      device: "",
      vfoA: null,
      vfoB: null,
      rx2: null,
      mode: "",
      modeRx2: "",
      split: false,
      sub: false,
      transmitting: false,
      smeter: null,
      smeterRx2: null,
      filterLo: null,
      filterHi: null,
      radioMute: false,
      dds: null,
      iqRate: null
    };
  }

  function TciClient() {
    this.ws = null;
    this.state = blankState();
    this.onChange = null;
    this.onLog = null;
    this.onStatus = null;
    this.onBinary = null;
    this._buf = "";
    this._iqOn = false;
  }

  TciClient.MODES = MODES;

  TciClient.prototype.connect = function (url) {
    this.disconnect();
    var self = this;
    var opened = false;
    this._status("Connecting");
    var ws;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this._status("Edge will not open the radio link from a file. Double-click Open Lyra Remote.");
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = function () {
      opened = true;
      self.state.connected = true;
      self._status("Connected");
      self._emit();
    };
    ws.onclose = function () {
      self._iqOn = false;
      self.state = blankState();
      self._status(opened
        ? "Disconnected"
        : "Lyra did not answer. In Lyra, Settings → Network, turn TCI server running on (port 40001).");
      self._emit();
      if (self.ws === ws) self.ws = null;
    };
    ws.onerror = function () {
      if (!opened) {
        self._status("Lyra did not answer. In Lyra, Settings → Network, turn TCI server running on (port 40001).");
      }
    };
    ws.onmessage = function (ev) {
      if (typeof ev.data === "string") self._ingest(ev.data);
      else if (ev.data instanceof ArrayBuffer && self.onBinary) self.onBinary(ev.data);
    };
  };

  TciClient.prototype.disconnect = function () {
    this.stopIq();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this.state = blankState();
    this._status("Disconnected");
    this._emit();
  };

  TciClient.prototype.send = function (line) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    var text = line.charAt(line.length - 1) === ";" ? line : line + ";";
    this.ws.send(text);
    this._log("→ " + text);
  };

  TciClient.prototype.tuneRx1 = function (hz) {
    var n = Math.round(Number(hz));
    if (!isFinite(n) || n <= 0) return;
    this.send("vfo:0,0," + n);
  };

  TciClient.prototype.setMode = function (mode) {
    this.send("modulation:0," + mode);
  };

  TciClient.prototype.setSub = function (on) {
    this.send("rx_enable:1," + (on ? "true" : "false"));
  };

  TciClient.prototype.setSplit = function (on) {
    this.send("split_enable:0," + (on ? "true" : "false"));
  };

  TciClient.prototype.startAudio = function () {
    this.send("audio_start:0");
  };

  TciClient.prototype.stopAudio = function () {
    this.send("audio_stop:0");
  };

  TciClient.prototype.setFilterWidth = function (hz) {
    var n = Math.round(Number(hz));
    if (!isFinite(n) || n <= 0) return;
    this.send("rx_filter_band:0,0," + n);
  };

  TciClient.prototype.setRadioMute = function (on) {
    this.send("rx_mute:0," + (on ? "true" : "false"));
  };

  TciClient.prototype.startIq = function () {
    if (this._iqOn) return;
    this._iqOn = true;
    this.send("iq_start:0");
  };

  TciClient.prototype.stopIq = function () {
    if (!this._iqOn) return;
    this._iqOn = false;
    this.send("iq_stop:0");
  };

  TciClient.prototype._ingest = function (chunk) {
    this._buf += chunk;
    var parts = this._buf.split(";");
    this._buf = parts.pop();
    for (var i = 0; i < parts.length; i++) {
      var line = parts[i].trim();
      if (!line) continue;
      this._log("← " + line);
      this._apply(line);
    }
  };

  TciClient.prototype._apply = function (line) {
    var colon = line.indexOf(":");
    var cmd = (colon < 0 ? line : line.slice(0, colon)).trim().toLowerCase();
    var args = colon < 0 ? [] : line.slice(colon + 1).split(",");
    var s = this.state;

    if (cmd === "ready") {
      s.ready = true;
      this.send("rx_sensors_enable:true");
      this._emit();
      return;
    }
    if (cmd === "protocol") {
      s.protocol = args.join(",");
    } else if (cmd === "device") {
      s.device = args[0] || "";
    } else if (cmd === "vfo") {
      var hz = num(args[2]);
      if (args[0] === "0" && args[1] === "0") s.vfoA = hz;
      else if (args[0] === "0" && args[1] === "1") s.vfoB = hz;
      else if (args[0] === "1" && args[1] === "0") s.rx2 = hz;
    } else if (cmd === "modulation") {
      if (args[0] === "0") s.mode = (args[1] || "").toUpperCase();
      else if (args[0] === "1") s.modeRx2 = (args[1] || "").toUpperCase();
    } else if (cmd === "split_enable") {
      s.split = truth(args[1]);
    } else if (cmd === "rx_enable" && args[0] === "1") {
      s.sub = truth(args[1]);
    } else if (cmd === "trx") {
      s.transmitting = truth(args[1]);
    } else if (cmd === "rx_channel_sensors") {
      var dbm = num(args[2]);
      if (args[0] === "0") s.smeter = dbm;
      else if (args[0] === "1") s.smeterRx2 = dbm;
    } else if (cmd === "dds" && args[0] === "0") {
      s.dds = num(args[1]);
    } else if (cmd === "iq_samplerate") {
      s.iqRate = num(args[0]);
    } else if (cmd === "rx_filter_band" && args[0] === "0") {
      s.filterLo = num(args[1]);
      s.filterHi = num(args[2]);
    } else if (cmd === "mute") {
      s.radioMute = truth(args[0]);
    } else if (cmd === "rx_mute" && args[0] === "0") {
      s.radioMute = truth(args[1]);
    } else {
      return;
    }
    this._emit();
  };

  TciClient.prototype._emit = function () {
    if (this.onChange) this.onChange(this.state);
  };

  TciClient.prototype._status = function (text) {
    if (this.onStatus) this.onStatus(text);
  };

  TciClient.prototype._log = function (text) {
    if (this.onLog) this.onLog(text);
  };

  function num(v) {
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function truth(v) {
    return String(v).toLowerCase() === "true" || v === "1";
  }

  window.TciClient = TciClient;
})();
