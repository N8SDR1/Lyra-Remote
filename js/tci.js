/* TCI text client. Lyra sends "command:args;" lines and a few bare words
   (start, ready). Binary audio and I/Q frames are ignored until a later cut. */
(function () {
  "use strict";

  var MODES = ["LSB", "USB", "AM", "CWU", "CWL", "DIGU", "DIGL", "FM", "SAM", "DSB"];

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
      smeterRx2: null
    };
  }

  function TciClient() {
    this.ws = null;
    this.state = blankState();
    this.onChange = null;
    this.onLog = null;
    this.onStatus = null;
    this._buf = "";
  }

  TciClient.MODES = MODES;

  TciClient.prototype.connect = function (url) {
    this.disconnect();
    var self = this;
    this._status("Connecting");
    var ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    ws.onopen = function () {
      self.state.connected = true;
      self._status("Connected");
      self._emit();
    };
    ws.onclose = function () {
      self.state = blankState();
      self._status("Disconnected");
      self._emit();
      if (self.ws === ws) self.ws = null;
    };
    ws.onerror = function () {
      self._status("Connection failed");
    };
    ws.onmessage = function (ev) {
      if (typeof ev.data === "string") self._ingest(ev.data);
    };
  };

  TciClient.prototype.disconnect = function () {
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
