# shelly-light-show

Shelly music visualisier. The visualisation done with the help of Web AudioContext which triggers a REST API of the iOT device "shelly". the trigger can be easily switched to a different API or using MQTT with a little Know How.

Please feel free to check the source code and use it for your light show.

[![Watch the video](https://img.youtube.com/vi/H3WEFPAYLvI/maxresdefault.jpg)](https://youtu.be/H3WEFPAYLvI)

## Info
If any bugs found just let me know

## How to configure?
### Define channels
Create a config.json from config.json.example. Currently only shelly1, shell1pm and shelly dimmer2 are supported and tested.

### MQTT support
The app can control Shelly devices either via **HTTP REST API** (default) or via **MQTT over WebSocket**.

To enable MQTT, add an `mqtt` block to your `config.json`:

```json
{
    "mqtt": {
        "brokerUrl": "ws://192.168.0.1:9001",
        "username": "",
        "password": ""
    }
}
```

- `brokerUrl` – WebSocket URL of your MQTT broker (e.g. Mosquitto with `listener 9001` and `protocol websockets`). Use `wss://` for TLS.
- `username` / `password` – optional credentials.

When `mqtt.brokerUrl` is present the app will publish to Shelly MQTT topics:

| Device type | Command topic | Set topic (brightness / colour) |
|-------------|---------------|----------------------------------|
| shelly1 / shelly1pm | `shellies/<name>/relay/0/command` | – |
| dimmer1 / dimmer2 / shelly1l | `shellies/<name>/light/0/command` | `shellies/<name>/light/0/set` |
| rgbw2 | `shellies/<name>/color/0/command` | `shellies/<name>/color/0/set` |

The `<name>` is taken from the device `name` field in `config.json`. Make sure this matches the MQTT device ID configured on the Shelly device.

If no `mqtt` block is provided the app falls back to HTTP REST API calls.

### Define songs
Create a songs.json from songs.json.example.

## How to use?

### With docker

``docker-compose up``

Then just navigate to [localhost](http://127.0.0.1/) using the brwoser.

### HTTP Server
Copy the root folder to your HTTP Server and open it.

## Improvements
If anybody is interested in further developing to make a fully backend NodeJS script, i'll be happy to hear your ideas what to use as alternative to Web AudioContext.