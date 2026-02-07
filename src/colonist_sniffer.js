  /**
 * Colonist.io Board Data Extractor v3.0
 * 
 * ENHANCED: Multiple extraction methods - Global state, Socket.io, DOM parsing
 * 
 * Paste this entire script into your browser's Dev Console during a game.
 * Works even if game already started!
 * 
 * Based on HDCS (High-Density Catan State) format from WPP Planning.
 */

(function() {
    'use strict';
    
    console.log("🎲 Colonist Sniffer v3.0 Starting...");

    // ==================== CONSTANTS ====================
    
    // Resource mapping: Colonist internal -> HDCS index
    // HDCS: 0=Wood, 1=Brick, 2=Wool, 3=Grain, 4=Ore, 5=Desert, 6=Ocean
    const RESOURCE_MAP = {
        'Lumber': 0, 'lumber': 0, 'wood': 0, 'Wood': 0, 'LUMBER': 0, 'WOOD': 0,
        'Brick': 1, 'brick': 1, 'BRICK': 1,
        'Wool': 2, 'wool': 2, 'sheep': 2, 'Sheep': 2, 'WOOL': 2, 'SHEEP': 2,
        'Grain': 3, 'grain': 3, 'wheat': 3, 'Wheat': 3, 'GRAIN': 3, 'WHEAT': 3,
        'Ore': 4, 'ore': 4, 'stone': 4, 'Stone': 4, 'ORE': 4,
        'Desert': 5, 'desert': 5, 'DESERT': 5,
        'Sea': 6, 'sea': 6, 'ocean': 6, 'Ocean': 6, 'water': 6, 'SEA': 6
    };
    
    // Numeric resource IDs used by colonist.io (discovered values)
    const RESOURCE_ID_MAP = {
        0: 6,  // Sea/Ocean
        1: 0,  // Lumber/Wood  
        2: 1,  // Brick
        3: 2,  // Wool/Sheep
        4: 3,  // Grain/Wheat
        5: 4,  // Ore
        6: 5   // Desert
    };
    
    // Log message snippets
    const SNIPPETS = {
        initialPlacementDone: "Giving out starting resources",
        placeSettlement: "turn to place",
        gotResources: "got:",
        built: "built a",
        bought: " bought ",
        tradeBankGave: "gave bank:",
        tradeBankTook: "and took",
        stoleAllOf: "stole all of",
        discarded: "discarded",
        tradedWith: " traded with: ",
        wantsToGive: "wants to give:",
        giveFor: "for:",
        stoleResource: "stole:",
        stoleFrom: " stole  from: ",
        rolled: " rolled ",
        movedRobber: "moved Robber"
    };
    
    // ==================== STATE ====================
    
    let gameState = {
        meta: {
            t: 0,
            p_curr: 0,
            phase: "init",
            dice: [],
            dev_rem: [14, 5, 2, 2, 2]
        },
        map: {
            robber: -1,
            tiles: [],
            ports: {},
            nodes: {},
            edges: {}
        },
        players: []
    };
    
    let logElement = null;
    let players = [];
    let playerColors = {};
    let resources = {};
    let MSG_OFFSET = 0;
    let initialized = false;
    let wsMessages = [];
    let boardInitialized = false;
    let colonistGameState = null; // Reference to colonist's internal state
    
    // ==================== GLOBAL STATE DISCOVERY ====================
    
    // Exposed decoder reference (found at runtime)
    let msgpackDecoder = null;
    
    function findMessagePackDecoder() {
        console.log("🔍 Searching for MessagePack decoder...");
        
        // Common MessagePack library names
        const decoderNames = [
            'msgpack', 'MessagePack', 'msgpackr', 'msgpack5', 
            'msgpackLite', 'msgpack_lite', 'notepack', 'Notepack'
        ];
        
        // Check window directly
        for (const name of decoderNames) {
            if (window[name]) {
                console.log(`  🎯 Found window.${name}!`);
                msgpackDecoder = window[name];
                return window[name];
            }
        }
        
        // Search in window properties - but be careful to find actual decoders
        for (const key of Object.keys(window)) {
            try {
                const val = window[key];
                if (val && typeof val === 'object' && !(val instanceof HTMLElement) && !(val instanceof Node)) {
                    // Check for decode/unpack methods that look like msgpack
                    if (typeof val.decode === 'function' && typeof val.encode === 'function') {
                        // Verify it's not just any object with decode
                        const funcStr = val.decode.toString();
                        if (funcStr.includes('buffer') || funcStr.includes('byte') || funcStr.includes('pack')) {
                            console.log(`  🎯 Found decoder at window.${key}`);
                            msgpackDecoder = val;
                            return val;
                        }
                    }
                    if (typeof val.unpack === 'function' && typeof val.pack === 'function') {
                        console.log(`  🎯 Found packer at window.${key}`);
                        msgpackDecoder = val;
                        return val;
                    }
                }
            } catch (e) {}
        }
        
        // Search in require/modules if webpack
        if (window.webpackChunk || window.webpackChunkcolonist) {
            console.log("  Webpack detected, searching modules...");
            const found = searchWebpackModules();
            if (found) return found;
        }
        
        console.log("  ❌ No MessagePack decoder found in window");
        return null;
    }
    
    function searchWebpackModules() {
        // Try to access webpack modules
        try {
            const chunks = window.webpackChunk || window.webpackChunkcolonist || [];
            for (const chunk of chunks) {
                if (Array.isArray(chunk) && chunk[1]) {
                    const modules = chunk[1];
                    for (const id of Object.keys(modules)) {
                        try {
                            const mod = {};
                            modules[id](mod, {}, () => {});
                            if (mod.exports && (mod.exports.decode || mod.exports.unpack)) {
                                console.log(`  🎯 Found decoder in webpack module ${id}!`);
                                msgpackDecoder = mod.exports;
                                return mod.exports;
                            }
                        } catch (e) {}
                    }
                }
            }
        } catch (e) {
            console.log("  Error searching webpack:", e.message);
        }
    }
    
    function findColonistGameState() {
        console.log("🔍 Searching for game state in global scope...");
        
        // First, find MessagePack decoder
        findMessagePackDecoder();
        
        // Common places colonist might store state
        const candidates = [
            // Direct window properties
            'gameState', 'game', 'state', 'GameState', 'Game',
            'colonist', 'Colonist', 'app', 'App', '__GAME__',
            // Vue/Nuxt
            '__NUXT__', '__VUE__', '$nuxt',
            // React
            '__REACT_DEVTOOLS_GLOBAL_HOOK__',
            // Angular
            'ng',
            // Generic stores
            'store', 'Store', '__STORE__'
        ];
        
        for (const key of candidates) {
            if (window[key]) {
                console.log(`  Found window.${key}:`, typeof window[key]);
                inspectObject(window[key], key, 0);
            }
        }
        
        // Search for hexes/tiles in all window properties
        for (const key of Object.keys(window)) {
            try {
                const val = window[key];
                if (val && typeof val === 'object') {
                    if (val.hexes || val.tiles || val.board) {
                        console.log(`  🎯 Found game data in window.${key}!`);
                        colonistGameState = val;
                        return val;
                    }
                }
            } catch (e) {}
        }
        
        // Check Nuxt specifically
        if (window.$nuxt) {
            try {
                const nuxtState = window.$nuxt.$store?.state || window.$nuxt._data;
                if (nuxtState) {
                    console.log("  Found Nuxt state:", nuxtState);
                    return nuxtState;
                }
            } catch (e) {}
        }
        
        // Check for socket.io
        findSocketIO();
        
        return null;
    }
    
    function inspectObject(obj, path, depth) {
        if (depth > 3 || !obj) return;
        
        const gameKeys = ['hexes', 'tiles', 'board', 'map', 'players', 'robber', 'harbours', 'harbors'];
        
        for (const key of Object.keys(obj).slice(0, 50)) {
            try {
                const val = obj[key];
                if (gameKeys.includes(key.toLowerCase())) {
                    console.log(`    🎯 ${path}.${key}:`, val);
                    if (key.toLowerCase() === 'hexes' || key.toLowerCase() === 'tiles') {
                        colonistGameState = obj;
                    }
                }
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    inspectObject(val, `${path}.${key}`, depth + 1);
                }
            } catch (e) {}
        }
    }
    
    // ==================== SOCKET.IO INTERCEPTION ====================
    
    function findSocketIO() {
        console.log("🔍 Looking for Socket.IO...");
        
        // Check if socket.io is loaded
        if (window.io) {
            console.log("  Found socket.io!");
            hookSocketIO(window.io);
        }
        
        // Check for existing socket instances
        const socketKeys = ['socket', 'Socket', 'ws', 'websocket', 'conn', 'connection'];
        for (const key of socketKeys) {
            if (window[key]) {
                console.log(`  Found window.${key}`);
                hookExistingSocket(window[key]);
            }
        }
    }
    
    // ==================== FIND EXISTING WEBSOCKETS ====================
    
    let hookedSockets = new Set();
    
    function findExistingWebSockets() {
        console.log("🔍 Searching for existing WebSocket connections...");
        let found = 0;
        
        // Method 1: Search ALL objects recursively
        const searched = new WeakSet();
        
        function searchObject(obj, path, depth) {
            if (depth > 8 || !obj) return;
            
            try {
                if (searched.has(obj)) return;
                searched.add(obj);
            } catch (e) { return; }
            
            if (typeof obj !== 'object' && typeof obj !== 'function') return;
            
            // Check if this is a WebSocket
            try {
                if (obj instanceof OriginalWebSocket || 
                    (obj && obj.constructor && obj.constructor.name === 'WebSocket') ||
                    (obj && obj.readyState !== undefined && obj.send && obj.close && obj.url)) {
                    if (!hookedSockets.has(obj)) {
                        console.log(`  🔌 Found WebSocket at ${path}:`, obj.url, `(state: ${obj.readyState})`);
                        hookLiveWebSocket(obj);
                        found++;
                    }
                    return;
                }
            } catch (e) {}
            
            // Check for socket.io socket
            try {
                if (obj && obj.io && obj.connected !== undefined) {
                    console.log(`  🔌 Found Socket.IO at ${path}`);
                    hookSocketIOInstance(obj);
                    found++;
                    return;
                }
            } catch (e) {}
            
            // Search properties
            try {
                const keys = Object.keys(obj);
                for (const key of keys.slice(0, 150)) {
                    try {
                        const val = obj[key];
                        if (val && (typeof val === 'object' || typeof val === 'function')) {
                            searchObject(val, `${path}.${key}`, depth + 1);
                        }
                    } catch (e) {}
                }
            } catch (e) {}
            
            // Also check prototype chain for hidden properties
            try {
                const proto = Object.getPrototypeOf(obj);
                if (proto && proto !== Object.prototype) {
                    searchObject(proto, `${path}.__proto__`, depth + 1);
                }
            } catch (e) {}
        }
        
        // Search common framework locations first
        const priorityRoots = [
            '$nuxt', '__NUXT__', '__nuxt__',
            'Vue', 'vue', '__vue__', '__VUE__',
            'app', 'App', '__app__', 
            'socket', 'Socket', 'io', '_io',
            'game', 'Game', '__game__', '_game',
            'store', 'Store', '__store__',
            'colonist', 'Colonist', '_colonist',
            'connection', 'conn', 'ws', '_ws', '_socket',
            'client', 'Client', '_client',
            'manager', 'Manager'
        ];
        
        for (const key of priorityRoots) {
            if (window[key]) {
                searchObject(window[key], `window.${key}`, 0);
            }
        }
        
        // Search $nuxt internals specifically (Nuxt.js app)
        if (window.$nuxt) {
            try {
                // $nuxt.$root is the Vue root instance
                const root = window.$nuxt.$root || window.$nuxt;
                searchObject(root, '$nuxt.$root', 0);
                
                // Check _data, $data
                if (root._data) searchObject(root._data, '$nuxt._data', 0);
                if (root.$data) searchObject(root.$data, '$nuxt.$data', 0);
                
                // Check for socket in $options
                if (root.$options) searchObject(root.$options, '$nuxt.$options', 0);
                
                // Recursively search all Vue component instances
                function searchVueComponent(comp, path, depth) {
                    if (depth > 10 || !comp) return;
                    
                    // Check common socket property names
                    const socketProps = ['socket', 'ws', '_socket', '$socket', 'connection', 'io'];
                    for (const prop of socketProps) {
                        if (comp[prop]) {
                            searchObject(comp[prop], `${path}.${prop}`, 0);
                        }
                    }
                    
                    // Search children
                    if (comp.$children) {
                        comp.$children.forEach((child, i) => {
                            searchVueComponent(child, `${path}.$children[${i}]`, depth + 1);
                        });
                    }
                }
                
                searchVueComponent(root, '$nuxt', 0);
            } catch (e) {
                console.log("  Error searching $nuxt:", e.message);
            }
        }
        
        // Search window properties (broader search)
        const allKeys = Object.keys(window);
        for (const key of allKeys) {
            // Skip known non-useful globals
            if (['location', 'document', 'navigator', 'performance', 'localStorage', 
                 'sessionStorage', 'indexedDB', 'crypto', 'caches'].includes(key)) continue;
            
            try {
                const val = window[key];
                if (val && typeof val === 'object' && !Array.isArray(val)) {
                    searchObject(val, `window.${key}`, 0);
                }
            } catch (e) {}
        }
        
        console.log(`  Found ${found} WebSocket connection(s)`);
        return found;
    }
    
    function hookLiveWebSocket(ws) {
        if (hookedSockets.has(ws)) return;
        hookedSockets.add(ws);
        
        console.log(`  🎣 Hooking live WebSocket (state: ${ws.readyState}, url: ${ws.url})`);
        
        // Store original onmessage
        const originalOnMessage = ws.onmessage;
        
        // Override onmessage - only use ONE method to avoid duplicates
        ws.onmessage = function(event) {
            // Use a message ID to prevent duplicate captures
            const msgId = Date.now() + '_' + Math.random();
            if (!event._snifferId) {
                event._snifferId = msgId;
                captureMessage(event.data);
            }
            if (originalOnMessage) {
                return originalOnMessage.apply(this, arguments);
            }
        };
        
        // DON'T add addEventListener - it causes duplicate messages
        // The onmessage override is sufficient
        
        console.log("  ✅ WebSocket hooked! Future messages will be captured.");
        
        // Try to get buffered data if available
        if (ws._buffer || ws.buffer) {
            console.log("  Found message buffer:", ws._buffer || ws.buffer);
        }
    }
    
    function hookSocketIOInstance(socket) {
        console.log("  🎣 Hooking Socket.IO instance...");
        
        // Hook all events
        const originalOn = socket.on;
        socket.on = function(event, callback) {
            const wrappedCallback = function(...args) {
                console.log(`📨 Socket.IO event '${event}':`, args);
                wsMessages.push({type: 'socketio', event, data: args});
                
                // Process game-related events
                if (args[0] && typeof args[0] === 'object') {
                    processSocketIOData(args[0]);
                }
                
                return callback.apply(this, args);
            };
            return originalOn.call(this, event, wrappedCallback);
        };
        
        // Hook emit for outgoing
        const originalEmit = socket.emit;
        socket.emit = function(event, ...args) {
            console.log(`📤 Socket.IO emit '${event}':`, args);
            wsMessages.push({type: 'socketio-out', event, data: args});
            return originalEmit.apply(this, arguments);
        };
        
        // Try to access internal engine
        if (socket.io && socket.io.engine) {
            const engine = socket.io.engine;
            console.log("  Found Socket.IO engine, transport:", engine.transport?.name);
            
            if (engine.transport && engine.transport.ws) {
                hookLiveWebSocket(engine.transport.ws);
            }
        }
    }
    
    function hookSocketIO(io) {
        const originalManager = io.Manager;
        if (originalManager) {
            io.Manager = function(uri, opts) {
                const manager = new originalManager(uri, opts);
                console.log("🔌 Socket.IO Manager intercepted:", uri);
                
                manager.on('packet', (packet) => {
                    console.log("📨 Socket.IO packet:", packet);
                    wsMessages.push(packet);
                    if (packet.data) {
                        processSocketIOData(packet.data);
                    }
                });
                
                return manager;
            };
        }
    }
    
    function hookExistingSocket(socket) {
        if (!socket) return;
        
        // Try to hook the onmessage
        if (socket.onmessage) {
            const original = socket.onmessage;
            socket.onmessage = function(event) {
                captureMessage(event.data);
                return original.apply(this, arguments);
            };
            console.log("  Hooked existing socket.onmessage");
        }
        
        // socket.io style
        if (socket.on) {
            const events = ['message', 'data', 'game', 'gameState', 'update', 'state'];
            events.forEach(evt => {
                try {
                    socket.on(evt, (data) => {
                        console.log(`📨 Socket event '${evt}':`, data);
                        wsMessages.push({event: evt, data});
                        processSocketIOData(data);
                    });
                } catch (e) {}
            });
        }
    }
    
    function captureMessage(data) {
        try {
            let parsed;
            if (typeof data === 'string') {
                // Socket.IO format: "42["event",{data}]"
                const match = data.match(/^\d+(.*)$/);
                if (match) {
                    parsed = JSON.parse(match[1]);
                } else {
                    parsed = JSON.parse(data);
                }
                wsMessages.push(parsed);
                processSocketIOData(parsed);
            } else if (data instanceof ArrayBuffer || data instanceof Uint8Array) {
                // Binary data - colonist.io uses binary protocol
                const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
                
                // Try to decode as MessagePack or custom binary format
                const decoded = decodeBinaryMessage(bytes);
                wsMessages.push(decoded);
                
                if (decoded.parsed) {
                    processSocketIOData(decoded.parsed);
                }
            } else if (data instanceof Blob) {
                // Blob - need to read it
                data.arrayBuffer().then(buffer => {
                    const bytes = new Uint8Array(buffer);
                    const decoded = decodeBinaryMessage(bytes);
                    wsMessages.push(decoded);
                    if (decoded.parsed) {
                        processSocketIOData(decoded.parsed);
                    }
                });
            } else {
                parsed = data;
                wsMessages.push(parsed);
                processSocketIOData(parsed);
            }
        } catch (e) {
            // Store raw if can't parse
            wsMessages.push({raw: data, error: e.message});
        }
    }
    
    // ==================== BINARY MESSAGE DECODING ====================
    
    function decodeBinaryMessage(bytes) {
        const result = {
            size: bytes.length,
            hex: Array.from(bytes.slice(0, 50)).map(b => b.toString(16).padStart(2, '0')).join(' '),
            parsed: null
        };
        
        // Try 1: Simple MessagePack-like decoding
        try {
            const decoded = decodeMessagePack(bytes);
            if (decoded) {
                result.parsed = decoded;
                result.format = 'msgpack';
                console.log("📦 Decoded binary message:", decoded);
                return result;
            }
        } catch (e) {}
        
        // Try 2: Check if it's UTF-8 text wrapped in binary
        try {
            const text = new TextDecoder('utf-8').decode(bytes);
            // Check if it looks like JSON
            if (text.startsWith('{') || text.startsWith('[')) {
                result.parsed = JSON.parse(text);
                result.format = 'json-binary';
                console.log("📦 Decoded JSON from binary:", result.parsed);
                return result;
            }
            // Check for Socket.IO format
            const match = text.match(/^\d+(.*)$/);
            if (match && match[1]) {
                try {
                    result.parsed = JSON.parse(match[1]);
                    result.format = 'socketio-binary';
                    return result;
                } catch (e) {}
            }
            result.text = text.slice(0, 200);
        } catch (e) {}
        
        // Try 3: Look for known patterns in the binary data
        // Colonist likely uses a custom protocol with message type IDs
        result.firstByte = bytes[0];
        result.possibleType = identifyMessageType(bytes);
        
        return result;
    }
    
    // Simple MessagePack decoder for common types
    function decodeMessagePack(bytes) {
        let offset = 0;
        
        function read() {
            if (offset >= bytes.length) return undefined;
            const byte = bytes[offset++];
            
            // Positive fixint (0x00 - 0x7f)
            if (byte <= 0x7f) return byte;
            
            // Fixmap (0x80 - 0x8f)
            if (byte >= 0x80 && byte <= 0x8f) {
                const size = byte & 0x0f;
                const obj = {};
                for (let i = 0; i < size; i++) {
                    const key = read();
                    const value = read();
                    obj[key] = value;
                }
                return obj;
            }
            
            // Fixarray (0x90 - 0x9f)
            if (byte >= 0x90 && byte <= 0x9f) {
                const size = byte & 0x0f;
                const arr = [];
                for (let i = 0; i < size; i++) {
                    arr.push(read());
                }
                return arr;
            }
            
            // Fixstr (0xa0 - 0xbf)
            if (byte >= 0xa0 && byte <= 0xbf) {
                const size = byte & 0x1f;
                const str = new TextDecoder().decode(bytes.slice(offset, offset + size));
                offset += size;
                return str;
            }
            
            // nil (0xc0)
            if (byte === 0xc0) return null;
            
            // false (0xc2)
            if (byte === 0xc2) return false;
            
            // true (0xc3)
            if (byte === 0xc3) return true;
            
            // uint8 (0xcc)
            if (byte === 0xcc) return bytes[offset++];
            
            // uint16 (0xcd)
            if (byte === 0xcd) {
                const val = (bytes[offset] << 8) | bytes[offset + 1];
                offset += 2;
                return val;
            }
            
            // uint32 (0xce)
            if (byte === 0xce) {
                const val = (bytes[offset] << 24) | (bytes[offset + 1] << 16) | 
                           (bytes[offset + 2] << 8) | bytes[offset + 3];
                offset += 4;
                return val >>> 0;
            }
            
            // int8 (0xd0)
            if (byte === 0xd0) {
                const val = bytes[offset++];
                return val > 127 ? val - 256 : val;
            }
            
            // str8 (0xd9)
            if (byte === 0xd9) {
                const size = bytes[offset++];
                const str = new TextDecoder().decode(bytes.slice(offset, offset + size));
                offset += size;
                return str;
            }
            
            // str16 (0xda)
            if (byte === 0xda) {
                const size = (bytes[offset] << 8) | bytes[offset + 1];
                offset += 2;
                const str = new TextDecoder().decode(bytes.slice(offset, offset + size));
                offset += size;
                return str;
            }
            
            // array16 (0xdc)
            if (byte === 0xdc) {
                const size = (bytes[offset] << 8) | bytes[offset + 1];
                offset += 2;
                const arr = [];
                for (let i = 0; i < size; i++) {
                    arr.push(read());
                }
                return arr;
            }
            
            // map16 (0xde)
            if (byte === 0xde) {
                const size = (bytes[offset] << 8) | bytes[offset + 1];
                offset += 2;
                const obj = {};
                for (let i = 0; i < size; i++) {
                    const key = read();
                    const value = read();
                    obj[key] = value;
                }
                return obj;
            }
            
            // Negative fixint (0xe0 - 0xff)
            if (byte >= 0xe0) return byte - 256;
            
            // Unknown type - return raw byte
            return {_raw: byte};
        }
        
        try {
            return read();
        } catch (e) {
            return null;
        }
    }
    
    function identifyMessageType(bytes) {
        // Try to identify colonist.io message types based on patterns
        const firstByte = bytes[0];
        
        // Common message type patterns (these are guesses)
        const typeGuesses = {
            0x00: 'ping/pong',
            0x01: 'game_state',
            0x02: 'player_action',
            0x03: 'chat',
            0x04: 'dice_roll',
            0x05: 'trade',
            0x06: 'build',
            0x07: 'robber',
            0x10: 'game_start',
            0x11: 'turn_change'
        };
        
        return typeGuesses[firstByte] || `unknown_${firstByte.toString(16)}`;
    }
    
    function processSocketIOData(data) {
        if (!data) return;
        
        // Handle array format from socket.io: ["eventName", {payload}]
        if (Array.isArray(data)) {
            const [eventName, payload] = data;
            console.log(`📨 Event: ${eventName}`, payload);
            
            if (payload && typeof payload === 'object') {
                processWebSocketMessage(payload);
            }
            return;
        }
        
        processWebSocketMessage(data);
    }
    
    // ==================== WEBSOCKET INTERCEPTION (FUTURE CONNECTIONS) ====================
    
    const OriginalWebSocket = window.WebSocket;
    let activeSocket = null;
    
    // Method 1: Replace constructor (works for new connections)
    window.WebSocket = function(url, protocols) {
        console.log("🔌 WebSocket connection intercepted:", url);
        
        const ws = protocols 
            ? new OriginalWebSocket(url, protocols) 
            : new OriginalWebSocket(url);
        
        activeSocket = ws;
        hookedSockets.add(ws);
        
        ws.addEventListener('message', (event) => {
            captureMessage(event.data);
        });
        
        ws.addEventListener('open', () => {
            console.log("🟢 WebSocket connected");
        });
        
        ws.addEventListener('close', () => {
            console.log("🔴 WebSocket disconnected");
        });
        
        return ws;
    };
    
    // Copy prototype
    window.WebSocket.prototype = OriginalWebSocket.prototype;
    window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    window.WebSocket.OPEN = OriginalWebSocket.OPEN;
    window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
    window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
    
    // Method 2: Patch WebSocket.prototype to intercept ALL websockets (even those created with original constructor)
    const originalWSSend = OriginalWebSocket.prototype.send;
    OriginalWebSocket.prototype.send = function(data) {
        // Hook this socket if not already hooked
        if (!hookedSockets.has(this)) {
            console.log("🔌 Discovered WebSocket via send():", this.url);
            hookLiveWebSocket(this);
        }
        wsMessages.push({type: 'outgoing', data: typeof data === 'string' ? data : '[binary]'});
        return originalWSSend.apply(this, arguments);
    };
    
    // Method 3: Intercept addEventListener to catch message handlers
    const originalAddEventListener = OriginalWebSocket.prototype.addEventListener;
    OriginalWebSocket.prototype.addEventListener = function(type, listener, options) {
        if (!hookedSockets.has(this)) {
            console.log("🔌 Discovered WebSocket via addEventListener():", this.url);
            hookLiveWebSocket(this);
        }
        return originalAddEventListener.apply(this, arguments);
    };
    
    // Method 4: Intercept onmessage setter
    const originalOnMessageDesc = Object.getOwnPropertyDescriptor(OriginalWebSocket.prototype, 'onmessage');
    if (originalOnMessageDesc) {
        Object.defineProperty(OriginalWebSocket.prototype, 'onmessage', {
            set: function(handler) {
                if (!hookedSockets.has(this)) {
                    console.log("🔌 Discovered WebSocket via onmessage setter:", this.url);
                    hookLiveWebSocket(this);
                }
                // Wrap the handler - but check if already captured
                const wrappedHandler = function(event) {
                    // Only capture if not already captured by hookLiveWebSocket
                    if (!event._snifferId && !event._snifferProcessed) {
                        event._snifferProcessed = true;
                        captureMessage(event.data);
                    }
                    return handler.apply(this, arguments);
                };
                originalOnMessageDesc.set.call(this, wrappedHandler);
            },
            get: function() {
                return originalOnMessageDesc.get.call(this);
            },
            configurable: true
        });
    }
    
    console.log("  ✅ WebSocket prototype patched (send, addEventListener, onmessage)");
    
    // ==================== DOM-BASED BOARD EXTRACTION ====================
    
    function extractBoardFromDOM() {
        console.log("🔍 Attempting DOM-based board extraction...");
        
        // Look for hex elements with data attributes
        const hexElements = document.querySelectorAll('[class*="hex"], [data-hex], [data-tile], .tile, .hex');
        console.log(`  Found ${hexElements.length} potential hex elements`);
        
        if (hexElements.length > 0) {
            const tiles = [];
            hexElements.forEach((el, idx) => {
                const data = {
                    className: el.className,
                    dataset: {...el.dataset},
                    style: el.style.cssText,
                    id: el.id
                };
                
                // Try to extract resource type from class names
                const classStr = el.className.toLowerCase();
                let resource = 6; // Ocean default
                if (classStr.includes('lumber') || classStr.includes('wood') || classStr.includes('forest')) resource = 0;
                else if (classStr.includes('brick') || classStr.includes('clay') || classStr.includes('hill')) resource = 1;
                else if (classStr.includes('wool') || classStr.includes('sheep') || classStr.includes('pasture')) resource = 2;
                else if (classStr.includes('grain') || classStr.includes('wheat') || classStr.includes('field')) resource = 3;
                else if (classStr.includes('ore') || classStr.includes('rock') || classStr.includes('mountain')) resource = 4;
                else if (classStr.includes('desert')) resource = 5;
                
                // Look for number token
                const numberEl = el.querySelector('[class*="number"], [class*="chit"], [class*="token"]');
                const number = numberEl ? parseInt(numberEl.textContent) || 0 : 0;
                
                if (resource !== 6 || number > 0) {
                    tiles.push([resource, number]);
                    console.log(`    Tile ${idx}: resource=${resource}, number=${number}`);
                }
            });
            
            if (tiles.length > 0) {
                gameState.map.tiles = tiles;
                boardInitialized = true;
                return true;
            }
        }
        
        // Try to find data in SVG elements
        const svgHexes = document.querySelectorAll('svg [class*="hex"], svg polygon, svg path');
        console.log(`  Found ${svgHexes.length} SVG hex elements`);
        
        // Check for canvas - can't extract data but note it
        const canvas = document.querySelector('canvas');
        if (canvas) {
            console.log("  ⚠️ Game uses canvas - can't extract tile data from pixels");
        }
        
        return false;
    }
    
    // ==================== NETWORK REQUEST INTERCEPTION ====================
    
    function hookFetch() {
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const response = await originalFetch.apply(this, args);
            
            // Clone to read without consuming
            const clone = response.clone();
            try {
                const data = await clone.json();
                if (data.hexes || data.tiles || data.board || data.gameState) {
                    console.log("📡 Fetch response with game data:", data);
                    wsMessages.push({type: 'fetch', data});
                    processWebSocketMessage(data);
                }
            } catch (e) {}
            
            return response;
        };
        console.log("  Hooked fetch()");
    }
    
    function hookXHR() {
        const originalOpen = XMLHttpRequest.prototype.open;
        const originalSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url) {
            this._url = url;
            return originalOpen.apply(this, arguments);
        };
        
        XMLHttpRequest.prototype.send = function() {
            this.addEventListener('load', function() {
                try {
                    const data = JSON.parse(this.responseText);
                    if (data.hexes || data.tiles || data.board || data.gameState) {
                        console.log("📡 XHR response with game data:", data);
                        wsMessages.push({type: 'xhr', url: this._url, data});
                        processWebSocketMessage(data);
                    }
                } catch (e) {}
            });
            return originalSend.apply(this, arguments);
        };
        console.log("  Hooked XMLHttpRequest");
    }
    
    // ==================== WEBSOCKET MESSAGE PROCESSING ====================
    
    function processWebSocketMessage(data) {
        // Log all message types for debugging
        if (data.type || data.id || data.action) {
            console.log("📨 WS:", data.type || data.id || data.action, data);
        }
        
        // Game setup / board initialization
        if (data.type === 'gameState' || data.type === 'game_state' || 
            data.id === 'gameState' || data.payload?.hexes) {
            parseGameState(data.payload || data);
        }
        
        // Alternative: Look for hex data anywhere
        if (data.hexes || data.board?.hexes || data.state?.hexes) {
            parseHexData(data.hexes || data.board?.hexes || data.state?.hexes);
        }
        
        // Player info
        if (data.players || data.payload?.players) {
            parsePlayersFromWS(data.players || data.payload?.players);
        }
        
        // Dice roll
        if (data.type === 'diceRoll' || data.action === 'roll' || data.dice) {
            const roll = data.dice?.sum || data.value || (data.dice?.[0] + data.dice?.[1]);
            if (roll) {
                gameState.meta.dice.unshift(roll);
                if (gameState.meta.dice.length > 8) gameState.meta.dice.pop();
                gameState.meta.t++;
                console.log("🎲 Dice:", roll);
            }
        }
        
        // Robber movement
        if (data.type === 'moveRobber' || data.action === 'robber' || data.robberHex !== undefined) {
            const robberTile = data.robberHex ?? data.hex ?? data.tile;
            if (robberTile !== undefined) {
                gameState.map.robber = robberTile;
                console.log("🏴‍☠️ Robber moved to tile:", robberTile);
            }
        }
        
        // Building
        if (data.type === 'build' || data.action === 'build') {
            handleBuildMessage(data);
        }
        
        // Turn change
        if (data.type === 'turnChange' || data.currentPlayer !== undefined) {
            gameState.meta.p_curr = data.currentPlayer ?? data.player ?? 0;
        }
    }
    
    function parseGameState(state) {
        console.log("🗺️ Parsing game state...", state);
        
        if (state.hexes) {
            parseHexData(state.hexes);
        }
        
        if (state.harbours || state.harbors || state.ports) {
            parsePortData(state.harbours || state.harbors || state.ports);
        }
        
        if (state.robberHex !== undefined || state.robber !== undefined) {
            gameState.map.robber = state.robberHex ?? state.robber;
        }
        
        if (state.players) {
            parsePlayersFromWS(state.players);
        }
        
        if (state.roads) {
            parseRoads(state.roads);
        }
        
        if (state.settlements) {
            parseSettlements(state.settlements);
        }
        
        if (state.cities) {
            parseCities(state.cities);
        }
        
        boardInitialized = true;
        gameState.meta.phase = "main";
        printState();
    }
    
    function parseHexData(hexes) {
        console.log("🔷 Parsing", hexes.length, "hexes...");
        
        // Initialize 37 tiles (including ocean ring)
        gameState.map.tiles = [];
        
        // Create mapping from hex coordinates to tile IDs
        // This depends on colonist.io's coordinate system
        for (let i = 0; i < 37; i++) {
            gameState.map.tiles.push([6, 0]); // Default to ocean
        }
        
        hexes.forEach((hex, idx) => {
            const resourceType = hex.type ?? hex.resource ?? hex.resourceType;
            const diceNumber = hex.number ?? hex.diceNumber ?? hex.chit ?? 0;
            
            // Map resource type to HDCS format
            let hdcsResource = 6; // Default ocean
            if (typeof resourceType === 'number') {
                hdcsResource = RESOURCE_ID_MAP[resourceType] ?? 6;
            } else if (typeof resourceType === 'string') {
                hdcsResource = RESOURCE_MAP[resourceType] ?? 6;
            }
            
            // Try to determine tile index from coordinates
            let tileIdx = idx;
            if (hex.x !== undefined && hex.y !== undefined) {
                tileIdx = coordsToTileId(hex.x, hex.y, hex.z);
            } else if (hex.id !== undefined) {
                tileIdx = hex.id;
            }
            
            if (tileIdx >= 0 && tileIdx < 37) {
                gameState.map.tiles[tileIdx] = [hdcsResource, diceNumber];
            }
            
            // Check for robber
            if (hex.hasRobber || hex.robber) {
                gameState.map.robber = tileIdx;
            }
        });
        
        console.log("✅ Tiles parsed:", gameState.map.tiles.filter(t => t[0] !== 6).length, "land tiles");
    }
    
    function coordsToTileId(x, y, z) {
        // Colonist.io uses cube coordinates
        // Convert to our row-major tile ID system
        // This is an approximation - may need adjustment based on actual coordinate system
        
        // Row-major layout:
        // Row 0: 0-3 (4 tiles)
        // Row 1: 4-8 (5 tiles)
        // Row 2: 9-14 (6 tiles)
        // Row 3: 15-21 (7 tiles)
        // Row 4: 22-27 (6 tiles)
        // Row 5: 28-32 (5 tiles)
        // Row 6: 33-36 (4 tiles)
        
        const rowLengths = [4, 5, 6, 7, 6, 5, 4];
        const rowStarts = [0, 4, 9, 15, 22, 28, 33];
        
        // Simple mapping attempt - adjust based on actual colonist coords
        const row = y + 3; // Assuming y ranges from -3 to 3
        const col = x + Math.floor(rowLengths[row] / 2);
        
        if (row >= 0 && row < 7 && col >= 0 && col < rowLengths[row]) {
            return rowStarts[row] + col;
        }
        
        return -1;
    }
    
    function parsePortData(ports) {
        console.log("⚓ Parsing ports...", ports);
        
        ports.forEach(port => {
            // Port type mapping
            let portType = 5; // Default 3:1
            const pType = port.type ?? port.resource ?? port.portType;
            
            if (typeof pType === 'number') {
                portType = pType === 0 ? 5 : (pType - 1); // Adjust based on colonist format
            } else if (typeof pType === 'string') {
                if (pType.includes('3:1') || pType === 'any' || pType === 'generic') {
                    portType = 5;
                } else {
                    portType = RESOURCE_MAP[pType] ?? 5;
                }
            }
            
            // Get the nodes/edges this port applies to
            if (port.nodes) {
                port.nodes.forEach(node => {
                    const nodeKey = nodeToKey(node);
                    if (nodeKey) {
                        gameState.map.ports[nodeKey] = portType;
                    }
                });
            }
            
            if (port.edges) {
                port.edges.forEach(edge => {
                    // Each edge connects to 2 nodes
                    const nodeKeys = edgeToNodeKeys(edge);
                    nodeKeys.forEach(key => {
                        if (key) gameState.map.ports[key] = portType;
                    });
                });
            }
        });
        
        console.log("✅ Ports parsed:", Object.keys(gameState.map.ports).length);
    }
    
    function nodeToKey(node) {
        // Convert node coordinates to "T1_T2_T3" format
        if (Array.isArray(node)) {
            return node.sort((a, b) => a - b).join('_');
        }
        if (node.tiles) {
            return node.tiles.sort((a, b) => a - b).join('_');
        }
        return null;
    }
    
    function edgeToNodeKeys(edge) {
        // Convert edge to adjacent node keys
        if (Array.isArray(edge)) {
            return [edge.sort((a, b) => a - b).join('_')];
        }
        return [];
    }
    
    function parsePlayersFromWS(wsPlayers) {
        console.log("👥 Parsing players from WS...", wsPlayers);
        
        wsPlayers.forEach((p, idx) => {
            const name = p.username ?? p.name ?? p.displayName ?? `Player${idx}`;
            const color = p.color ?? p.playerColor ?? '#000';
            
            if (!players.includes(name)) {
                players.push(name);
                playerColors[name] = color;
                resources[name] = {
                    lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0
                };
            }
            
            // Update resources if provided
            if (p.resources) {
                resources[name] = {
                    lumber: p.resources.lumber ?? p.resources.wood ?? 0,
                    brick: p.resources.brick ?? 0,
                    wool: p.resources.wool ?? p.resources.sheep ?? 0,
                    grain: p.resources.grain ?? p.resources.wheat ?? 0,
                    ore: p.resources.ore ?? 0
                };
            }
        });
        
        updateGameStatePlayers();
    }
    
    function parseRoads(roads) {
        roads.forEach(road => {
            const player = road.player ?? road.playerId ?? 0;
            const key = edgeToKey(road);
            if (key) {
                gameState.map.edges[key] = player;
            }
        });
    }
    
    function parseSettlements(settlements) {
        settlements.forEach(s => {
            const player = s.player ?? s.playerId ?? 0;
            const key = nodeToKey(s);
            if (key) {
                gameState.map.nodes[key] = [player, 1]; // 1 = Settlement
            }
        });
    }
    
    function parseCities(cities) {
        cities.forEach(c => {
            const player = c.player ?? c.playerId ?? 0;
            const key = nodeToKey(c);
            if (key) {
                gameState.map.nodes[key] = [player, 2]; // 2 = City
            }
        });
    }
    
    function edgeToKey(edge) {
        if (edge.tiles && edge.tiles.length >= 2) {
            return edge.tiles.slice(0, 2).sort((a, b) => a - b).join('_');
        }
        return null;
    }
    
    function handleBuildMessage(data) {
        const player = data.player ?? data.playerId ?? 0;
        const building = data.building ?? data.type ?? '';
        
        if (building === 'road' || building === 'ROAD') {
            const key = edgeToKey(data);
            if (key) gameState.map.edges[key] = player;
        } else if (building === 'settlement' || building === 'SETTLEMENT') {
            const key = nodeToKey(data);
            if (key) gameState.map.nodes[key] = [player, 1];
        } else if (building === 'city' || building === 'CITY') {
            const key = nodeToKey(data);
            if (key) gameState.map.nodes[key] = [player, 2];
        }
    }
    
    // ==================== DOM UTILITIES ====================
    
    function toArray(collection) {
        return Array.prototype.slice.call(collection);
    }
    
    function getAllMessages() {
        if (!logElement) return [];
        return toArray(logElement.children);
    }
    
    // ==================== RESOURCE PARSING (DOM) ====================
    
    function parseResourceFromImg(img) {
        const src = img.src || '';
        if (src.includes('card_wool')) return 'wool';
        if (src.includes('card_lumber')) return 'lumber';
        if (src.includes('card_brick')) return 'brick';
        if (src.includes('card_ore')) return 'ore';
        if (src.includes('card_grain')) return 'grain';
        return null;
    }
    
    // ==================== PLAYER DETECTION (DOM) ====================
    
    function recognizeUsers() {
        const placementMessages = getAllMessages()
            .filter(msg => msg.textContent.includes(SNIPPETS.placeSettlement));
        
        for (const msg of placementMessages) {
            const msgText = msg.textContent;
            const username = msgText.replace(SNIPPETS.placeSettlement, "").split(" ")[0];
            
            if (!resources[username]) {
                players.push(username);
                playerColors[username] = msg.style.color || '#000';
                resources[username] = {
                    lumber: 0, brick: 0, wool: 0, grain: 0, ore: 0
                };
            }
        }
        
        console.log("👥 Players from DOM:", players);
        updateGameStatePlayers();
    }
    
    function updateGameStatePlayers() {
        gameState.players = players.map((name, idx) => ({
            id: idx,
            name: name,
            color: playerColors[name],
            public: [0, 0, 0, getTotalCards(name)],
            res_k: [
                resources[name]?.lumber ?? 0,
                resources[name]?.brick ?? 0,
                resources[name]?.wool ?? 0,
                resources[name]?.grain ?? 0,
                resources[name]?.ore ?? 0
            ],
            res_u: [],
            devs: []
        }));
    }
    
    function getTotalCards(player) {
        if (!resources[player]) return 0;
        return Object.values(resources[player]).reduce((a, b) => a + b, 0);
    }
    
    // ==================== DOM MESSAGE PARSERS ====================
    
    function parseGotMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.gotResources)) return;
        
        const player = text.split(SNIPPETS.gotResources)[0].trim().split(" ").pop();
        if (!resources[player]) return;
        
        const images = toArray(pElement.getElementsByTagName('img'));
        for (const img of images) {
            const res = parseResourceFromImg(img);
            if (res) resources[player][res]++;
        }
    }
    
    function parseBuiltMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.built)) return;
        
        const player = text.split(" ")[0];
        if (!resources[player]) return;
        
        const images = toArray(pElement.getElementsByTagName('img'));
        for (const img of images) {
            const src = img.src || '';
            if (src.includes("road")) {
                resources[player].lumber--;
                resources[player].brick--;
            } else if (src.includes("settlement")) {
                resources[player].lumber--;
                resources[player].brick--;
                resources[player].wool--;
                resources[player].grain--;
            } else if (src.includes("city")) {
                resources[player].ore -= 3;
                resources[player].grain -= 2;
            }
        }
    }
    
    function parseBoughtMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.bought)) return;
        
        const player = text.split(" ")[0];
        if (!resources[player]) return;
        
        const images = toArray(pElement.getElementsByTagName('img'));
        for (const img of images) {
            if ((img.src || '').includes("card_devcardback")) {
                resources[player].wool--;
                resources[player].grain--;
                resources[player].ore--;
            }
        }
    }
    
    function parseTradeBankMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.tradeBankGave)) return;
        
        const player = text.split(" ")[0];
        if (!resources[player]) return;
        
        const innerHTML = pElement.innerHTML;
        const gaveIdx = innerHTML.indexOf(SNIPPETS.tradeBankGave);
        const tookIdx = innerHTML.indexOf(SNIPPETS.tradeBankTook);
        
        if (gaveIdx === -1 || tookIdx === -1) return;
        
        const gaveSection = innerHTML.slice(gaveIdx, tookIdx).split("<img");
        const tookSection = innerHTML.slice(tookIdx).split("<img");
        
        for (const imgStr of gaveSection) {
            if (imgStr.includes("card_wool")) resources[player].wool--;
            else if (imgStr.includes("card_lumber")) resources[player].lumber--;
            else if (imgStr.includes("card_brick")) resources[player].brick--;
            else if (imgStr.includes("card_ore")) resources[player].ore--;
            else if (imgStr.includes("card_grain")) resources[player].grain--;
        }
        
        for (const imgStr of tookSection) {
            if (imgStr.includes("card_wool")) resources[player].wool++;
            else if (imgStr.includes("card_lumber")) resources[player].lumber++;
            else if (imgStr.includes("card_brick")) resources[player].brick++;
            else if (imgStr.includes("card_ore")) resources[player].ore++;
            else if (imgStr.includes("card_grain")) resources[player].grain++;
        }
    }
    
    function parseDiscardedMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.discarded)) return;
        
        const player = text.split(" ")[0];
        if (!resources[player]) return;
        
        const images = toArray(pElement.getElementsByTagName('img'));
        for (const img of images) {
            const res = parseResourceFromImg(img);
            if (res) resources[player][res]--;
        }
    }
    
    function parseStoleAllOfMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.stoleAllOf)) return;
        
        const player = text.split(" ")[0];
        if (!resources[player]) return;
        
        const images = toArray(pElement.getElementsByTagName('img'));
        for (const img of images) {
            const res = parseResourceFromImg(img);
            if (res) {
                for (const p of players) {
                    if (p !== player) {
                        resources[player][res] += resources[p][res];
                        resources[p][res] = 0;
                    }
                }
            }
        }
    }
    
    function parseRolledMessage(pElement) {
        const text = pElement.textContent;
        if (!text.includes(SNIPPETS.rolled)) return;
        
        const match = text.match(/rolled\s+(\d+)/);
        if (match) {
            const roll = parseInt(match[1]);
            gameState.meta.dice.unshift(roll);
            if (gameState.meta.dice.length > 8) {
                gameState.meta.dice.pop();
            }
            gameState.meta.t++;
        }
    }
    
    const ALL_PARSERS = [
        parseGotMessage,
        parseBuiltMessage,
        parseBoughtMessage,
        parseTradeBankMessage,
        parseDiscardedMessage,
        parseStoleAllOfMessage,
        parseRolledMessage
    ];
    
    // ==================== MAIN LOOP ====================
    
    function parseLatestMessages() {
        const allMessages = getAllMessages();
        const newOffset = allMessages.length;
        const newMessages = allMessages.slice(MSG_OFFSET);
        
        ALL_PARSERS.forEach(parser => {
            newMessages.forEach((msg) => {
                try {
                    parser(msg);
                } catch (e) {}
            });
        });
        
        MSG_OFFSET = newOffset;
        updateGameStatePlayers();
        
        if (newMessages.length > 0) {
            printState();
        }
    }
    
    function printState() {
        console.clear();
        console.log("═══════════════════════════════════════════════════════════");
        console.log("🎲 COLONIST.IO LIVE BOARD STATE v2.0");
        console.log("═══════════════════════════════════════════════════════════");
        console.log(`📍 Turn: ${gameState.meta.t} | Phase: ${gameState.meta.phase}`);
        console.log(`🎲 Last Dice: [${gameState.meta.dice.slice(0, 8).join(', ')}]`);
        console.log(`🏴‍☠️ Robber: Tile ${gameState.map.robber}`);
        console.log("───────────────────────────────────────────────────────────");
        
        // Board info
        const landTiles = gameState.map.tiles.filter(t => t[0] !== 6 && t[0] !== undefined);
        console.log(`🗺️ BOARD: ${landTiles.length} land tiles, ${Object.keys(gameState.map.ports).length} ports`);
        
        if (landTiles.length > 0) {
            const resNames = ['Wood', 'Brick', 'Wool', 'Grain', 'Ore', 'Desert', 'Ocean'];
            console.log("   Tiles:", gameState.map.tiles.map((t, i) => 
                t[0] !== 6 ? `${i}:${resNames[t[0]]}(${t[1]})` : null
            ).filter(Boolean).join(', '));
        }
        
        console.log(`🏘️ Settlements: ${Object.keys(gameState.map.nodes).length}`);
        console.log(`🛤️ Roads: ${Object.keys(gameState.map.edges).length}`);
        
        console.log("───────────────────────────────────────────────────────────");
        console.log("👥 PLAYER RESOURCES:");
        console.log("───────────────────────────────────────────────────────────");
        
        for (const player of players) {
            const r = resources[player] || {};
            const total = getTotalCards(player);
            console.log(
                `  %c${player}%c: 🪵${r.lumber||0} 🧱${r.brick||0} 🐑${r.wool||0} 🌾${r.grain||0} ite${r.ore||0} (Total: ${total})`,
                `color: ${playerColors[player]}; font-weight: bold`,
                'color: inherit'
            );
        }
        
        console.log("───────────────────────────────────────────────────────────");
        console.log("📦 RAW HDCS JSON (use colonistSniffer.getState())");
        console.log("═══════════════════════════════════════════════════════════");
    }
    
    // ==================== INITIALIZATION ====================
    
    function startWatching() {
        setInterval(parseLatestMessages, 500);
        console.log("👁️ Watching for game updates...");
    }
    
    function tallyInitialResources() {
        const allMessages = getAllMessages();
        MSG_OFFSET = allMessages.length;
        allMessages.forEach(parseGotMessage);
        startWatching();
    }
    
    function loadGame() {
        setTimeout(() => {
            recognizeUsers();
            tallyInitialResources();
            gameState.meta.phase = "main";
            printState();
            initialized = true;
        }, 500);
    }
    
    function waitForInitialPlacement() {
        let attempts = 0;
        const interval = setInterval(() => {
            attempts++;
            const messages = getAllMessages().map(p => p.textContent);
            
            if (messages.some(m => m.includes(SNIPPETS.initialPlacementDone))) {
                clearInterval(interval);
                console.log("✅ Initial placement complete, loading game...");
                loadGame();
            } else if (attempts > 120) {
                clearInterval(interval);
                console.log("⏰ Timeout waiting for placement, trying anyway...");
                loadGame();
            }
        }, 500);
    }
    
    function findLogElement() {
        const interval = setInterval(() => {
            logElement = document.getElementById("game-log-text");
            if (logElement) {
                console.log("📜 Game log found!");
                clearInterval(interval);
                waitForInitialPlacement();
            } else {
                const altLog = document.querySelector('[class*="game-log"]');
                if (altLog) {
                    logElement = altLog;
                    console.log("📜 Game log found (alt)!");
                    clearInterval(interval);
                    waitForInitialPlacement();
                }
            }
        }, 500);
    }
    
    // ==================== MANUAL COMMANDS ====================
    
    window.colonistSniffer = {
        getState: () => gameState,
        getPlayers: () => players,
        getResources: () => resources,
        getWSMessages: () => wsMessages,
        getColonistState: () => colonistGameState,
        printState: printState,
        forceRefresh: () => {
            MSG_OFFSET = 0;
            parseLatestMessages();
        },
        
        // Manual scan for game data
        scan: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🔍 SCANNING FOR GAME DATA...");
            console.log("═══════════════════════════════════════════════════════════");
            
            // 0. Find and hook existing WebSocket connections
            console.log("\n📡 STEP 1: Finding existing WebSocket connections...");
            const wsCount = findExistingWebSockets();
            
            // 1. Search global scope
            console.log("\n🌐 STEP 2: Searching global scope for game state...");
            const globalState = findColonistGameState();
            if (globalState) {
                console.log("✅ Found global game state!");
            }
            
            // 2. Try DOM extraction
            console.log("\n📄 STEP 3: Attempting DOM-based extraction...");
            const domSuccess = extractBoardFromDOM();
            if (domSuccess) {
                console.log("✅ Extracted board from DOM!");
            }
            
            // 3. Check for React fiber (colonist might use React)
            console.log("\n⚛️ STEP 4: Scanning React fiber...");
            scanReactFiber();
            
            // 4. Summary
            console.log("\n═══════════════════════════════════════════════════════════");
            console.log("📊 SCAN RESULTS:");
            console.log(`   WebSockets found & hooked: ${wsCount}`);
            console.log(`   WS Messages captured: ${wsMessages.length}`);
            console.log(`   Board initialized: ${boardInitialized}`);
            console.log(`   Tiles extracted: ${gameState.map.tiles.filter(t => t[0] !== 6).length}`);
            console.log("═══════════════════════════════════════════════════════════");
            
            if (wsCount > 0 && wsMessages.length === 0) {
                console.log("\n💡 TIP: WebSocket hooked! Play a turn (roll dice, build, etc.)");
                console.log("   Then run colonistSniffer.getWSMessages() to see captured data.");
            }
            
            printState();
            return gameState;
        },
        
        debug: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🔧 DEBUG INFO v3.0");
            console.log("═══════════════════════════════════════════════════════════");
            console.log("WS Messages captured:", wsMessages.length);
            console.log("Board initialized:", boardInitialized);
            console.log("Players:", players);
            console.log("Log element found:", !!logElement);
            console.log("Colonist state ref:", !!colonistGameState);
            console.log("───────────────────────────────────────────────────────────");
            console.log("Last 5 captured messages:", wsMessages.slice(-5));
            console.log("───────────────────────────────────────────────────────────");
            
            // List potential game-related window properties
            console.log("Window properties containing 'game':");
            Object.keys(window).filter(k => k.toLowerCase().includes('game')).forEach(k => {
                console.log(`  window.${k}:`, typeof window[k]);
            });
            
            console.log("═══════════════════════════════════════════════════════════");
        },
        
        // Dump all window properties for manual inspection
        dumpWindow: () => {
            const interesting = {};
            for (const key of Object.keys(window)) {
                try {
                    const val = window[key];
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        const keys = Object.keys(val).slice(0, 10);
                        if (keys.some(k => ['hex', 'tile', 'player', 'board', 'game', 'state', 'socket', 'ws', 'connect'].some(g => k.toLowerCase().includes(g)))) {
                            interesting[key] = keys;
                        }
                    }
                } catch (e) {}
            }
            console.log("Potentially interesting window properties:", interesting);
            return interesting;
        },
        
        // Check if any messages are being captured
        testCapture: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🧪 TESTING MESSAGE CAPTURE...");
            console.log("═══════════════════════════════════════════════════════════");
            console.log("Hooked sockets count:", hookedSockets.size);
            console.log("WS Messages so far:", wsMessages.length);
            
            // Check if prototype patches are working
            console.log("\nPrototype patch status:");
            console.log("  WebSocket.prototype.send patched:", OriginalWebSocket.prototype.send.toString().includes('hookedSockets'));
            
            // List all hooked sockets with their states
            console.log("\nHooked WebSocket instances:");
            let idx = 0;
            hookedSockets.forEach(ws => {
                const states = ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'];
                console.log(`  [${idx}] URL: ${ws.url}, State: ${states[ws.readyState]}`);
                idx++;
            });
            
            if (wsMessages.length > 0) {
                console.log("\nLast 3 messages:");
                wsMessages.slice(-3).forEach((msg, i) => {
                    console.log(`  [${i}]`, msg);
                });
            }
            
            console.log("\n💡 TIP: If no sockets found, the game might use a different");
            console.log("   communication method. Check Network tab for 'WS' connections.");
            console.log("═══════════════════════════════════════════════════════════");
        },
        
        // Manual WebSocket hook - user can pass a socket reference
        hookSocket: (ws) => {
            if (ws && ws.send && ws.readyState !== undefined) {
                hookLiveWebSocket(ws);
                console.log("✅ Manually hooked WebSocket:", ws.url);
                return true;
            }
            console.log("❌ Invalid WebSocket object");
            return false;
        },
        
        // Analyze captured messages
        analyzeMessages: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("📊 MESSAGE ANALYSIS");
            console.log("═══════════════════════════════════════════════════════════");
            console.log(`Total messages: ${wsMessages.length}`);
            
            // Count message types
            const typeCounts = {
                outgoing: 0,
                binary: 0,
                parsed: 0,
                json: 0,
                unknown: 0
            };
            
            const binaryMessages = [];
            const parsedMessages = [];
            
            wsMessages.forEach((msg, idx) => {
                if (msg.type === 'outgoing') {
                    typeCounts.outgoing++;
                } else if (msg.hex) {
                    typeCounts.binary++;
                    binaryMessages.push({idx, msg});
                    if (msg.parsed) {
                        typeCounts.parsed++;
                        parsedMessages.push({idx, data: msg.parsed});
                    }
                } else if (msg.raw) {
                    typeCounts.unknown++;
                } else {
                    typeCounts.json++;
                    parsedMessages.push({idx, data: msg});
                }
            });
            
            console.log("\nMessage type breakdown:");
            console.log(`  Outgoing: ${typeCounts.outgoing}`);
            console.log(`  Binary (incoming): ${typeCounts.binary}`);
            console.log(`  Successfully parsed: ${typeCounts.parsed}`);
            console.log(`  Unknown/raw: ${typeCounts.unknown}`);
            
            console.log("\n───────────────────────────────────────────────────────────");
            console.log("📦 SAMPLE BINARY MESSAGES (first 10):");
            console.log("───────────────────────────────────────────────────────────");
            
            binaryMessages.slice(0, 10).forEach(({idx, msg}) => {
                console.log(`\n[${idx}] Size: ${msg.size} bytes, Type guess: ${msg.possibleType || 'N/A'}`);
                console.log(`  Hex: ${msg.hex}...`);
                if (msg.text) console.log(`  Text preview: ${msg.text.slice(0, 80)}...`);
                if (msg.parsed) console.log(`  Parsed:`, msg.parsed);
            });
            
            if (parsedMessages.length > 0) {
                console.log("\n───────────────────────────────────────────────────────────");
                console.log("✅ SUCCESSFULLY PARSED MESSAGES:");
                console.log("───────────────────────────────────────────────────────────");
                parsedMessages.slice(0, 10).forEach(({idx, data}) => {
                    console.log(`[${idx}]`, data);
                });
            }
            
            // Look for game-related data in parsed messages
            console.log("\n───────────────────────────────────────────────────────────");
            console.log("🎮 SEARCHING FOR GAME DATA...");
            console.log("───────────────────────────────────────────────────────────");
            
            parsedMessages.forEach(({idx, data}) => {
                if (data && typeof data === 'object') {
                    const json = JSON.stringify(data).toLowerCase();
                    if (json.includes('hex') || json.includes('tile') || 
                        json.includes('player') || json.includes('dice') ||
                        json.includes('robber') || json.includes('resource')) {
                        console.log(`🎯 [${idx}] Possible game data:`, data);
                    }
                }
            });
            
            console.log("═══════════════════════════════════════════════════════════");
            return {typeCounts, binaryMessages, parsedMessages};
        },
        
        // Dump raw bytes of a specific message
        dumpMessage: (idx) => {
            const msg = wsMessages[idx];
            if (!msg) {
                console.log("❌ Message not found at index", idx);
                return null;
            }
            console.log(`Message [${idx}]:`, msg);
            return msg;
        },
        
        // Clear messages
        clearMessages: () => {
            const count = wsMessages.length;
            wsMessages.length = 0;
            console.log(`Cleared ${count} messages`);
        },
        
        // Deep search for game state objects
        findGameState: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🎮 DEEP SEARCH FOR GAME STATE...");
            console.log("═══════════════════════════════════════════════════════════");
            
            // 1. Check for exposed MessagePack decoder
            console.log("\n📦 Step 1: Looking for MessagePack decoder...");
            const decoder = findMessagePackDecoder();
            if (decoder) {
                console.log("✅ Found decoder! Can decode binary messages.");
            }
            
            // 2. Deep search $nuxt for game state
            console.log("\n🌐 Step 2: Searching $nuxt for game state...");
            if (window.$nuxt) {
                const gameData = searchNuxtForGameState();
                if (gameData) {
                    console.log("✅ Found game state in $nuxt!");
                    return gameData;
                }
            }
            
            // 3. Search for Pixi.js app (colonist uses PixiJS for rendering)
            console.log("\n🎨 Step 3: Searching for Pixi.js game objects...");
            const pixiData = searchPixiForGameState();
            if (pixiData) {
                console.log("✅ Found game data via Pixi.js!");
                return pixiData;
            }
            
            // 4. Search all window properties for game-like objects
            console.log("\n🔎 Step 4: Brute-force search window...");
            const windowData = bruteForceSearchWindow();
            if (windowData) {
                console.log("✅ Found game data in window!");
                return windowData;
            }
            
            console.log("\n❌ No game state found via direct search.");
            console.log("💡 The game state may be deeply encapsulated.");
            console.log("═══════════════════════════════════════════════════════════");
            return null;
        },
        
        // Try to decode a message using found decoder
        decode: (msg) => {
            if (!msgpackDecoder) {
                console.log("❌ No decoder found. Run findGameState() first.");
                return null;
            }
            try {
                const data = msg.raw || msg;
                const decoded = msgpackDecoder.decode ? 
                    msgpackDecoder.decode(new Uint8Array(data)) :
                    msgpackDecoder.unpack(new Uint8Array(data));
                console.log("✅ Decoded:", decoded);
                return decoded;
            } catch (e) {
                console.log("❌ Decode error:", e.message);
                return null;
            }
        },
        
        // Get decoder reference
        getDecoder: () => msgpackDecoder,
        
        // List all Vue components and their data
        listComponents: () => {
            if (!window.$nuxt) {
                console.log("❌ $nuxt not found");
                return [];
            }
            
            console.log("═══════════════════════════════════════════════════════════");
            console.log("📦 ALL VUE COMPONENTS");
            console.log("═══════════════════════════════════════════════════════════");
            
            const components = [];
            const searched = new WeakSet();
            
            function collect(comp, path, depth) {
                if (depth > 25 || !comp) return;
                try {
                    if (searched.has(comp)) return;
                    searched.add(comp);
                } catch (e) { return; }
                
                const name = comp.$options?.name || comp.constructor?.name || 'Anonymous';
                const data = comp._data || comp.$data || {};
                const dataKeys = Object.keys(data);
                const computedKeys = comp._computedWatchers ? Object.keys(comp._computedWatchers) : [];
                
                components.push({
                    name,
                    path,
                    depth,
                    dataKeys,
                    computedKeys,
                    comp
                });
                
                if (comp.$children) {
                    comp.$children.forEach((child, i) => {
                        collect(child, `${path}[${i}]`, depth + 1);
                    });
                }
            }
            
            collect(window.$nuxt, '$nuxt', 0);
            
            // Print components with data
            const withData = components.filter(c => c.dataKeys.length > 0 || c.computedKeys.length > 0);
            console.log(`Found ${components.length} total components, ${withData.length} with data\n`);
            
            withData.forEach(({name, path, dataKeys, computedKeys}) => {
                console.log(`📦 ${name}`);
                if (dataKeys.length > 0) {
                    console.log(`   Data: ${dataKeys.join(', ')}`);
                }
                if (computedKeys.length > 0) {
                    console.log(`   Computed: ${computedKeys.slice(0, 10).join(', ')}${computedKeys.length > 10 ? '...' : ''}`);
                }
            });
            
            console.log("═══════════════════════════════════════════════════════════");
            return components;
        },
        
        // Inspect a specific component by name
        inspectComponent: (searchName) => {
            if (!window.$nuxt) {
                console.log("❌ $nuxt not found");
                return null;
            }
            
            const searched = new WeakSet();
            
            function find(comp, path, depth) {
                if (depth > 25 || !comp) return null;
                try {
                    if (searched.has(comp)) return null;
                    searched.add(comp);
                } catch (e) { return null; }
                
                const name = comp.$options?.name || comp.constructor?.name || '';
                if (name.toLowerCase().includes(searchName.toLowerCase())) {
                    return {comp, name, path};
                }
                
                if (comp.$children) {
                    for (let i = 0; i < comp.$children.length; i++) {
                        const result = find(comp.$children[i], `${path}[${i}]`, depth + 1);
                        if (result) return result;
                    }
                }
                return null;
            }
            
            const result = find(window.$nuxt, '$nuxt', 0);
            if (result) {
                console.log(`Found component: ${result.name} at ${result.path}`);
                console.log("Data:", result.comp._data || result.comp.$data);
                console.log("Full component:", result.comp);
                return result.comp;
            } else {
                console.log(`❌ Component "${searchName}" not found`);
                return null;
            }
        },
        
        // Deep analyze binary messages to find patterns
        analyzeBinary: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🔬 DEEP BINARY MESSAGE ANALYSIS");
            console.log("═══════════════════════════════════════════════════════════");
            
            const binaryMsgs = wsMessages.filter(m => m.hex || m.raw instanceof ArrayBuffer);
            console.log(`Analyzing ${binaryMsgs.length} binary messages...\n`);
            
            // Group by first byte (likely message type)
            const byFirstByte = {};
            const bySize = {};
            
            binaryMsgs.forEach((msg, idx) => {
                let bytes;
                if (msg.hex) {
                    bytes = msg.hex.split(' ').map(h => parseInt(h, 16));
                } else if (msg.raw instanceof ArrayBuffer) {
                    bytes = Array.from(new Uint8Array(msg.raw));
                } else {
                    return;
                }
                
                const firstByte = bytes[0];
                const size = bytes.length;
                
                if (!byFirstByte[firstByte]) byFirstByte[firstByte] = [];
                byFirstByte[firstByte].push({idx, size, bytes: bytes.slice(0, 30)});
                
                const sizeGroup = size < 50 ? 'small' : size < 200 ? 'medium' : 'large';
                if (!bySize[sizeGroup]) bySize[sizeGroup] = [];
                bySize[sizeGroup].push({idx, size, firstByte});
            });
            
            console.log("📊 Messages by first byte (possible type ID):");
            Object.keys(byFirstByte).sort((a,b) => a-b).forEach(byte => {
                const msgs = byFirstByte[byte];
                console.log(`  0x${parseInt(byte).toString(16).padStart(2,'0')}: ${msgs.length} messages`);
                // Show first message of each type
                const first = msgs[0];
                console.log(`    Example [${first.idx}]: ${first.bytes.map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
            });
            
            console.log("\n📦 Messages by size:");
            Object.keys(bySize).forEach(size => {
                const msgs = bySize[size];
                console.log(`  ${size}: ${msgs.length} messages`);
            });
            
            // Look for large messages (likely game state)
            console.log("\n🔍 Large messages (likely game state):");
            const largeMsgs = binaryMsgs.filter(m => (m.size || 0) > 200);
            largeMsgs.slice(0, 5).forEach((msg, i) => {
                console.log(`  [${i}] Size: ${msg.size}, First bytes: ${msg.hex?.slice(0, 60)}...`);
            });
            
            // Try to find game-related patterns
            console.log("\n🎮 Searching for game patterns in binary...");
            binaryMsgs.forEach((msg, idx) => {
                if (msg.text) {
                    // Check text content for game keywords
                    const text = msg.text.toLowerCase();
                    if (text.includes('hex') || text.includes('tile') || 
                        text.includes('player') || text.includes('dice') ||
                        text.includes('lumber') || text.includes('brick')) {
                        console.log(`  [${idx}] Contains game text: ${msg.text.slice(0, 100)}`);
                    }
                }
            });
            
            console.log("═══════════════════════════════════════════════════════════");
            return {byFirstByte, bySize};
        },
        
        // Try different decoders on a message
        tryDecode: (msgIdx) => {
            const msg = wsMessages[msgIdx];
            if (!msg) {
                console.log("❌ Message not found");
                return null;
            }
            
            console.log(`Trying to decode message [${msgIdx}]...`);
            
            let bytes;
            if (msg.raw instanceof ArrayBuffer) {
                bytes = new Uint8Array(msg.raw);
            } else if (msg.hex) {
                bytes = new Uint8Array(msg.hex.split(' ').map(h => parseInt(h, 16)));
            } else {
                console.log("Not a binary message");
                return msg;
            }
            
            console.log(`Size: ${bytes.length} bytes`);
            console.log(`Hex: ${Array.from(bytes.slice(0, 50)).map(b => b.toString(16).padStart(2,'0')).join(' ')}`);
            
            // Try as UTF-8
            try {
                const text = new TextDecoder().decode(bytes);
                if (text.match(/^[\x20-\x7E\s]+$/)) {
                    console.log("As UTF-8:", text.slice(0, 200));
                }
            } catch (e) {}
            
            // Try our MessagePack decoder
            try {
                const decoded = decodeMessagePack(bytes);
                if (decoded && typeof decoded === 'object') {
                    console.log("MessagePack decoded:", decoded);
                    return decoded;
                }
            } catch (e) {}
            
            // Try skipping first byte (might be type prefix)
            try {
                const decoded = decodeMessagePack(bytes.slice(1));
                if (decoded && typeof decoded === 'object') {
                    console.log("MessagePack (skip 1 byte):", decoded);
                    return decoded;
                }
            } catch (e) {}
            
            // Try skipping first 2 bytes
            try {
                const decoded = decodeMessagePack(bytes.slice(2));
                if (decoded && typeof decoded === 'object') {
                    console.log("MessagePack (skip 2 bytes):", decoded);
                    return decoded;
                }
            } catch (e) {}
            
            console.log("Could not decode message");
            return null;
        },
        
        // Request game state resync by sending a request through the WebSocket
        requestResync: () => {
            console.log("🔄 Attempting to request game state resync...");
            
            // Find the active WebSocket
            let ws = null;
            hookedSockets.forEach(s => {
                if (s.readyState === 1) ws = s;
            });
            
            if (!ws) {
                console.log("❌ No open WebSocket found");
                return false;
            }
            
            console.log("Found open WebSocket:", ws.url);
            
            // Clear old messages to see fresh response
            console.log("Clearing old messages...");
            wsMessages.length = 0;
            
            // Try sending common resync request formats
            const resyncRequests = [
                {id: "getState", data: {}},
                {id: "sync", data: {}},
                {id: "resync", data: {}},
                {type: "getGameState"},
                {action: "getState"}
            ];
            
            // Encode as MessagePack and send
            console.log("Sending resync requests...");
            
            // We'll encode using our simple encoder
            function encodeMsgPack(obj) {
                // Simple MessagePack encoder for small objects
                const str = JSON.stringify(obj);
                // For now, just log - we'd need a proper encoder
                return null;
            }
            
            console.log("⚠️ Cannot send without proper MessagePack encoder");
            console.log("💡 Try triggering a game action (roll dice, click something)");
            console.log("   to generate new messages, then check with getWSMessages()");
            
            return true;
        },
        
        // Decode ALL captured messages
        decodeAll: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("📦 DECODING ALL MESSAGES");
            console.log("═══════════════════════════════════════════════════════════");
            
            const decoded = [];
            
            wsMessages.forEach((msg, idx) => {
                let bytes;
                if (msg.raw instanceof ArrayBuffer) {
                    bytes = new Uint8Array(msg.raw);
                } else if (msg.hex) {
                    bytes = new Uint8Array(msg.hex.split(' ').map(h => parseInt(h, 16)));
                } else if (msg.type === 'outgoing') {
                    return; // Skip outgoing
                } else {
                    decoded.push({idx, data: msg});
                    return;
                }
                
                try {
                    const data = decodeMessagePack(bytes);
                    if (data) {
                        decoded.push({idx, data});
                        
                        // Check for game-related data
                        const json = JSON.stringify(data).toLowerCase();
                        if (json.includes('hex') || json.includes('tile') || 
                            json.includes('player') || json.includes('build') ||
                            json.includes('road') || json.includes('settlement')) {
                            console.log(`🎮 [${idx}] Game data:`, data);
                        }
                    }
                } catch (e) {}
            });
            
            console.log(`\nDecoded ${decoded.length} / ${wsMessages.length} messages`);
            
            // Group by message ID
            const byId = {};
            decoded.forEach(({idx, data}) => {
                if (data && data.id) {
                    if (!byId[data.id]) byId[data.id] = [];
                    byId[data.id].push({idx, data});
                }
            });
            
            console.log("\nMessage IDs found:", Object.keys(byId).join(', '));
            
            // Show unique message types
            console.log("\nSample of each message type:");
            Object.keys(byId).slice(0, 10).forEach(id => {
                const first = byId[id][0];
                console.log(`  ${id} (${byId[id].length}x):`, first.data);
            });
            
            console.log("═══════════════════════════════════════════════════════════");
            return decoded;
        },
        
        // Analyze game protocol - decode all type 130 messages
        analyzeGameProtocol: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🎮 GAME PROTOCOL ANALYSIS");
            console.log("═══════════════════════════════════════════════════════════");
            
            // Decode all messages
            const decoded = [];
            wsMessages.forEach((msg, idx) => {
                let bytes;
                if (msg.raw instanceof ArrayBuffer) {
                    bytes = new Uint8Array(msg.raw);
                } else if (msg.hex) {
                    bytes = new Uint8Array(msg.hex.split(' ').map(h => parseInt(h, 16)));
                } else if (msg.type === 'outgoing') {
                    return;
                } else {
                    decoded.push({idx, data: msg, size: 0});
                    return;
                }
                
                try {
                    const data = decodeMessagePack(bytes);
                    if (data) {
                        decoded.push({idx, data, size: bytes.length});
                    }
                } catch (e) {}
            });
            
            // Find game messages (id = "130")
            const gameMessages = decoded.filter(m => m.data && m.data.id === "130");
            console.log(`\nFound ${gameMessages.length} game messages (id=130)`);
            
            // Group by message type
            const byType = {};
            gameMessages.forEach(({idx, data, size}) => {
                const type = data.data?.type;
                if (type !== undefined) {
                    if (!byType[type]) byType[type] = [];
                    byType[type].push({idx, payload: data.data?.payload, sequence: data.data?.sequence, size});
                }
            });
            
            // Known message types based on analysis
            const typeNames = {
                1: 'GAME_SETTINGS',
                4: 'PLAYER_COLOR',
                6: 'UNKNOWN_BOOL',
                28: 'ROBBER_OR_DISTRIBUTION',
                30: 'AVAILABLE_VERTICES',
                31: 'AVAILABLE_EDGES',
                32: 'UNKNOWN_ARRAY',
                33: 'UNKNOWN_ARRAY_2',
                43: 'TRADE_GIVE',
                59: 'UNKNOWN_ARRAY_3',
                62: 'UNKNOWN_OBJECT',
                78: 'UNKNOWN_BOOL_2',
                80: 'TURN_END',
                91: 'STATE_DIFF'
            };
            
            console.log("\n📊 Message types found:");
            Object.keys(byType).sort((a,b) => parseInt(a) - parseInt(b)).forEach(type => {
                const msgs = byType[type];
                const name = typeNames[type] || 'UNKNOWN';
                console.log(`\n  Type ${type} (${name}): ${msgs.length} messages`);
                
                // Show examples
                msgs.slice(0, 3).forEach((m, i) => {
                    console.log(`    [${m.idx}] payload:`, m.payload);
                });
            });
            
            // Analyze type 91 (STATE_DIFF) messages
            console.log("\n───────────────────────────────────────────────────────────");
            console.log("🔍 STATE_DIFF Analysis (type 91):");
            console.log("───────────────────────────────────────────────────────────");
            
            const diffs = byType[91] || [];
            const diffTypes = {};
            diffs.forEach(({payload}) => {
                if (payload && payload.diff) {
                    Object.keys(payload.diff).forEach(key => {
                        if (!diffTypes[key]) diffTypes[key] = 0;
                        diffTypes[key]++;
                    });
                }
            });
            
            console.log("Diff categories found:");
            Object.keys(diffTypes).forEach(key => {
                console.log(`  ${key}: ${diffTypes[key]} occurrences`);
            });
            
            // Analyze type 28 (potential game actions) more deeply
            console.log("\n───────────────────────────────────────────────────────────");
            console.log("🎯 ROBBER/DISTRIBUTION Analysis (type 28):");
            console.log("───────────────────────────────────────────────────────────");
            
            const type28 = byType[28] || [];
            type28.forEach(({idx, payload}) => {
                if (Array.isArray(payload)) {
                    payload.forEach((item, i) => {
                        if (item && item.owner !== undefined) {
                            console.log(`  [${idx}] Player ${item.owner} -> tile ${item.tileIndex}`);
                        }
                    });
                }
            });
            
            // Find largest messages (likely contain initial state)
            console.log("\n───────────────────────────────────────────────────────────");
            console.log("📦 LARGEST MESSAGES (potential initial state):");
            console.log("───────────────────────────────────────────────────────────");
            
            const sorted = [...decoded].sort((a, b) => b.size - a.size);
            sorted.slice(0, 10).forEach(({idx, data, size}) => {
                console.log(`\n[${idx}] Size: ${size} bytes`);
                console.log("  Data:", data);
            });
            
            console.log("═══════════════════════════════════════════════════════════");
            return {byType, diffTypes, decoded};
        },
        
        // Get raw bytes for inspection
        getRawBytes: (msgIdx) => {
            const msg = wsMessages[msgIdx];
            if (!msg) {
                console.log("❌ Message not found");
                return null;
            }
            
            let bytes;
            if (msg.raw instanceof ArrayBuffer) {
                bytes = new Uint8Array(msg.raw);
            } else if (msg.hex) {
                bytes = new Uint8Array(msg.hex.split(' ').map(h => parseInt(h, 16)));
            } else {
                console.log("Not a binary message");
                return null;
            }
            
            console.log(`Message ${msgIdx}: ${bytes.length} bytes`);
            console.log("Hex:", Array.from(bytes).map(b => b.toString(16).padStart(2,'0')).join(' '));
            console.log("Decoded:", decodeMessagePack(bytes));
            return bytes;
        },
        
        // Look specifically for the initial game state message
        findInitialState: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🔎 SEARCHING FOR INITIAL GAME STATE");
            console.log("═══════════════════════════════════════════════════════════");
            
            // Look for messages with hexes, tiles, players arrays
            const keywords = ['hexes', 'tiles', 'players', 'board', 'resources', 'lumber', 'brick', 'wool', 'grain', 'ore'];
            
            wsMessages.forEach((msg, idx) => {
                let bytes;
                if (msg.raw instanceof ArrayBuffer) {
                    bytes = new Uint8Array(msg.raw);
                } else if (msg.hex) {
                    bytes = new Uint8Array(msg.hex.split(' ').map(h => parseInt(h, 16)));
                } else {
                    return;
                }
                
                // Check text content of bytes
                const text = String.fromCharCode(...bytes);
                const textLower = text.toLowerCase();
                
                const found = keywords.filter(kw => textLower.includes(kw));
                if (found.length > 0) {
                    console.log(`\n🎯 [${idx}] Contains keywords: ${found.join(', ')}`);
                    console.log(`   Size: ${bytes.length} bytes`);
                    console.log(`   Text preview: ${text.slice(0, 200)}`);
                    
                    try {
                        const decoded = decodeMessagePack(bytes);
                        console.log("   Decoded:", decoded);
                    } catch (e) {
                        console.log("   (Failed to decode)");
                    }
                }
            });
            
            // Also check for large messages
            console.log("\n───────────────────────────────────────────────────────────");
            console.log("Large messages (>500 bytes) that might be initial state:");
            
            wsMessages.forEach((msg, idx) => {
                const size = msg.size || (msg.raw && msg.raw.byteLength) || 0;
                if (size > 500) {
                    console.log(`  [${idx}] ${size} bytes`);
                }
            });
            
            console.log("═══════════════════════════════════════════════════════════");
        },
        
        // Extract game state from Pixi.js display objects
        extractFromPixi: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🎨 EXTRACTING GAME STATE FROM PIXI.JS");
            console.log("═══════════════════════════════════════════════════════════");
            
            // Find the game canvas
            const gameCanvas = document.getElementById('game-canvas') || 
                              document.querySelector('canvas[width][height]');
            
            if (!gameCanvas) {
                console.log("❌ No game canvas found");
                return null;
            }
            
            console.log(`Found canvas: ${gameCanvas.width}x${gameCanvas.height}`);
            
            // Search for Pixi app in various locations
            let pixiApp = null;
            
            // Search window for PIXI app
            for (const key of Object.keys(window)) {
                try {
                    const val = window[key];
                    if (val && val.stage && val.renderer) {
                        console.log(`  Found Pixi app at window.${key}`);
                        pixiApp = val;
                        break;
                    }
                } catch (e) {}
            }
            
            // Search for renderer on canvas
            const canvasKeys = Object.keys(gameCanvas).filter(k => !k.startsWith('on'));
            console.log("  Canvas custom properties:", canvasKeys.slice(0, 20));
            
            // Try to find the game state object by searching all global objects
            console.log("\n  Searching for game state objects...");
            const gameStateObjects = [];
            const searched = new WeakSet();
            
            function searchForHexes(obj, path, depth) {
                if (depth > 8 || !obj || typeof obj !== 'object') return;
                try {
                    if (searched.has(obj)) return;
                    searched.add(obj);
                } catch (e) { return; }
                
                // Check if this object has hex/tile data
                if (Array.isArray(obj)) {
                    // Check if it's an array of hex-like objects
                    if (obj.length >= 19 && obj.length <= 37) {
                        const first = obj[0];
                        if (first && typeof first === 'object') {
                            const keys = Object.keys(first);
                            if (keys.some(k => ['type', 'resource', 'number', 'dice', 'terrain'].includes(k.toLowerCase()))) {
                                console.log(`  🎯 Found potential tiles array at ${path} (${obj.length} items)`);
                                console.log(`     First item keys: ${keys.join(', ')}`);
                                gameStateObjects.push({path, data: obj, type: 'tiles'});
                            }
                        }
                    }
                    return; // Don't recurse into arrays
                }
                
                // Check for game state properties
                const keys = Object.keys(obj);
                if (keys.includes('hexes') || keys.includes('tiles') || keys.includes('board')) {
                    console.log(`  🎯 Found game state at ${path}`);
                    console.log(`     Keys: ${keys.slice(0, 15).join(', ')}`);
                    gameStateObjects.push({path, data: obj, type: 'gameState'});
                }
                
                if (keys.includes('mapState') || keys.includes('gameState') || keys.includes('currentState')) {
                    console.log(`  🎯 Found state container at ${path}`);
                    gameStateObjects.push({path, data: obj, type: 'stateContainer'});
                }
                
                // Recurse into likely objects
                for (const key of keys.slice(0, 30)) {
                    if (['parent', 'children', '_parent', 'prototype', '__proto__'].includes(key)) continue;
                    try {
                        const val = obj[key];
                        if (val && typeof val === 'object' && !Array.isArray(val)) {
                            searchForHexes(val, `${path}.${key}`, depth + 1);
                        }
                    } catch (e) {}
                }
            }
            
            // Search $nuxt store
            if (window.$nuxt && window.$nuxt.$store) {
                console.log("  Searching Vuex store...");
                searchForHexes(window.$nuxt.$store.state, '$nuxt.$store.state', 0);
            }
            
            // Search common game object locations
            const commonPaths = ['game', 'gameState', 'state', 'store', 'app', 'colonist', 'catan'];
            for (const path of commonPaths) {
                if (window[path]) {
                    searchForHexes(window[path], `window.${path}`, 0);
                }
            }
            
            // Search all window properties
            console.log("\n  Deep searching window...");
            for (const key of Object.keys(window).slice(0, 100)) {
                if (['location', 'document', 'navigator', 'performance'].includes(key)) continue;
                try {
                    const val = window[key];
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        searchForHexes(val, `window.${key}`, 0);
                    }
                } catch (e) {}
            }
            
            console.log(`\n  Found ${gameStateObjects.length} potential game state objects`);
            
            if (gameStateObjects.length > 0) {
                console.log("\n───────────────────────────────────────────────────────────");
                console.log("FOUND GAME STATE OBJECTS:");
                gameStateObjects.forEach(({path, data, type}) => {
                    console.log(`\n  [${type}] ${path}:`);
                    console.log("    ", data);
                });
            }
            
            console.log("═══════════════════════════════════════════════════════════");
            return gameStateObjects;
        },
        
        // Run the script BEFORE joining - instructions
        howToCapture: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("📋 HOW TO CAPTURE INITIAL GAME STATE");
            console.log("═══════════════════════════════════════════════════════════");
            console.log("");
            console.log("The initial game state (tiles, numbers, ports) is sent when");
            console.log("you first join a game. To capture it:");
            console.log("");
            console.log("1. Open colonist.io");
            console.log("2. BEFORE clicking 'Play' or joining any game:");
            console.log("   - Open DevTools Console (F12)");
            console.log("   - Paste this entire sniffer script");
            console.log("   - Press Enter to run it");
            console.log("3. Now join or create a game");
            console.log("4. Wait for the game to load");
            console.log("5. Run: colonistSniffer.analyzeGameProtocol()");
            console.log("");
            console.log("The initial state will be in a large message (1000+ bytes)");
            console.log("with type that contains hexes, tiles, players, etc.");
            console.log("═══════════════════════════════════════════════════════════");
        },
        
        // Deep Vue component search
        deepVueSearch: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🔍 DEEP VUE COMPONENT SEARCH");
            console.log("═══════════════════════════════════════════════════════════");
            
            if (!window.$nuxt) {
                console.log("❌ $nuxt not found");
                return null;
            }
            
            const results = [];
            const searched = new WeakSet();
            
            // Keywords that indicate game state
            const gameKeywords = ['hex', 'tile', 'resource', 'lumber', 'brick', 'wool', 'grain', 'ore', 
                                 'desert', 'robber', 'dice', 'number', 'board', 'map', 'player',
                                 'settlement', 'city', 'road', 'port', 'harbor'];
            
            function searchVueComponent(comp, path, depth) {
                if (depth > 15 || !comp) return;
                
                try {
                    if (searched.has(comp)) return;
                    searched.add(comp);
                } catch (e) { return; }
                
                const name = comp.$options?.name || comp.constructor?.name || 'Unknown';
                
                // Check component data
                const data = comp._data || comp.$data;
                if (data) {
                    const dataStr = JSON.stringify(data).toLowerCase();
                    const foundKeywords = gameKeywords.filter(kw => dataStr.includes(kw));
                    if (foundKeywords.length >= 2) {
                        console.log(`\n🎯 ${name} at ${path}`);
                        console.log(`   Keywords: ${foundKeywords.join(', ')}`);
                        console.log(`   Data keys: ${Object.keys(data).join(', ')}`);
                        results.push({name, path, data, keywords: foundKeywords});
                    }
                }
                
                // Check ALL component properties
                for (const key of Object.keys(comp)) {
                    if (key.startsWith('$') || key.startsWith('_')) continue;
                    try {
                        const val = comp[key];
                        if (val && typeof val === 'object') {
                            const valStr = JSON.stringify(val).toLowerCase();
                            const foundKw = gameKeywords.filter(kw => valStr.includes(kw));
                            if (foundKw.length >= 3) {
                                console.log(`\n🎯 ${name}.${key} at ${path}`);
                                console.log(`   Keywords: ${foundKw.join(', ')}`);
                                results.push({name, path: `${path}.${key}`, data: val, keywords: foundKw});
                            }
                        }
                    } catch (e) {}
                }
                
                // Recurse into children
                if (comp.$children) {
                    comp.$children.forEach((child, i) => {
                        searchVueComponent(child, `${path}[${i}]`, depth + 1);
                    });
                }
            }
            
            searchVueComponent(window.$nuxt, '$nuxt', 0);
            
            console.log(`\n═══════════════════════════════════════════════════════════`);
            console.log(`Found ${results.length} components with game data`);
            console.log("═══════════════════════════════════════════════════════════");
            
            return results;
        },
        
        // Search ALL object properties at any depth
        nuclearSearch: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("☢️ NUCLEAR SEARCH - Searching EVERYTHING");
            console.log("═══════════════════════════════════════════════════════════");
            
            const results = [];
            const searched = new WeakSet();
            let searchCount = 0;
            const MAX_SEARCH = 50000;
            
            function search(obj, path, depth) {
                if (searchCount++ > MAX_SEARCH) return;
                if (depth > 12 || !obj || typeof obj !== 'object') return;
                
                try {
                    if (searched.has(obj)) return;
                    searched.add(obj);
                } catch (e) { return; }
                
                // Check if this looks like tiles array
                if (Array.isArray(obj) && obj.length >= 19 && obj.length <= 37) {
                    const sample = obj.filter(x => x && typeof x === 'object');
                    if (sample.length > 10) {
                        const keys = Object.keys(sample[0] || {});
                        // Check for tile-like properties
                        if (keys.length >= 2 && keys.length <= 10) {
                            console.log(`\n🎯 Potential tiles at ${path}`);
                            console.log(`   Length: ${obj.length}, First item keys: ${keys.join(', ')}`);
                            console.log(`   Sample:`, sample[0]);
                            results.push({path, type: 'tiles', data: obj});
                        }
                    }
                }
                
                // Check for game state object
                if (!Array.isArray(obj)) {
                    const keys = Object.keys(obj);
                    if (keys.includes('hexes') || keys.includes('tiles')) {
                        console.log(`\n🎯 Found hexes/tiles at ${path}`);
                        console.log(`   Keys: ${keys.join(', ')}`);
                        results.push({path, type: 'gameState', data: obj});
                    }
                    if (keys.includes('mapState') && typeof obj.mapState === 'object') {
                        console.log(`\n🎯 Found mapState at ${path}`);
                        results.push({path, type: 'mapState', data: obj.mapState});
                    }
                }
                
                // Recurse
                const keys = Object.keys(obj).slice(0, 50);
                for (const key of keys) {
                    if (['parent', 'children', '_parent', '__proto__', 'prototype', 
                         'ownerDocument', 'defaultView', 'parentNode', 'childNodes'].includes(key)) continue;
                    try {
                        const val = obj[key];
                        if (val && typeof val === 'object') {
                            search(val, `${path}.${key}`, depth + 1);
                        }
                    } catch (e) {}
                }
            }
            
            // Search everywhere
            console.log("Searching $nuxt...");
            if (window.$nuxt) search(window.$nuxt, '$nuxt', 0);
            
            console.log("Searching window properties...");
            for (const key of Object.keys(window)) {
                if (['document', 'location', 'navigator', 'frames', 'self', 'top', 'parent'].includes(key)) continue;
                try {
                    const val = window[key];
                    if (val && typeof val === 'object') {
                        search(val, `window.${key}`, 0);
                    }
                } catch (e) {}
            }
            
            console.log(`\nSearched ${searchCount} objects`);
            console.log(`Found ${results.length} potential game state locations`);
            console.log("═══════════════════════════════════════════════════════════");
            
            return results;
        },
        
        // Inspect Vuex store deeply
        inspectStore: () => {
            console.log("═══════════════════════════════════════════════════════════");
            console.log("🏪 VUEX STORE INSPECTION");
            console.log("═══════════════════════════════════════════════════════════");
            
            if (!window.$nuxt || !window.$nuxt.$store) {
                console.log("❌ Vuex store not found");
                return null;
            }
            
            const store = window.$nuxt.$store;
            const state = store.state;
            
            console.log("Store modules:", Object.keys(state));
            
            // Print each module
            for (const modName of Object.keys(state)) {
                const mod = state[modName];
                if (mod && typeof mod === 'object') {
                    const keys = Object.keys(mod);
                    console.log(`\n📦 ${modName}:`);
                    console.log(`   Keys: ${keys.slice(0, 20).join(', ')}${keys.length > 20 ? '...' : ''}`);
                    
                    // Check for game-related data
                    const modStr = JSON.stringify(mod).toLowerCase();
                    if (modStr.includes('hex') || modStr.includes('tile') || modStr.includes('board')) {
                        console.log(`   🎯 Contains game keywords!`);
                        console.log(`   Full data:`, mod);
                    }
                }
            }
            
            console.log("═══════════════════════════════════════════════════════════");
            return state;
        }
    };
    
    // ==================== DEEP STATE SEARCH FUNCTIONS ====================
    
    function searchNuxtForGameState() {
        if (!window.$nuxt) return null;
        
        console.log("  Searching Vue component tree...");
        
        const searched = new WeakSet();
        let found = null;
        let allComponents = [];
        
        // First, collect ALL Vue components
        function collectComponents(comp, path, depth) {
            if (depth > 20 || !comp || found) return;
            
            try {
                if (searched.has(comp)) return;
                searched.add(comp);
            } catch (e) { return; }
            
            // Store component info
            const name = comp.$options?.name || comp.constructor?.name || 'Anonymous';
            allComponents.push({comp, path, name, depth});
            
            // Check $children
            if (comp.$children && Array.isArray(comp.$children)) {
                comp.$children.forEach((child, i) => {
                    collectComponents(child, `${path}.$children[${i}]`, depth + 1);
                });
            }
            
            // Check $refs
            if (comp.$refs) {
                for (const refName of Object.keys(comp.$refs)) {
                    const ref = comp.$refs[refName];
                    if (ref && ref.$options) {
                        collectComponents(ref, `${path}.$refs.${refName}`, depth + 1);
                    }
                }
            }
        }
        
        // Collect all components starting from $nuxt
        collectComponents(window.$nuxt, '$nuxt', 0);
        console.log(`  Found ${allComponents.length} Vue components`);
        
        // Look for game-related components by name
        const gameComponentNames = ['game', 'board', 'hex', 'map', 'play', 'catan', 'match'];
        const gameComponents = allComponents.filter(({name}) => 
            gameComponentNames.some(kw => name.toLowerCase().includes(kw))
        );
        
        if (gameComponents.length > 0) {
            console.log(`  Found ${gameComponents.length} game-related components:`);
            gameComponents.forEach(({name, path}) => console.log(`    - ${name} at ${path}`));
        }
        
        // Search each component for game state
        for (const {comp, path, name} of allComponents) {
            try {
                // Check component data
                const data = comp._data || comp.$data || {};
                const dataKeys = Object.keys(data);
                
                // Look for hexes, tiles, board, players
                if (data.hexes && Array.isArray(data.hexes)) {
                    console.log(`  🎯 Found hexes in ${name} (${path})._data.hexes`);
                    found = data;
                    colonistGameState = data;
                    return found;
                }
                
                if (data.board && data.board.hexes) {
                    console.log(`  🎯 Found board in ${name} (${path})._data.board`);
                    found = data.board;
                    colonistGameState = data.board;
                    return found;
                }
                
                if (data.gameState || data.game) {
                    const gs = data.gameState || data.game;
                    console.log(`  🎯 Found gameState in ${name} (${path})`);
                    if (gs.hexes || gs.board) {
                        found = gs;
                        colonistGameState = gs;
                        return found;
                    }
                }
                
                if (data.tiles && Array.isArray(data.tiles)) {
                    console.log(`  🎯 Found tiles in ${name} (${path})._data.tiles`);
                    found = data;
                    colonistGameState = data;
                    return found;
                }
                
                // Check if any data key contains game data
                for (const key of dataKeys) {
                    const val = data[key];
                    if (val && typeof val === 'object' && !Array.isArray(val)) {
                        if (val.hexes || val.tiles || val.board) {
                            console.log(`  🎯 Found game data in ${name}._data.${key}`);
                            found = val;
                            colonistGameState = val;
                            return found;
                        }
                    }
                }
                
                // Check computed properties
                if (comp._computedWatchers) {
                    for (const key of Object.keys(comp._computedWatchers)) {
                        try {
                            const val = comp[key];
                            if (val && typeof val === 'object') {
                                if (val.hexes || val.tiles || (Array.isArray(val) && val.length === 19)) {
                                    console.log(`  🎯 Found game data in ${name}.${key} (computed)`);
                                    found = val;
                                    colonistGameState = comp;
                                    return found;
                                }
                            }
                        } catch (e) {}
                    }
                }
                
                // Check component itself for game-related properties
                const compKeys = ['hexes', 'tiles', 'board', 'gameState', 'gameData', 'mapData', 'boardData'];
                for (const key of compKeys) {
                    if (comp[key]) {
                        console.log(`  🎯 Found ${key} in ${name}.${key}`);
                        found = comp[key];
                        colonistGameState = comp;
                        return found;
                    }
                }
                
            } catch (e) {}
        }
        
        // If not found, show what data we DID find in game components
        if (!found && gameComponents.length > 0) {
            console.log("\n  📋 Data in game-related components:");
            gameComponents.forEach(({comp, name, path}) => {
                try {
                    const data = comp._data || comp.$data || {};
                    const keys = Object.keys(data);
                    if (keys.length > 0) {
                        console.log(`    ${name}: ${keys.slice(0, 10).join(', ')}`);
                    }
                } catch (e) {}
            });
        }
        
        return found;
    }
    
    function searchPixiForGameState() {
        console.log("  Searching for Pixi.js application...");
        
        // Method 1: Find ALL canvases - the game one should be large
        const allCanvases = document.querySelectorAll('canvas');
        console.log(`  Found ${allCanvases.length} canvas elements:`);
        
        let gameCanvas = null;
        allCanvases.forEach((canvas, i) => {
            console.log(`    [${i}] ${canvas.width}x${canvas.height}, id="${canvas.id}", class="${canvas.className}"`);
            // Game canvas should be large
            if (canvas.width > 500 && canvas.height > 400) {
                gameCanvas = canvas;
                console.log(`    ^ This looks like the game canvas!`);
            }
        });
        
        if (!gameCanvas && allCanvases.length > 0) {
            // Take the largest one
            gameCanvas = Array.from(allCanvases).sort((a, b) => 
                (b.width * b.height) - (a.width * a.height)
            )[0];
            console.log(`  Using largest canvas: ${gameCanvas.width}x${gameCanvas.height}`);
        }
        
        // Method 1: Find PIXI on window
        if (window.PIXI) {
            console.log("  Found window.PIXI");
            // PIXI.utils.TextureCache might have sprite info
            if (window.PIXI.utils?.TextureCache) {
                console.log("  TextureCache keys:", Object.keys(window.PIXI.utils.TextureCache).slice(0, 10));
            }
        }
        
        // Method 2: Search for __PIXI_APP__ or similar
        const pixiAppKeys = Object.keys(window).filter(k => 
            k.toLowerCase().includes('pixi') || k.toLowerCase().includes('app')
        );
        if (pixiAppKeys.length > 0) {
            console.log("  Window keys with pixi/app:", pixiAppKeys);
        }
        
        // Method 3: Look for game container in DOM and trace to Pixi
        const gameContainer = document.querySelector('#game-container, .game-container, [class*="game"], #game');
        if (gameContainer) {
            console.log("  Found game container:", gameContainer.id || gameContainer.className);
            
            // Check for Vue instance on game container
            const vueKey = Object.keys(gameContainer).find(k => k.startsWith('__vue'));
            if (vueKey) {
                console.log("  Found Vue instance on game container!");
                const vue = gameContainer[vueKey];
                return searchVueForGameData(vue, 'gameContainer.__vue__');
            }
        }
        
        // Method 4: Search canvas for attached data
        if (gameCanvas) {
            console.log("  Searching game canvas properties...");
            const canvasKeys = Object.keys(gameCanvas);
            console.log("  Canvas properties:", canvasKeys.join(', ') || '(none)');
            
            // Check parent elements for Vue/game data
            let parent = gameCanvas.parentElement;
            let depth = 0;
            while (parent && depth < 10) {
                const vueKey = Object.keys(parent).find(k => k.startsWith('__vue'));
                if (vueKey) {
                    console.log(`  Found Vue on canvas ancestor (depth ${depth}):`, parent.className || parent.id);
                    const vue = parent[vueKey];
                    const result = searchVueForGameData(vue, `canvas.parent[${depth}].__vue__`);
                    if (result) return result;
                }
                parent = parent.parentElement;
                depth++;
            }
        }
        
        // Method 5: Search ALL elements with __vue__ for game data
        console.log("  Searching ALL DOM elements for Vue instances with game data...");
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
            try {
                const vueKey = Object.keys(el).find(k => k.startsWith('__vue'));
                if (vueKey) {
                    const vue = el[vueKey];
                    const data = vue._data || vue.$data || {};
                    const dataKeys = Object.keys(data);
                    
                    // Check for game-related data
                    if (dataKeys.some(k => ['hexes', 'tiles', 'board', 'gameState', 'players', 'map'].includes(k))) {
                        console.log(`  🎯 Found game data in Vue on element:`, el.className || el.id);
                        console.log(`    Data keys: ${dataKeys.join(', ')}`);
                        colonistGameState = data;
                        return data;
                    }
                    
                    // Check nested
                    for (const key of dataKeys) {
                        const val = data[key];
                        if (val && typeof val === 'object') {
                            if (val.hexes || val.tiles || val.board) {
                                console.log(`  🎯 Found game data in Vue._data.${key} on element:`, el.className || el.id);
                                colonistGameState = val;
                                return val;
                            }
                        }
                    }
                }
            } catch (e) {}
        }
        
        return null;
    }
    
    function searchVueForGameData(vue, path) {
        if (!vue) return null;
        
        const searched = new WeakSet();
        
        function search(obj, objPath, depth) {
            if (depth > 15 || !obj) return null;
            
            try {
                if (searched.has(obj)) return null;
                searched.add(obj);
            } catch (e) { return null; }
            
            // Check for game data directly
            if (obj.hexes && Array.isArray(obj.hexes)) {
                console.log(`  🎯 Found hexes at ${objPath}`);
                colonistGameState = obj;
                return obj;
            }
            
            if (obj.tiles && Array.isArray(obj.tiles)) {
                console.log(`  🎯 Found tiles at ${objPath}`);
                colonistGameState = obj;
                return obj;
            }
            
            if (obj.board && (obj.board.hexes || obj.board.tiles)) {
                console.log(`  🎯 Found board at ${objPath}`);
                colonistGameState = obj.board;
                return obj.board;
            }
            
            // Check _data
            if (obj._data) {
                const result = search(obj._data, `${objPath}._data`, depth + 1);
                if (result) return result;
            }
            
            // Check $data
            if (obj.$data) {
                const result = search(obj.$data, `${objPath}.$data`, depth + 1);
                if (result) return result;
            }
            
            // Check children
            if (obj.$children && Array.isArray(obj.$children)) {
                for (let i = 0; i < obj.$children.length; i++) {
                    const result = search(obj.$children[i], `${objPath}.$children[${i}]`, depth + 1);
                    if (result) return result;
                }
            }
            
            // Check all object properties
            try {
                for (const key of Object.keys(obj).slice(0, 50)) {
                    if (key.startsWith('_') || key.startsWith('$')) continue;
                    const val = obj[key];
                    if (val && typeof val === 'object') {
                        if (val.hexes || val.tiles || val.board) {
                            console.log(`  🎯 Found game data at ${objPath}.${key}`);
                            colonistGameState = val;
                            return val;
                        }
                    }
                }
            } catch (e) {}
            
            return null;
        }
        
        return search(vue, path, 0);
    }
    
    function searchPixiStageDeep(stage, path) {
        if (!stage) return null;
        
        console.log(`  Searching ${path}, children: ${stage.children?.length || 0}`);
        
        const searched = new WeakSet();
        let found = null;
        let hexContainers = [];
        
        function searchDisplayObject(obj, objPath, depth) {
            if (depth > 15 || !obj || found) return;
            
            try {
                if (searched.has(obj)) return;
                searched.add(obj);
            } catch (e) { return; }
            
            // Check object name/label
            const name = obj.name || obj.label || obj.constructor?.name || '';
            
            // Look for hex/tile/board containers
            if (name.toLowerCase().includes('hex') || 
                name.toLowerCase().includes('tile') ||
                name.toLowerCase().includes('board')) {
                console.log(`  🎯 Found ${name} container at ${objPath}`);
                hexContainers.push({obj, path: objPath, name});
            }
            
            // Check for data attached to display objects
            const dataProps = ['data', 'gameData', 'hexData', 'tileData', 'boardData', 
                              'model', 'state', 'hexes', 'tiles', 'resource', 'resourceType'];
            for (const prop of dataProps) {
                if (obj[prop] !== undefined) {
                    console.log(`  📦 Found ${prop} on ${name || 'object'} at ${objPath}:`, obj[prop]);
                    if (prop === 'hexes' || prop === 'tiles') {
                        found = obj[prop];
                        colonistGameState = obj;
                    }
                }
            }
            
            // Check custom properties that might hold game data
            try {
                const customProps = Object.keys(obj).filter(k => 
                    !k.startsWith('_') && 
                    !['children', 'parent', 'transform', 'worldTransform', 'filters',
                      'visible', 'alpha', 'x', 'y', 'width', 'height', 'scale', 'pivot',
                      'position', 'rotation', 'anchor', 'texture', 'tint', 'blendMode',
                      'eventMode', 'cursor', 'hitArea', 'interactive', 'buttonMode'].includes(k)
                );
                
                if (customProps.length > 0 && depth < 5) {
                    // This object has custom data
                    for (const prop of customProps) {
                        const val = obj[prop];
                        if (val && typeof val === 'object') {
                            if (val.hexes || val.tiles || val.type !== undefined || val.resource !== undefined) {
                                console.log(`  🎯 Found game data in ${objPath}.${prop}:`, val);
                                if (!found) {
                                    found = val;
                                    colonistGameState = obj;
                                }
                            }
                        }
                    }
                }
            } catch (e) {}
            
            // Recurse into children
            if (obj.children && Array.isArray(obj.children)) {
                for (let i = 0; i < Math.min(obj.children.length, 100); i++) {
                    searchDisplayObject(obj.children[i], `${objPath}[${i}]`, depth + 1);
                }
            }
        }
        
        searchDisplayObject(stage, path, 0);
        
        if (hexContainers.length > 0) {
            console.log(`\n  Found ${hexContainers.length} hex/tile/board containers!`);
            // Store for later inspection
            window._colonistHexContainers = hexContainers;
            console.log("  Saved to window._colonistHexContainers for inspection");
            
            // Analyze first hex container
            const first = hexContainers[0];
            if (first && first.obj.children) {
                console.log(`  First container has ${first.obj.children.length} children`);
                
                // Look at first few children for structure
                first.obj.children.slice(0, 3).forEach((child, i) => {
                    const props = Object.keys(child).filter(k => !k.startsWith('_'));
                    console.log(`    Child ${i}: ${child.name || child.constructor?.name}, props: ${props.slice(0, 10).join(', ')}`);
                });
            }
        }
        
        return found;
    }
    
    function bruteForceSearchWindow() {
        const gameKeywords = ['game', 'board', 'catan', 'hex', 'tile', 'colonist'];
        const candidates = [];
        
        for (const key of Object.keys(window)) {
            // Skip browser builtins
            if (['localStorage', 'sessionStorage', 'document', 'location', 'navigator', 
                 'performance', 'crypto', 'indexedDB', 'caches', 'console'].includes(key)) continue;
            
            const keyLower = key.toLowerCase();
            if (gameKeywords.some(kw => keyLower.includes(kw))) {
                try {
                    const val = window[key];
                    if (val && typeof val === 'object') {
                        console.log(`  Checking window.${key}...`);
                        candidates.push({key, val});
                        
                        // Check for hexes/tiles directly
                        if (val.hexes || val.tiles || val.board) {
                            console.log(`  🎯 Found game data at window.${key}!`);
                            colonistGameState = val;
                            return val;
                        }
                    }
                } catch (e) {}
            }
        }
        
        // Search candidates deeper
        for (const {key, val} of candidates) {
            try {
                for (const subKey of Object.keys(val).slice(0, 30)) {
                    const subVal = val[subKey];
                    if (subVal && typeof subVal === 'object') {
                        if (subVal.hexes || subVal.tiles || Array.isArray(subVal.players)) {
                            console.log(`  🎯 Found at window.${key}.${subKey}!`);
                            colonistGameState = subVal;
                            return subVal;
                        }
                    }
                }
            } catch (e) {}
        }
        
        return null;
    }
    
    // ==================== REACT FIBER SCANNING ====================
    
    function scanReactFiber() {
        console.log("🔍 Scanning for React fiber...");
        
        // Find React root
        const root = document.getElementById('root') || document.getElementById('app') || document.querySelector('[data-reactroot]');
        if (!root) {
            console.log("  No React root found");
            return;
        }
        
        // Look for React internal keys
        const fiberKey = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
        if (!fiberKey) {
            console.log("  No React fiber found");
            return;
        }
        
        console.log("  Found React fiber:", fiberKey);
        
        try {
            const fiber = root[fiberKey];
            searchFiberForGameState(fiber, 0);
        } catch (e) {
            console.log("  Error searching fiber:", e.message);
        }
    }
    
    function searchFiberForGameState(fiber, depth) {
        if (!fiber || depth > 20) return;
        
        // Check memoizedState and memoizedProps
        const state = fiber.memoizedState;
        const props = fiber.memoizedProps;
        
        if (state) {
            checkForGameData(state, 'React state');
        }
        if (props) {
            checkForGameData(props, 'React props');
        }
        
        // Traverse
        if (fiber.child) searchFiberForGameState(fiber.child, depth + 1);
        if (fiber.sibling) searchFiberForGameState(fiber.sibling, depth);
    }
    
    function checkForGameData(obj, source) {
        if (!obj || typeof obj !== 'object') return;
        
        try {
            const str = JSON.stringify(obj).toLowerCase();
            if (str.includes('hexes') || str.includes('"tiles"') || str.includes('robber')) {
                console.log(`  🎯 Found game data in ${source}!`, obj);
                if (obj.hexes || obj.tiles) {
                    colonistGameState = obj;
                    parseGameState(obj);
                }
            }
        } catch (e) {}
    }
    
    console.log("═══════════════════════════════════════════════════════════");
    console.log("🎲 COLONIST SNIFFER v3.8 LOADED");
    console.log("═══════════════════════════════════════════════════════════");
    console.log("For best results: Run script BEFORE joining a game!");
    console.log("───────────────────────────────────────────────────────────");
    console.log("Commands:");
    console.log("  colonistSniffer.nuclearSearch()       - ☢️ SEARCH EVERYTHING");
    console.log("  colonistSniffer.deepVueSearch()       - 🔍 Deep Vue search");
    console.log("  colonistSniffer.inspectStore()        - 🏪 Vuex store");
    console.log("  colonistSniffer.analyzeGameProtocol() - 🔬 Protocol analysis");
    console.log("  colonistSniffer.howToCapture()        - 📋 Instructions");
    console.log("───────────────────────────────────────────────────────────");
    console.log("👉 Try: colonistSniffer.nuclearSearch()");
    console.log("═══════════════════════════════════════════════════════════");
    
    // Auto-initialize
    hookFetch();
    hookXHR();
    findLogElement();
    
    // Run initial scan after short delay
    setTimeout(() => {
        console.log("🔄 Running initial scan...");
        console.log("───────────────────────────────────────────────────────────");
        
        // CRITICAL: Find and hook existing WebSocket connections first
        const wsCount = findExistingWebSockets();
        
        findColonistGameState();
        extractBoardFromDOM();
        
        if (wsCount > 0) {
            console.log("───────────────────────────────────────────────────────────");
            console.log("✅ Found & hooked existing WebSocket connection!");
            console.log("👉 Play a turn, then run: colonistSniffer.getWSMessages()");
        } else {
            console.log("───────────────────────────────────────────────────────────");
            console.log("⚠️ No WebSocket found. Trying alternative methods...");
            console.log("👉 Run: colonistSniffer.scan() to search again");
        }
    }, 1000);
    
})();
