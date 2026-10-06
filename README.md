# Lyra Remote

A browser client for [Lyra-SDR](https://github.com/N8SDR1/Lyra-SDR-cpp). Lyra stays the rig. This page connects to Lyra's TCI server and operates the receiver from another screen on the same network.

The idea of a no-install browser TCI client comes from Brent N9BC's [Thetis on the Web](https://github.com/n9bc/thetis-on-the-web). This is the Lyra version of that idea, kept as its own project so Brent can work on it without the client living inside the radio repository.

## What this first cut does

- Connects to Lyra's TCI WebSocket (default `ws://127.0.0.1:40001`).
- Shows the protocol, radio, VFO A, VFO B, RX2, mode, split, SUB, and S-meter.
- Tunes RX1 and sets the RX1 mode.

Transmit, microphone audio, and the panadapter are not in this cut. The page has no PTT control. Key the radio from Lyra until the remote unkey path has been checked on the air desk.

## Use it

1. In Lyra, open **Settings → Network** and turn **TCI server running** on. Leave the port at **40001**. To reach the page from another computer on the house network, set the bind address to `0.0.0.0`. For this PC only, `127.0.0.1` is enough.
2. Open `index.html` in Chrome or Edge.
3. Check the address and click **Connect**.

The last address is remembered in the browser.

This is a same-house client. Do not put Lyra's TCI port on the public internet. There is no password on the TCI server yet.

## Layout

```
index.html          the page
css/app.css
js/tci.js           TCI text parser and socket
js/app.js           the desk
```

No build step and no dependencies.
