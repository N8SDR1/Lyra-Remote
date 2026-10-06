(function () {
  "use strict";

  var STEPS = [1, 10, 100, 1000, 10000];
  var FILTERS = [250, 500, 2400, 2800, 3000, 4000, 6000];
  var BW_MIN = 10;
  var BW_MAX = 20000;
  var FREQ_MIN = 10000;
  var FREQ_MAX = 2147483647;
  var BANDS = [
    { name: "160m", lo: 1800000, hi: 2000000, hz: 1840000, mode: "LSB" },
    { name: "80m", lo: 3500000, hi: 4000000, hz: 3750000, mode: "LSB" },
    { name: "60m", lo: 5330000, hi: 5407000, hz: 5368000, mode: "USB" },
    { name: "40m", lo: 7000000, hi: 7300000, hz: 7200000, mode: "LSB" },
    { name: "30m", lo: 10100000, hi: 10150000, hz: 10136000, mode: "CWU" },
    { name: "20m", lo: 14000000, hi: 14350000, hz: 14200000, mode: "USB" },
    { name: "17m", lo: 18068000, hi: 18168000, hz: 18140000, mode: "USB" },
    { name: "15m", lo: 21000000, hi: 21450000, hz: 21200000, mode: "USB" },
    { name: "12m", lo: 24890000, hi: 24990000, hz: 24940000, mode: "USB" },
    { name: "10m", lo: 28000000, hi: 29700000, hz: 28400000, mode: "USB" },
    { name: "6m", lo: 50000000, hi: 54000000, hz: 50125000, mode: "USB" }
  ];
  var HF_ROWS = [
    [-124, "S0"], [-118, "S1"], [-112, "S2"], [-106, "S3"], [-100, "S4"],
    [-94, "S5"], [-88, "S6"], [-82, "S7"], [-76, "S8"], [-70, "S9"],
    [-66, "S9+5"], [-60, "S9+10"], [-56, "S9+15"], [-46, "S9+20"],
    [-36, "S9+30"], [-26, "S9+40"], [-16, "S9+50"]
  ];
  var VHF_ROWS = [
    [-144, "S0"], [-138, "S1"], [-132, "S2"], [-126, "S3"], [-120, "S4"],
    [-114, "S5"], [-108, "S6"], [-102, "S7"], [-96, "S8"], [-90, "S9"],
    [-86, "S9+5"], [-80, "S9+10"], [-76, "S9+15"], [-66, "S9+20"],
    [-56, "S9+30"], [-46, "S9+40"], [-36, "S9+50"]
  ];
  var client = new TciClient();
  var player = new RxAudio();
  var pan = new Panadapter(document.getElementById("pan"), document.getElementById("pan-read"));
  var iqWanted = false;
  var step = 100;
  var peakDbm = null;
  var peakHold = 0;
  var bandMem = loadBandMem();
  var wheelAcc = 0;
  var filterTimer = 0;

  var el = {
    host: document.getElementById("host"),
    connect: document.getElementById("connect"),
    status: document.getElementById("status"),
    vfo: document.getElementById("vfo"),
    vfoWell: document.getElementById("vfo-well"),
    vfoB: document.getElementById("vfo-b"),
    vfoBWell: document.getElementById("vfo-b-well"),
    txPip: document.getElementById("tx-pip"),
    txPipB: document.getElementById("tx-pip-b"),
    vfoMeta: document.getElementById("vfo-meta"),
    modes: document.getElementById("modes"),
    split: document.getElementById("split"),
    sub: document.getElementById("sub"),
    trx: document.getElementById("trx"),
    smeter: document.getElementById("smeter"),
    sLabel: document.getElementById("s-label"),
    sbarFill: document.getElementById("sbar-fill"),
    sbarHot: document.getElementById("sbar-hot"),
    sbarPeak: document.getElementById("sbar-peak"),
    sbarS9: document.getElementById("sbar-s9"),
    sbarScale: document.getElementById("sbar-scale"),
    filterWidth: document.getElementById("filter-width"),
    filterSpin: document.getElementById("filter-spin"),
    freqEntry: document.getElementById("freq-entry"),
    filters: document.getElementById("filters"),
    bands: document.getElementById("bands"),
    radioMute: document.getElementById("radio-mute"),
    rx2: document.getElementById("rx2"),
    log: document.getElementById("log"),
    steps: document.getElementById("steps"),
    down: document.getElementById("down"),
    up: document.getElementById("up"),
    listen: document.getElementById("listen"),
    audioState: document.getElementById("audio-state"),
    speaker: document.getElementById("speaker"),
    scaleAuto: document.getElementById("scale-auto"),
    scaleFloor: document.getElementById("scale-floor"),
    scaleTop: document.getElementById("scale-top"),
    scaleFloorRead: document.getElementById("scale-floor-read"),
    scaleTopRead: document.getElementById("scale-top-read"),
    palettes: document.getElementById("palettes"),
    specSpeed: document.getElementById("spec-speed"),
    wfSpeed: document.getElementById("wf-speed"),
    smooth: document.getElementById("spec-smooth"),
    smoothRead: document.getElementById("smooth-read"),
    spans: document.getElementById("spans")
  };

  var saved = localStorage.getItem("lyra-remote-url");
  if (saved) el.host.value = saved;
  var savedLevel = localStorage.getItem("lyra-remote-speaker");
  if (savedLevel != null) el.speaker.value = savedLevel;
  player.setLevel(Number(el.speaker.value) / 100);

  pan.onTune = function (hz) {
    if (!client.state.connected) return;
    if (hz < FREQ_MIN || hz > FREQ_MAX) return;
    client.tuneRx1(hz);
  };

  var SPANS = [
    { id: 25000, label: "25 kHz" },
    { id: 50000, label: "50 kHz" },
    { id: 100000, label: "100 kHz" },
    { id: 0, label: "Full" }
  ];

  function radioBandwidth(s) {
    var m = (s.mode || "").toUpperCase();
    if (m === "USB" || m === "DIGU") return s.filterHi;
    if (m === "LSB" || m === "DIGL") return s.filterLo == null ? null : -s.filterLo;
    return filterWidth(s);
  }

  function matchSpan(cur) {
    if (!cur) return 0;
    var i;
    for (i = 0; i < SPANS.length; i++) {
      if (SPANS[i].id && Math.abs(cur - SPANS[i].id) / SPANS[i].id < 0.04) return SPANS[i].id;
    }
    return null;
  }

  function paintSpans() {
    var cur = pan.viewSpan || 0;
    var rate = pan.rate || 0;
    if (rate && cur >= rate * 0.98) cur = 0;
    fillChoice(el.spans, SPANS, matchSpan(cur), function (id) {
      pan.setSpan(id);
    });
  }

  pan.setBands(BANDS);
  pan.onSpan = paintSpans;
  pan.onBandwidth = function (hz) {
    if (!client.state.connected) return;
    var n = clampBw(hz);
    if (n == null) return;
    if (radioBandwidth(client.state) === n) return;
    client.setFilterWidth(n);
  };
  paintSpans();

  var PALETTE_CHOICES = [
    { id: "lyra", label: "Lyra" },
    { id: "heat", label: "Heat" },
    { id: "gray", label: "Gray" },
    { id: "green", label: "Green" },
    { id: "ice", label: "Ice" }
  ];
  function stored(key, fallback) {
    try {
      var v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (err) {
      return fallback;
    }
  }

  function fmtRel(n) {
    var v = Math.round(n);
    return v < 0 ? "−" + Math.abs(v) : String(v);
  }

  function speedStored(key) {
    var v = stored(key, "50");
    if (v === "slow") return 0;
    if (v === "med") return 50;
    if (v === "fast") return 100;
    var n = Number(v);
    if (!isFinite(n)) return 50;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  var disp = {
    scaleAuto: stored("lyra-remote-scale-auto", "1") !== "0",
    dbTop: Number(stored("lyra-remote-db-top", "-40")),
    dbBot: Number(stored("lyra-remote-db-floor", "-120")),
    palette: stored("lyra-remote-palette", "lyra"),
    specSpeed: speedStored("lyra-remote-spec-speed"),
    wfSpeed: speedStored("lyra-remote-wf-speed"),
    smooth: speedStored("lyra-remote-spec-smooth")
  };
  if (stored("lyra-remote-spec-smooth", "") === "") disp.smooth = 25;
  if (!isFinite(disp.dbTop)) disp.dbTop = -40;
  if (!isFinite(disp.dbBot)) disp.dbBot = -120;

  function saveDisp() {
    try {
      localStorage.setItem("lyra-remote-scale-auto", disp.scaleAuto ? "1" : "0");
      localStorage.setItem("lyra-remote-db-top", String(Math.round(disp.dbTop)));
      localStorage.setItem("lyra-remote-db-floor", String(Math.round(disp.dbBot)));
      localStorage.setItem("lyra-remote-palette", disp.palette);
      localStorage.setItem("lyra-remote-spec-speed", String(Math.round(disp.specSpeed)));
      localStorage.setItem("lyra-remote-wf-speed", String(Math.round(disp.wfSpeed)));
      localStorage.setItem("lyra-remote-spec-smooth", String(Math.round(disp.smooth)));
    } catch (err) { /* private mode */ }
  }

  function fillChoice(parent, items, current, onPick) {
    parent.textContent = "";
    items.forEach(function (item) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = item.label;
      if (item.id === current) b.classList.add("on");
      b.addEventListener("click", function () { onPick(item.id); });
      parent.appendChild(b);
    });
  }

  function paintScaleReads() {
    el.scaleFloorRead.textContent = fmtRel(disp.scaleAuto ? el.scaleFloor.value : disp.dbBot);
    el.scaleTopRead.textContent = fmtRel(disp.scaleAuto ? el.scaleTop.value : disp.dbTop);
  }

  function applyDisp() {
    pan.setDisplay(disp);
    el.scaleAuto.classList.toggle("on", disp.scaleAuto);
    el.scaleFloor.disabled = disp.scaleAuto;
    el.scaleTop.disabled = disp.scaleAuto;
    if (!disp.scaleAuto) {
      el.scaleFloor.value = String(Math.round(disp.dbBot));
      el.scaleTop.value = String(Math.round(disp.dbTop));
    }
    paintScaleReads();
    fillChoice(el.palettes, PALETTE_CHOICES, disp.palette, function (id) {
      disp.palette = id;
      saveDisp();
      applyDisp();
    });
    if (document.activeElement !== el.specSpeed) el.specSpeed.value = String(disp.specSpeed);
    if (document.activeElement !== el.wfSpeed) el.wfSpeed.value = String(disp.wfSpeed);
    if (document.activeElement !== el.smooth) el.smooth.value = String(disp.smooth);
    el.smoothRead.textContent = String(Math.round(disp.smooth));
  }

  pan.onScale = function (top, bot) {
    if (!disp.scaleAuto) return;
    var t = Math.round(top);
    var b = Math.round(bot);
    if (String(t) !== el.scaleTop.value) el.scaleTop.value = String(Math.max(-140, Math.min(20, t)));
    if (String(b) !== el.scaleFloor.value) el.scaleFloor.value = String(Math.max(-160, Math.min(0, b)));
    el.scaleTopRead.textContent = fmtRel(t);
    el.scaleFloorRead.textContent = fmtRel(b);
  };

  el.scaleAuto.addEventListener("click", function () {
    if (disp.scaleAuto) {
      disp.dbTop = Number(el.scaleTop.value);
      disp.dbBot = Number(el.scaleFloor.value);
      if (disp.dbTop - disp.dbBot < 10) disp.dbBot = disp.dbTop - 10;
    }
    disp.scaleAuto = !disp.scaleAuto;
    saveDisp();
    applyDisp();
  });

  function onManualScale() {
    if (disp.scaleAuto) return;
    disp.dbTop = Number(el.scaleTop.value);
    disp.dbBot = Number(el.scaleFloor.value);
    if (disp.dbTop - disp.dbBot < 10) {
      if (document.activeElement === el.scaleFloor) disp.dbTop = disp.dbBot + 10;
      else disp.dbBot = disp.dbTop - 10;
      el.scaleTop.value = String(Math.round(disp.dbTop));
      el.scaleFloor.value = String(Math.round(disp.dbBot));
    }
    paintScaleReads();
    pan.setDisplay(disp);
    saveDisp();
  }

  el.scaleFloor.addEventListener("input", onManualScale);
  el.scaleTop.addEventListener("input", onManualScale);

  function onSpeed() {
    disp.specSpeed = Number(el.specSpeed.value);
    disp.wfSpeed = Number(el.wfSpeed.value);
    disp.smooth = Number(el.smooth.value);
    el.smoothRead.textContent = String(Math.round(disp.smooth));
    pan.setDisplay(disp);
    saveDisp();
  }

  el.specSpeed.addEventListener("input", onSpeed);
  el.wfSpeed.addEventListener("input", onSpeed);
  el.smooth.addEventListener("input", onSpeed);
  applyDisp();

  TciClient.MODES.forEach(function (mode) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = mode;
    b.dataset.mode = mode;
    b.addEventListener("click", function () {
      client.setMode(mode);
    });
    el.modes.appendChild(b);
  });

  STEPS.forEach(function (hz) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = hz >= 1000 ? hz / 1000 + " kHz" : hz + " Hz";
    b.dataset.step = String(hz);
    if (hz === step) b.classList.add("on");
    b.addEventListener("click", function () {
      step = hz;
      paintSteps();
    });
    el.steps.appendChild(b);
  });

  function paintSteps() {
    var buttons = el.steps.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("on", Number(buttons[i].dataset.step) === step);
    }
  }

  BANDS.forEach(function (band) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = band.name;
    b.dataset.band = band.name;
    b.disabled = true;
    b.addEventListener("click", function () { goBand(band); });
    el.bands.appendChild(b);
  });

  FILTERS.forEach(function (hz) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = fmtBw(hz);
    b.dataset.width = String(hz);
    b.disabled = true;
    b.addEventListener("click", function () { client.setFilterWidth(hz); });
    el.filters.appendChild(b);
  });

  ["S1", "S5", "S9", "+20", "+40", "+60"].forEach(function (label) {
    var mark = document.createElement("span");
    mark.textContent = label;
    el.sbarScale.appendChild(mark);
  });

  el.connect.addEventListener("click", function () {
    if (client.state.connected) {
      if (player.active) client.stopAudio();
      player.stop();
      client.disconnect();
      return;
    }
    var url = el.host.value.trim();
    if (!url) return;
    localStorage.setItem("lyra-remote-url", url);
    client.connect(url);
  });

  el.down.addEventListener("click", function () { nudge(-step); });
  el.up.addEventListener("click", function () { nudge(step); });

  el.split.addEventListener("click", function () {
    client.setSplit(!client.state.split);
  });
  el.sub.addEventListener("click", function () {
    client.setSub(!client.state.sub);
  });
  el.listen.addEventListener("click", function () {
    if (player.active) {
      client.stopAudio();
      player.stop();
      paintListen();
      return;
    }
    player.start().then(function () {
      client.startAudio();
      paintListen();
    }).catch(function () {
      player.stop();
      paintListen();
    });
  });
  el.speaker.addEventListener("input", function () {
    player.setLevel(Number(el.speaker.value) / 100);
    localStorage.setItem("lyra-remote-speaker", el.speaker.value);
  });
  el.radioMute.addEventListener("click", function () {
    client.setRadioMute(!client.state.radioMute);
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.target === el.host || ev.target === el.filterSpin || ev.target === el.freqEntry) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); nudge(ev.shiftKey ? -step * 10 : -step); }
    if (ev.key === "ArrowUp") { ev.preventDefault(); nudge(ev.shiftKey ? step * 10 : step); }
  });

  el.freqEntry.addEventListener("keydown", function (ev) {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    applyFreq();
  });
  el.freqEntry.addEventListener("change", applyFreq);
  el.vfoWell.addEventListener("dblclick", function () {
    if (!client.state.connected) return;
    el.freqEntry.focus();
    el.freqEntry.select();
  });

  el.vfoWell.title = "Mouse wheel tunes RX1. Shift is ten times the step.";
  el.vfoWell.addEventListener("wheel", function (ev) {
    if (!client.state.connected || client.state.vfoA == null) return;
    ev.preventDefault();
    wheelAcc += ev.deltaY;
    var notch = ev.deltaMode === 1 ? 1 : 50;
    if (Math.abs(wheelAcc) < notch) return;
    var ticks = Math.trunc(wheelAcc / notch);
    wheelAcc -= ticks * notch;
    nudge(-ticks * step * (ev.shiftKey ? 10 : 1));
  }, { passive: false });

  el.filterSpin.addEventListener("input", function () {
    window.clearTimeout(filterTimer);
    filterTimer = window.setTimeout(applyFilterSpin, 250);
  });
  el.filterSpin.addEventListener("change", function () {
    window.clearTimeout(filterTimer);
    applyFilterSpin();
  });

  function nudge(delta) {
    if (client.state.vfoA == null) return;
    client.tuneRx1(client.state.vfoA + delta);
  }

  function parseFreq(text) {
    var s = String(text).replace(/ /g, "");
    if (!s) return null;
    var seps = (s.match(/[.,]/g) || []).length;
    if (seps > 1) {
      var digits = s.replace(/[.,]/g, "");
      if (!/^\d+$/.test(digits)) return null;
      return clampFreq(Number(digits));
    }
    s = s.replace(",", ".");
    if (s.indexOf(".") >= 0) {
      if (!/^\d*\.\d+$/.test(s) && !/^\d+\.\d*$/.test(s)) return null;
      var mhz = Number(s);
      if (!isFinite(mhz)) return null;
      return clampFreq(Math.round(mhz * 1e6));
    }
    if (!/^\d+$/.test(s)) return null;
    var n = Number(s);
    var hz = n;
    if (n < 100) hz = n * 1000000;
    else if (n < 100000) hz = n * 1000;
    return clampFreq(hz);
  }

  function clampFreq(hz) {
    if (!isFinite(hz)) return null;
    hz = Math.round(hz);
    if (hz < FREQ_MIN || hz > FREQ_MAX) return null;
    return hz;
  }

  function fmtEntry(hz) {
    var n = Math.round(hz);
    var mhz = Math.floor(n / 1000000);
    var khz = Math.floor((n % 1000000) / 1000);
    var rest = n % 1000;
    function pad(v) { return ("000" + v).slice(-3); }
    return mhz + "." + pad(khz) + "." + pad(rest);
  }

  function paintFreqEntry(s) {
    el.freqEntry.disabled = !s.connected;
    if (!s.connected || s.vfoA == null) return;
    if (document.activeElement === el.freqEntry) return;
    el.freqEntry.value = fmtEntry(s.vfoA);
  }

  function applyFreq() {
    if (!client.state.connected) return;
    var hz = parseFreq(el.freqEntry.value);
    if (hz == null) {
      paintFreqEntry(client.state);
      return;
    }
    el.freqEntry.value = fmtEntry(hz);
    if (client.state.vfoA != null && Math.round(client.state.vfoA) === hz) return;
    client.tuneRx1(hz);
  }

  client.onStatus = function (text) {
    el.status.textContent = text;
    el.connect.textContent = client.state.connected ? "Disconnect" : "Connect";
    if (!client.state.connected && player.active) player.stop();
    paintListen();
  };

  client.onBinary = function (buffer) {
    pan.push(buffer);
    player.push(buffer);
  };

  player.onState = function (text) {
    el.audioState.textContent = text;
  };

  client.onChange = function (s) {
    el.connect.textContent = s.connected ? "Disconnect" : "Connect";
    document.body.classList.toggle("on-air", !!s.transmitting);
    paintLed(el.vfo, s.vfoA);
    el.vfoWell.className = "vfo-well " + wellFace(s, false);
    el.txPip.classList.toggle("hot", s.connected && !s.split);
    var bHz = s.split ? s.vfoB : (s.sub ? s.rx2 : s.vfoB);
    paintLed(el.vfoB, bHz);
    el.vfoBWell.className = "vfo-well small " + wellFace(s, true);
    el.txPipB.classList.toggle("hot", s.connected && !!s.split);
    el.vfoMeta.textContent = s.mode || (s.connected ? "" : "Waiting for Lyra");
    if (s.sub && s.rx2 != null) {
      el.rx2.textContent = "RX2" + (s.modeRx2 ? "  " + s.modeRx2 : "") +
        (s.smeterRx2 == null ? "" : "  " + s.smeterRx2.toFixed(1) + " dBm");
    } else if (s.split) {
      el.rx2.textContent = "VFO B";
    } else {
      el.rx2.textContent = "VFO B";
    }
    paintModes(s.mode);
    el.split.classList.toggle("on", !!s.split);
    el.sub.classList.toggle("on", !!s.sub);
    el.split.disabled = !s.connected;
    el.sub.disabled = !s.connected;
    el.listen.disabled = !s.connected;
    el.trx.textContent = s.transmitting ? "TX" : "RX";
    el.trx.className = "role" + (s.transmitting ? " danger" : "");
    paintMeter(s);
    paintBands(s);
    paintFilter(s);
    paintMute(s);
    paintFreqEntry(s);
    if (s.connected) {
      rememberBand(s);
      pan.setRadio(s);
      if (s.ready && !iqWanted) {
        iqWanted = true;
        client.startIq();
      }
    } else {
      peakDbm = null;
      peakHold = 0;
      iqWanted = false;
      pan.clear();
    }
  };

  client.onLog = function (line) {
    if (line.indexOf("rx_channel_sensors") >= 0 || line.indexOf("lyra_snr") >= 0 || line.indexOf("dds:") >= 0) return;
    var row = document.createElement("div");
    row.textContent = line;
    el.log.appendChild(row);
    while (el.log.childNodes.length > 80) el.log.removeChild(el.log.firstChild);
    el.log.scrollTop = el.log.scrollHeight;
  };

  function paintModes(active) {
    var buttons = el.modes.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("on", buttons[i].dataset.mode === active);
      buttons[i].disabled = !client.state.connected;
    }
    el.down.disabled = !client.state.connected;
    el.up.disabled = !client.state.connected;
    el.listen.disabled = !client.state.connected;
    var filters = el.filters.querySelectorAll("button");
    for (var f = 0; f < filters.length; f++) filters[f].disabled = !client.state.connected;
    var bands = el.bands.querySelectorAll("button");
    for (var n = 0; n < bands.length; n++) bands[n].disabled = !client.state.connected;
    el.radioMute.disabled = !client.state.connected;
  }

  function paintListen() {
    el.listen.textContent = player.active ? "Stop" : "Listen";
    el.listen.disabled = !client.state.connected;
  }

  function wellFace(s, isB) {
    if (!s.connected) return "";
    if (isB) {
      if (s.transmitting && s.split) return "tx";
      if (s.sub && !s.split) return "rx";
      return "arm";
    }
    if (s.transmitting && !s.split) return "tx";
    return "rx";
  }

  function goBand(band) {
    if (!client.state.connected) return;
    if (bandAt(client.state.vfoA) === band) return;
    var saved = bandMem[band.name];
    if (saved && saved.hz >= band.lo && saved.hz <= band.hi) {
      client.tuneRx1(saved.hz);
      if (saved.mode) client.setMode(saved.mode);
      return;
    }
    client.tuneRx1(band.hz);
    client.setMode(band.mode);
  }

  function bandAt(hz) {
    if (hz == null) return null;
    for (var i = 0; i < BANDS.length; i++) {
      if (hz >= BANDS[i].lo && hz <= BANDS[i].hi) return BANDS[i];
    }
    return null;
  }

  function loadBandMem() {
    try {
      var parsed = JSON.parse(localStorage.getItem("lyra-remote-bands") || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function rememberBand(s) {
    var band = bandAt(s.vfoA);
    if (!band || !s.mode) return;
    var hz = Math.round(s.vfoA);
    var prev = bandMem[band.name];
    if (prev && prev.hz === hz && prev.mode === s.mode) return;
    bandMem[band.name] = { hz: hz, mode: s.mode };
    localStorage.setItem("lyra-remote-bands", JSON.stringify(bandMem));
  }

  function paintBands(s) {
    var current = bandAt(s.vfoA);
    var buttons = el.bands.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("on", current && buttons[i].dataset.band === current.name);
      buttons[i].disabled = !s.connected;
    }
  }

  function filterWidth(s) {
    if (s.filterLo == null || s.filterHi == null) return null;
    return Math.abs(s.filterHi - s.filterLo);
  }

  function clampBw(hz) {
    var n = Math.round(Number(hz));
    if (!isFinite(n)) return null;
    if (n < BW_MIN) n = BW_MIN;
    if (n > BW_MAX) n = BW_MAX;
    return n;
  }

  function applyFilterSpin() {
    if (!client.state.connected) return;
    var n = clampBw(el.filterSpin.value);
    if (n == null) return;
    el.filterSpin.value = String(n);
    if (filterWidth(client.state) === n) return;
    client.setFilterWidth(n);
  }

  function paintFilter(s) {
    var width = filterWidth(s);
    el.filterWidth.textContent = width == null ? "Filter —" : "Filter " + fmtBw(width);
    el.filterSpin.disabled = !s.connected;
    if (width != null && document.activeElement !== el.filterSpin) {
      el.filterSpin.value = String(width);
    }
    var buttons = el.filters.querySelectorAll("button");
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle("on", width != null && Number(buttons[i].dataset.width) === width);
      buttons[i].disabled = !s.connected;
    }
  }

  function paintMute(s) {
    el.radioMute.classList.toggle("on", !!s.radioMute);
    el.radioMute.textContent = s.radioMute ? "Radio muted" : "Mute radio";
    el.radioMute.disabled = !s.connected;
  }

  function meterScale(hz) {
    if (hz != null && hz >= 30000000) {
      return { floor: -144, ceil: -33, s9: -93, rows: VHF_ROWS, marks: [-138, -114, -93, -66, -46, -33] };
    }
    return { floor: -124, ceil: -13, s9: -73, rows: HF_ROWS, marks: [-118, -94, -73, -46, -26, -13] };
  }

  function meterPct(dbm, scale) {
    var span = scale.ceil - scale.floor;
    return Math.max(0, Math.min(100, (dbm - scale.floor) / span * 100));
  }

  function sLabel(dbm, rows) {
    for (var i = 0; i < rows.length; i++) {
      if (dbm <= rows[i][0]) return rows[i][1];
    }
    return "S9+60";
  }

  function paintMeter(s) {
    var marks = el.sbarScale.querySelectorAll("span");
    if (s.smeter == null || !s.connected) {
      el.sLabel.textContent = "S —";
      el.smeter.textContent = "—";
      el.sbarFill.style.width = "0";
      el.sbarHot.style.width = "0";
      el.sbarPeak.style.left = "0";
      return;
    }
    var scale = meterScale(s.vfoA);
    var dbm = s.smeter;
    if (peakDbm == null || dbm >= peakDbm) {
      peakDbm = dbm;
      peakHold = 3;
    } else if (peakHold > 0) {
      peakHold -= 1;
    } else {
      peakDbm = Math.max(dbm, peakDbm - 1.5);
    }
    var level = meterPct(dbm, scale);
    var s9 = meterPct(scale.s9, scale);
    var hot = Math.max(0, level - s9);
    el.sLabel.textContent = sLabel(dbm, scale.rows);
    el.smeter.textContent = dbm.toFixed(1) + " dBm";
    el.sbarFill.style.width = Math.min(level, s9) + "%";
    el.sbarHot.style.left = s9 + "%";
    el.sbarHot.style.width = hot + "%";
    el.sbarPeak.style.left = meterPct(peakDbm, scale) + "%";
    el.sbarS9.style.left = s9 + "%";
    for (var i = 0; i < marks.length; i++) {
      marks[i].style.left = meterPct(scale.marks[i], scale) + "%";
    }
  }

  function fmtBw(hz) {
    if (hz >= 1000) {
      var k = hz / 1000;
      return (hz % 1000 ? k.toFixed(1) : String(k)) + " kHz";
    }
    return hz + " Hz";
  }

  function paintLed(node, hz) {
    node.replaceChildren();
    var raw = hz == null ? null : String(Math.round(hz)).padStart(10, "0").slice(-10);
    var seen = false;
    for (var i = 0; i < 10; i++) {
      if (i === 4 || i === 7) {
        var dot = document.createElement("span");
        dot.className = "dot";
        dot.textContent = ".";
        node.appendChild(dot);
      }
      var ch = raw ? raw.charAt(i) : "8";
      var dim = !raw || (!seen && ch === "0" && i < 4);
      if (raw && ch !== "0") seen = true;
      var d = document.createElement("span");
      d.className = "digit" + (dim ? " dim" : "");
      var ghost = document.createElement("i");
      ghost.textContent = "8";
      var lit = document.createElement("b");
      lit.textContent = ch;
      d.appendChild(ghost);
      d.appendChild(lit);
      node.appendChild(d);
    }
  }

  paintLed(el.vfo, null);
  paintLed(el.vfoB, null);
  paintModes("");

  if (location.protocol === "file:") {
    el.status.textContent = "Open this with Open Lyra Remote, not by double-clicking the page.";
    el.vfoMeta.textContent = "Edge blocks the link to Lyra from a file on disk.";
  } else {
    client.connect(el.host.value.trim());
  }
})();
