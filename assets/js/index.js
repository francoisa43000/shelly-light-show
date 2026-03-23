const canvas = document.getElementById("audio-visual");
const debug = true;
const threshold = 0; // max 256 / 2
const analyserSize = 2048;
const numberOflastTurnOns = 5;
const audioElement = document.getElementById("source");
const songsSelectorElement = document.getElementById('list-of-songs');
const AudioContext = window.AudioContext || window.webkitAudioContext;
const STORAGE_KEY = 'shelly-light-show-config';
const shellyEndPoints = {
    relay: {
        endpoint: 'relay',
        aliases: ['shelly1', 'shelly1pm']
    },
    light: {
        endpoint: 'light',
        aliases: ['dimmer1', 'dimmer2', 'shelly1l']
    },
    color: {
        endpoint: 'color',
        aliases: ['rgbw2']
    }
};
const dimmerables = ['dimmer1', 'dimmer2', 'shelly1l','rgbw2'];
const colorful = ['rgbw2'];

let shellyEndPointsMap = {};
for (item in shellyEndPoints) {
    shellyEndPointsMap[item] = item;
    for (alias in shellyEndPoints[item].aliases) {
        shellyEndPointsMap[shellyEndPoints[item].aliases[alias]] = item;
    }
}

/**
 * Alias keys for shelly end points
 */
function shellyEndPoint(item) {
    return shellyEndPoints[shellyEndPointsMap[item]].endpoint;
}

/**
 * Returns hex string to rgb
 * @param hex string
 * @return {{r: number, b: number, g: number}|null}
 */
function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        red: parseInt(result[1], 16),
        green: parseInt(result[2], 16),
        blue: parseInt(result[3], 16)
    } : null;
}

// --- Module-level state ---
let activeConfig = {};
let channels = [];
let ipRangePrefix = '';
let maxAudioFrequency = 280;
let percentFactor = 1;
let mqttClient = null;
let throttleTimer = [];
let lastStatus = [];
let statusHistory = [];
let debugDivElements = [];
let debugDivElementsContainer = null;
let channelValuesSum = 0;
let channelValuesCount = 1;
let lastCalculatedChannel = 0;
let deviceColors = {};
let lastColors = {};

// --- Config persistence ---
function loadConfigFromStorage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
    } catch(e) { console.warn('Failed to load config from localStorage:', e); }
    return null;
}

function saveConfigToStorage(config) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function loadConfig() {
    const stored = loadConfigFromStorage();
    if (stored) return Promise.resolve(stored);
    return fetch('./config.json').then(r => r.json());
}

// --- MQTT ---
function updateMqttStatusBadge(text, cls) {
    const el = document.getElementById('mqtt-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'mqtt-status-badge' + (cls ? ' ' + cls : '');
}

function disconnectMqtt() {
    if (mqttClient) {
        mqttClient.end(true);
        mqttClient = null;
        updateMqttStatusBadge('Not connected', '');
    }
}

function connectMqtt(mqttConfig) {
    if (typeof mqtt === 'undefined') {
        console.error('MQTT library not loaded');
        updateMqttStatusBadge('MQTT library not loaded', 'error');
        return;
    }
    const options = {};
    if (mqttConfig.username) options.username = mqttConfig.username;
    if (mqttConfig.password) options.password = mqttConfig.password;

    mqttClient = mqtt.connect(mqttConfig.brokerUrl, options);
    updateMqttStatusBadge('Connecting…', 'connecting');

    mqttClient.on('connect', () => {
        console.log('MQTT connected to', mqttConfig.brokerUrl);
        updateMqttStatusBadge('✓ Connected', 'connected');
    });
    mqttClient.on('error', error => {
        console.error('MQTT error', error);
        updateMqttStatusBadge('✗ ' + error.message, 'error');
    });
    mqttClient.on('close', () => {
        updateMqttStatusBadge('Disconnected', 'error');
    });
}

// --- Colors ---
function initColors(channel) {
    if (!channel.devices) return;
    channel.devices.forEach((device, deviceId) => {
        if (colorful.indexOf(device.type) === -1 || !device.colors) return;
        let colorId = `${channel.name}.${deviceId}`;
        if (!Array.isArray(deviceColors[colorId])) deviceColors[colorId] = [];
        device.colors.forEach(color => {
            let rgbColor = hexToRgb(color);
            if (rgbColor) deviceColors[colorId].push(rgbColor);
        });
    });
}

function createDebugElements() {
    if (debug !== true) return;
    debugDivElementsContainer = document.createElement('div');
    debugDivElementsContainer.setAttribute('id', 'debugDivElement');
    document.getElementById('main-container').appendChild(debugDivElementsContainer);
    channels.forEach((channel, index) => {
        const channelNode = document.createElement('div');
        channelNode.setAttribute('id', `channel-${index}`);
        channelNode.setAttribute('data-name', channel.name);
        debugDivElements.push(channelNode);
        debugDivElementsContainer.appendChild(channelNode);
        initColors(channel);
    });
}

// --- Config application ---
function applyConfig(config) {
    activeConfig = config;
    maxAudioFrequency = config.maxAudioFrequency || 280;
    channels = config.channels || [];
    ipRangePrefix = config.ipRangePrefix || '';
    percentFactor = channels.length > 0 ? 100 / channels.length : 1;

    // Reset per-channel state
    throttleTimer = [];
    lastStatus = [];
    statusHistory = [];
    debugDivElements = [];
    deviceColors = {};
    lastColors = {};

    // Reconnect MQTT if configured
    disconnectMqtt();
    if (config.mqtt && config.mqtt.brokerUrl) {
        connectMqtt(config.mqtt);
    }

    // Re-create debug elements
    const existing = document.getElementById('debugDivElement');
    if (existing) existing.remove();
    debugDivElementsContainer = null;
    createDebugElements();
    fitToContainer(canvas);
}

// --- Settings Panel ---
function populateSettingsPanel(config) {
    const mode = (config.mqtt && config.mqtt.brokerUrl) ? 'mqtt' : 'http';
    document.getElementById('mode-http').checked = mode === 'http';
    document.getElementById('mode-mqtt').checked = mode === 'mqtt';
    document.getElementById('http-settings-section').style.display = mode === 'http' ? '' : 'none';
    document.getElementById('mqtt-settings-section').style.display = mode === 'mqtt' ? '' : 'none';

    document.getElementById('setting-ip-prefix').value = config.ipRangePrefix || '';
    document.getElementById('setting-max-freq').value = config.maxAudioFrequency || 280;
    document.getElementById('setting-default-delay').value = config.defaultDelay || 200;

    if (config.mqtt) {
        document.getElementById('setting-mqtt-url').value = config.mqtt.brokerUrl || '';
        document.getElementById('setting-mqtt-user').value = config.mqtt.username || '';
        document.getElementById('setting-mqtt-pass').value = config.mqtt.password || '';
    } else {
        document.getElementById('setting-mqtt-url').value = '';
        document.getElementById('setting-mqtt-user').value = '';
        document.getElementById('setting-mqtt-pass').value = '';
    }

    document.getElementById('setting-channels').value = JSON.stringify(config.channels || [], null, 2);
}

function readSettingsPanel() {
    const mode = document.querySelector('input[name="connection-mode"]:checked').value;
    const config = {
        ipRangePrefix: document.getElementById('setting-ip-prefix').value.trim(),
        maxAudioFrequency: parseInt(document.getElementById('setting-max-freq').value) || 280,
        defaultDelay: parseInt(document.getElementById('setting-default-delay').value) || 200,
        channels: []
    };

    if (mode === 'mqtt') {
        config.mqtt = {
            brokerUrl: document.getElementById('setting-mqtt-url').value.trim(),
            username: document.getElementById('setting-mqtt-user').value,
            password: document.getElementById('setting-mqtt-pass').value
        };
    }

    try {
        config.channels = JSON.parse(document.getElementById('setting-channels').value);
    } catch(e) {
        throw new Error('Invalid JSON in Channels field: ' + e.message);
    }

    return config;
}

function initSettingsPanel() {
    // Connection mode toggle
    document.querySelectorAll('input[name="connection-mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            const isMqtt = document.getElementById('mode-mqtt').checked;
            document.getElementById('http-settings-section').style.display = isMqtt ? 'none' : '';
            document.getElementById('mqtt-settings-section').style.display = isMqtt ? '' : 'none';
        });
    });

    // Save & Apply
    document.getElementById('settings-save').addEventListener('click', () => {
        const statusEl = document.getElementById('settings-status');
        try {
            const newConfig = readSettingsPanel();
            saveConfigToStorage(newConfig);
            applyConfig(newConfig);
            statusEl.textContent = '✓ Saved & applied';
            statusEl.className = 'settings-status-ok';
            setTimeout(() => { statusEl.textContent = ''; }, 3000);
        } catch(e) {
            statusEl.textContent = '✗ ' + e.message;
            statusEl.className = 'settings-status-error';
        }
    });

    // Reset from config.json
    document.getElementById('settings-reset').addEventListener('click', () => {
        const statusEl = document.getElementById('settings-status');
        fetch('./config.json')
            .then(r => r.json())
            .then(config => {
                populateSettingsPanel(config);
                statusEl.textContent = 'Loaded from config.json — click Save & Apply to use it';
                statusEl.className = '';
                setTimeout(() => { statusEl.textContent = ''; }, 4000);
            })
            .catch(e => {
                statusEl.textContent = '✗ Could not load config.json: ' + e.message;
                statusEl.className = 'settings-status-error';
            });
    });

    // Test MQTT connection (temporary client, does not affect active light control)
    document.getElementById('mqtt-test-btn').addEventListener('click', () => {
        const url = document.getElementById('setting-mqtt-url').value.trim();
        if (!url) {
            updateMqttStatusBadge('Enter a broker URL first', 'error');
            return;
        }
        if (typeof mqtt === 'undefined') {
            updateMqttStatusBadge('MQTT library not loaded', 'error');
            return;
        }
        updateMqttStatusBadge('Testing…', 'connecting');
        const testOpts = { connectTimeout: 5000 };
        const user = document.getElementById('setting-mqtt-user').value;
        const pass = document.getElementById('setting-mqtt-pass').value;
        if (user) testOpts.username = user;
        if (pass) testOpts.password = pass;
        const testClient = mqtt.connect(url, testOpts);
        testClient.on('connect', () => {
            updateMqttStatusBadge('✓ Connection successful', 'connected');
            testClient.end(true);
        });
        testClient.on('error', error => {
            updateMqttStatusBadge('✗ ' + error.message, 'error');
            testClient.end(true);
        });
    });
}

// --- Light control ---
function fillHTMLDebugData(channel, value) {
    if (debug !== true) return;
    if (debugDivElements[channel]) {
        debugDivElements[channel].textContent = value;
    }
}

function throttle(callable, delay, timerId, ...args) {
    if (throttleTimer[timerId]) return;
    callable(timerId, ...args);
    throttleTimer[timerId] = setTimeout(function() {
        throttleTimer[timerId] = undefined;
    }, delay);
}

function getColors(channelId, deviceId) {
    let colorId = `${channelId}.${deviceId}`;
    if (!deviceColors || !deviceColors[colorId] || deviceColors[colorId].length === 0) return false;

    throttle(function(colorId) {
        lastColors[colorId] = lastColors[colorId] === undefined ? -1 : parseInt(lastColors[colorId]);
        if (lastColors[colorId] >= deviceColors[colorId].length - 1) lastColors[colorId] = -1;
        lastColors[colorId]++;
    }, 1500, colorId);

    return deviceColors[colorId][lastColors[colorId]] || false;
}

function lightsHttp(channel, device, deviceId, turn, timer, calculatedBrightness) {
    let brightness = '';
    let color = '';
    if (dimmerables.indexOf(device.type) !== -1) {
        brightness = `&brightness=${calculatedBrightness}`;
    }
    if (colorful.indexOf(device.type) !== -1) {
        let colors = getColors(channel.name, deviceId);
        color = colors !== false ? `&red=${colors.red}&green=${colors.green}&blue=${colors.blue}` : '';
    }
    let requestOptions = { method: 'GET', redirect: 'follow', mode: 'no-cors' };
    fetch(`http://${ipRangePrefix}.${device.ip}/${shellyEndPoint(device.type)}/0?turn=${turn}${timer}${brightness}${color}`, requestOptions)
        .then(response => response.text())
        .catch(error => console.log('error', error));
}

function lightsMqtt(channel, device, deviceId, turn, calculatedBrightness) {
    const endpoint = shellyEndPoint(device.type);
    const deviceName = device.name;
    const commandTopic = `shellies/${deviceName}/${endpoint}/0/command`;

    mqttClient.publish(commandTopic, turn, error => { if (error) console.error('MQTT publish error', error); });

    if (dimmerables.indexOf(device.type) !== -1) {
        const setTopic = `shellies/${deviceName}/${endpoint}/0/set`;
        const payload = { brightness: calculatedBrightness };

        if (colorful.indexOf(device.type) !== -1) {
            let colors = getColors(channel.name, deviceId);
            if (colors !== false) {
                payload.red = colors.red;
                payload.green = colors.green;
                payload.blue = colors.blue;
            }
        }

        mqttClient.publish(setTopic, JSON.stringify(payload), error => { if (error) console.error('MQTT publish error', error); });
    }
}

function lights(channelId, turnOn, calculatedBrightness) {
    if (channelId === undefined) return;
    statusHistory[channelId].push(turnOn);

    if (false === turnOn && turnOn === lastStatus[channelId]) return;
    lastStatus[channelId] = turnOn;
    let channel = channels[channelId];
    let turn = turnOn ? 'on' : 'off';
    let timer = turnOn ? '&timer=1' : '';

    if (!channel.devices) return;

    channel.devices.forEach((device, deviceId) => {
        if (mqttClient !== null) {
            lightsMqtt(channel, device, deviceId, turn, calculatedBrightness);
        } else {
            lightsHttp(channel, device, deviceId, turn, timer, calculatedBrightness);
        }
    });
}

// --- Canvas / Audio helpers ---
function fitToContainer(canvas) {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
}

function calculateChannel(bar) {
    const percent = Math.floor((bar / maxAudioFrequency) * 100);
    let channel = Math.ceil(percent / percentFactor) - 1;
    if (channel < 0) channel = 0;
    else if (channel >= channels.length) channel = channels.length - 1;
    return channel;
}

function drawLightShow(channel, audioValue, bar) {
    if (document.getElementById('activate-lights-show').checked !== true) return;
    if (channel > lastCalculatedChannel || bar === maxAudioFrequency) {
        if (bar === maxAudioFrequency) lastCalculatedChannel = channel;

        if (statusHistory[lastCalculatedChannel] === undefined) statusHistory[lastCalculatedChannel] = [];
        let channelThreshold = channels[lastCalculatedChannel].threshold || threshold;
        const lastFiveHistoricalStatus = statusHistory[lastCalculatedChannel].slice(-numberOflastTurnOns);
        const throttleDelay = channels[lastCalculatedChannel].delay || activeConfig.defaultDelay || 500;

        if (lastFiveHistoricalStatus.length > 0) {
            const lastTurnOns = lastFiveHistoricalStatus.reduce((accumulator, currentValue) => accumulator + currentValue) || 0;
            const turnOnsFactor = lastTurnOns / numberOflastTurnOns;
            if (turnOnsFactor >= 1) channelThreshold = channelThreshold * 1.5;
            else if (turnOnsFactor <= 0.3) channelThreshold = channelThreshold * 0.8;
        }

        let calculatedValue = Math.floor(channelValuesSum / channelValuesCount);
        let turnOn = (calculatedValue >= channelThreshold);
        let calculatedBrightness = Math.ceil((calculatedValue / 256) * 100) || 1;

        fillHTMLDebugData(lastCalculatedChannel, `${Math.floor(channelValuesSum / channelValuesCount)} - ${channelThreshold}`);
        throttle(lights, throttleDelay, lastCalculatedChannel, turnOn, calculatedBrightness);
        channelValuesCount = 1;
        channelValuesSum = 0;
    }
    channelValuesCount++;
    channelValuesSum = channelValuesSum + audioValue;
    lastCalculatedChannel = channel;
}

// --- Main ---
fetch('./songs.json')
.then(response => response.json())
.then(songs => {
    songs.forEach(song => {
        let option = document.createElement("option");
        option.value = song.src;
        option.text = song.name;
        songsSelectorElement.add(option);
    });

    songsSelectorElement.addEventListener('change', event => {
        if (event.target === undefined) return;
        audioElement.src = event.target.value;
    });

    if (songs.length === 0) return;

    audioElement.src = songs[0].src;

    const audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(audioElement);
    const canvasContext = canvas.getContext("2d");
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = analyserSize;
    source.connect(analyser);
    // this connects our music back to the default output, such as your speakers
    source.connect(audioContext.destination);
    let audioData = new Uint8Array(analyser.frequencyBinCount);

    function draw(data) {
        data = [...data];
        canvasContext.clearRect(0, 0, canvas.width, canvas.height);
        let space = (canvas.width / maxAudioFrequency);

        channelValuesSum = 0;
        channelValuesCount = 1;
        lastCalculatedChannel = 0;
        if (channels.length === 0) return;
        data.forEach((audioValue, bar) => {
            let channel = calculateChannel(bar);
            canvasContext.beginPath();
            canvasContext.moveTo(space * bar, canvas.height - (canvas.height / 3));
            canvasContext.lineTo(space * bar, canvas.height - (audioValue * 1.2));
            canvasContext.lineWidth = space / 2;
            canvasContext.strokeStyle = channels[channel].color;
            canvasContext.stroke();
            drawLightShow(channel, audioValue, bar);
        });
    }

    function loopingFunction() {
        requestAnimationFrame(loopingFunction);
        analyser.getByteFrequencyData(audioData);
        // analyser.getByteTimeDomainData(audioData);
        audioData.slice(maxAudioFrequency);
        draw(audioData);
    }

    audioElement.onplay = () => audioContext.resume();

    audioElement.onended = () => {
        if (songsSelectorElement.selectedIndex >= (songs.length - 1)) {
            if (!document.getElementById('replay-songs-list').checked) return;
            songsSelectorElement.selectedIndex = -1;
        }
        songsSelectorElement.selectedIndex++;
        songsSelectorElement.dispatchEvent(new Event('change'));
        setTimeout(() => audioElement.play(), 1000);
    };

    // Initialize settings panel event handlers
    initSettingsPanel();

    // Load config (localStorage first, then config.json) and start
    loadConfig()
        .then(config => {
            populateSettingsPanel(config);
            applyConfig(config);
            requestAnimationFrame(loopingFunction);
        })
        .catch(error => {
            console.error('Error loading config:', error);
            // Still start the animation even without config
            requestAnimationFrame(loopingFunction);
        });
}).catch(error => {
    console.error('Error:', error);
});
