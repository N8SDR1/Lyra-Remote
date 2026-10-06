# Lyra Remote

A browser client for [Lyra-SDR](https://github.com/N8SDR1/Lyra-SDR-cpp). Lyra stays the rig. This page connects to Lyra's TCI server and operates the receiver from another screen on the same network.

The idea of a no-install browser TCI client comes from Brent N9BC's [Thetis on the Web](https://github.com/n9bc/thetis-on-the-web). This is the Lyra version of that idea, kept as its own project so Brent can work on it without the client living inside the radio repository.

## What it does

- Connects to Lyra's TCI WebSocket. The box at the top of the page is that address.
- Shows VFO A, VFO B, mode, split, SUB, and the S-meter.
- Tunes RX1: click or drag the spectrum, the mouse wheel and − / + on VFO A, or type a frequency and press Enter (`7.147` is MHz, `7147` is kHz, `7147000` or `7.147.000` is hertz). Shift on the wheel or the step buttons is a ten-times step.
- Sets the RX1 mode, filter width, SUB, and split. Drag a passband edge to change the filter. Band buttons recall the last frequency and mode this browser used on that band.
- Draws the RX1 spectrum and waterfall. Span, scale, color, speed, and line smoothing stay in this browser.
- Plays the receiver on this computer. **Listen** asks Lyra for the receive-audio stream. The speaker slider is local to the browser. **Mute radio** silences the speaker on the radio.

The page does not transmit. There is no PTT, no microphone, and no tune carrier. Key the radio from Lyra.

## Use it on this computer

1. In Lyra, open **Settings → Network**. Turn **TCI server running** on. Leave **Bind address** at `127.0.0.1` and **Port** at `40001`.
2. On this same computer, double-click **Open Lyra Remote.cmd**. That opens `http://127.0.0.1:4173/`. Leave the small server window running while you use the page.
3. Leave the address box at `ws://127.0.0.1:40001` and press **Connect** if it is not already connected.

Opening `index.html` itself does not work. The browser refuses a radio link from a page opened as a file. Python 3 is required for the launcher (`py -3`).

## Use it from another computer on the same network

Two addresses. They are not the same thing.

| What | Address |
|---|---|
| The page, on the computer where you are sitting | `http://127.0.0.1:4173/` |
| Lyra, in the box at the top of the page | `ws://` plus the Lyra computer's address, then `:40001` |

The page is always opened on the computer in front of you. You do not browse to the radio computer to get the page.

1. Copy this folder onto the computer you want to sit at (or clone the repository there). Double-click **Open Lyra Remote.cmd** on that computer. The browser opens `http://127.0.0.1:4173/` there.
2. On the computer that is running Lyra, open a command prompt and run `ipconfig`. Use the **IPv4 Address** on the house network, the one that looks like `192.168.1.50`.
3. On that Lyra computer, open **Settings → Network**. Turn **TCI server running** on. Set **Bind address** to `0.0.0.0`. Leave **Port** at `40001`. `127.0.0.1` only accepts the computer Lyra is running on, so another computer cannot connect until the bind address is `0.0.0.0`.
4. Allow Lyra through the Windows firewall for private networks, inbound TCP port **40001**.
5. On the computer where the page is open, replace the address box with `ws://192.168.1.50:40001`, using the address from step 2, and press **Connect**.

The browser remembers the last address (`lyra-remote-url`). Each person does this on their own network, against their own Lyra. They do not use your address.

This stays on the house network. There is no password on the TCI server. Do not forward port 40001 to the internet.

## Layout

```
Open Lyra Remote.cmd   opens the page on this computer
index.html             the page
css/app.css
js/tci.js              TCI parser and socket
js/audio.js            receive-audio playback
js/pan.js              spectrum and waterfall
js/app.js              the desk
assets/                the Lyra mark
```

No build step and no extra dependencies beyond Python 3 for the local page server.
