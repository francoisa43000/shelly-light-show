# shelly-light-show

Shelly music visualisier. The visualisation done with the help of Web AudioContext which triggers a REST API of the iOT device "shelly". the trigger can be easily switched to a different API or using MQTT with a little Know How.

Please feel free to check the source code and use it for your light show.

[![Watch the video](https://img.youtube.com/vi/H3WEFPAYLvI/maxresdefault.jpg)](https://youtu.be/H3WEFPAYLvI)

## Info
If any bugs found just let me know

## How to configure?

Configuration is done directly from the web page via the **⚙ Settings** panel at the top. Settings are saved in your browser's `localStorage` so they persist across page refreshes.

### Connection Mode

Choose between **HTTP REST API** (direct calls to the Shelly device) or **MQTT**.

#### HTTP Mode
Enter the **IP Range Prefix** (e.g. `192.168.0`). Each device's `ip` field in the channels JSON is the last octet, so `192.168.0` + `.11` = `192.168.0.11`.

#### MQTT Mode
Enter the **Broker URL** in WebSocket format (e.g. `ws://192.168.0.1:9001`).

> ⚠ **Browsers can only connect to MQTT via WebSocket.** You must enable the WebSocket listener in Mosquitto:
> ```
> # mosquitto.conf
> listener 9001
> protocol websockets
> ```
> Then restart Mosquitto. Use `wss://` for TLS.

Optionally provide a username and password. Use the **Test connection** button to verify connectivity before saving.

MQTT topics follow the standard Shelly convention:

| Device type | Command topic | Set topic (brightness / colour) |
|-------------|---------------|----------------------------------|
| shelly1 / shelly1pm | `shellies/<name>/relay/0/command` | – |
| dimmer1 / dimmer2 / shelly1l | `shellies/<name>/light/0/command` | `shellies/<name>/light/0/set` |
| rgbw2 | `shellies/<name>/color/0/command` | `shellies/<name>/color/0/set` |

The `<name>` is the device `name` field in the channels JSON — it must match the MQTT device ID configured on the Shelly.

### Channels (JSON)

The **Channels** textarea lets you define the full channel/device configuration as JSON.  
See `config.json.example` for the complete format.

Use **Reset from config.json** to reload the example file into the form without applying it, then edit and click **Save & Apply**.

### Adding music

There are two ways to add music to the app:

#### Upload directly from the browser (recommended)
Click the **🎵 Add local music files…** button on the main page and pick one or more audio files (MP3, FLAC, WAV, OGG, …). The files are loaded into the browser's memory for the current session — no files are uploaded to any server.

> **Session only:** uploaded songs are lost when you close or refresh the page. For a permanent playlist, use `songs.json` (see below).

#### songs.json playlist
Create a `songs.json` from `songs.json.example`. Each entry has a `name` and a `src` (relative path to a file served from the same HTTP server). If `songs.json` is missing or empty the app still works — just upload files directly.

### Can Spotify be used?

**No.** Spotify's audio is DRM-protected (Widevine) and its Web Playback SDK does not expose the raw audio samples required by the Web AudioContext visualizer. There is no way around this restriction — it is enforced both by Spotify's Terms of Service and by the browser's media pipeline.

**Alternatives:** download your music as MP3/FLAC from a service that allows it (e.g. Bandcamp, SoundCloud free tracks, your own rips) and upload them using the button on the page.

## How to use?

### With docker

``docker-compose up``

Then just navigate to [localhost](http://127.0.0.1/) using the brwoser.

### HTTP Server
Copy the root folder to your HTTP Server and open it.

## Improvements
If anybody is interested in further developing to make a fully backend NodeJS script, i'll be happy to hear your ideas what to use as alternative to Web AudioContext.