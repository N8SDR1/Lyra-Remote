(function () {
  "use strict";

  var STEPS = [10, 100, 1000, 10000];
  var client = new TciClient();
  var step = 100;

  var el = {
    host: document.getElementById("host"),
    connect: document.getElementById("connect"),
    status: document.getElementById("status"),
    identity: document.getElementById("identity"),
    vfo: document.getElementById("vfo"),
    vfoMeta: document.getElementById("vfo-meta"),
    modes: document.getElementById("modes"),
    flags: document.getElementById("flags"),
    smeter: document.getElementById("smeter"),
    rx2: document.getElementById("rx2"),
    log: document.getElementById("log"),
    steps: document.getElementById("steps"),
    down: document.getElementById("down"),
    up: document.getElementById("up")
  };

  var saved = localStorage.getItem("lyra-remote-url");
  if (saved) el.host.value = saved;

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

  el.connect.addEventListener("click", function () {
    if (client.state.connected) {
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

  document.addEventListener("keydown", function (ev) {
    if (ev.target === el.host) return;
    if (ev.key === "ArrowDown") { ev.preventDefault(); nudge(ev.shiftKey ? -step * 10 : -step); }
    if (ev.key === "ArrowUp") { ev.preventDefault(); nudge(ev.shiftKey ? step * 10 : step); }
  });

  function nudge(delta) {
    if (client.state.vfoA == null) return;
    client.tuneRx1(client.state.vfoA + delta);
  }

  client.onStatus = function (text) {
    el.status.textContent = text;
    el.connect.textContent = client.state.connected ? "Disconnect" : "Connect";
  };

  client.onChange = function (s) {
    el.connect.textContent = s.connected ? "Disconnect" : "Connect";
    document.body.classList.toggle("on-air", !!s.transmitting);
    el.identity.textContent = [s.protocol, s.device].filter(Boolean).join(" · ") || "—";
    el.vfo.textContent = s.vfoA == null ? "—.———.———" : fmtHz(s.vfoA);
    var bits = [];
    if (s.mode) bits.push(s.mode);
    if (s.vfoB != null) bits.push("VFO B " + fmtHz(s.vfoB));
    el.vfoMeta.textContent = bits.join("   ") || "Waiting for Lyra";
    paintModes(s.mode);
    el.flags.innerHTML = "";
    flag("SPLIT", s.split);
    flag("SUB", s.sub);
    flag(s.transmitting ? "TX" : "RX", s.transmitting, s.transmitting);
    el.smeter.textContent = s.smeter == null ? "S —" : s.smeter.toFixed(1) + " dBm";
    if (s.sub && s.rx2 != null) {
      el.rx2.hidden = false;
      el.rx2.textContent = "RX2  " + fmtHz(s.rx2) +
        (s.modeRx2 ? "  " + s.modeRx2 : "") +
        (s.smeterRx2 == null ? "" : "  " + s.smeterRx2.toFixed(1) + " dBm");
    } else {
      el.rx2.hidden = true;
    }
  };

  client.onLog = function (line) {
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
  }

  function flag(label, on, danger) {
    var n = document.createElement("span");
    n.textContent = label;
    n.className = "flag" + (on ? " on" : "") + (danger ? " danger" : "");
    el.flags.appendChild(n);
  }

  function fmtHz(hz) {
    var s = String(Math.round(hz));
    var out = "";
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ".";
      out += s.charAt(i);
    }
    return out;
  }

  paintModes("");
})();
