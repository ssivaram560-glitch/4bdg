const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');
const fs          = require('fs');

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    = process.env.BOT_TOKEN || "8999335291:AAHQgFT32JdvP2ELvgBvgl-xof35DeGOxxI"
const OWNER_ID     = 1865939951;
const OWNER_PASS   = "praveensaran";
const ADMIN_HANDLE = "@lucifer1570";

const REG_LINK     = "https://bdgwinuu.com/#/register?invitationCode=7442815992780";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://api.bdg88zf.com/api/webapi/Login";
const CAPTCHA_URL = "https://api.bdg88zf.com/api/webapi/GetCaptcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";

// Martingale multipliers — user can customize base bet
const MULT = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683]; // Standard 3x Martingale multipliers
const LEVEL_REQUIREMENTS = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
const LEVEL_RULES = {
    1: { type: 'none' },
    2: { type: 'none' },
    3: { type: 'none' },
    4: { type: 'none' },
    5: { type: 'none' },
    6: { type: 'none' },
    7: { type: 'none' },
    8: { type: 'none' },
    9: { type: 'none' },
    10: { type: 'none' },
    11: { type: 'none' },
    12: { type: 'none' },
    13: { type: 'none' },
    14: { type: 'none' },
    15: { type: 'none' }
};

function getLevelRule(level) {
    const safeLevel = Math.max(1, Math.min(15, Number(level) || 1));
    return LEVEL_RULES[safeLevel] || { type: 'none' };
}

function getNextLevel(level, maxLvl) {
    const safeMax = Math.max(1, Number(maxLvl) || 15);
    return Math.min(Math.max(1, Number(level) || 1) + 1, safeMax);
}

// ============================================================
//  RENDER KEEP-ALIVE
// ============================================================
const { URL } = require('url');
const http = require('http');
const PORT = process.env.PORT || 5000;
const LOCAL_LOGIN_SECRET = process.env.LOCAL_LOGIN_SECRET || "local-secret";
const localAuthTokens = new Set();
// Clean up localAuthTokens periodically to prevent memory leak
setInterval(() => {
    if (localAuthTokens.size > 50) {
        const first = localAuthTokens.values().next().value;
        localAuthTokens.delete(first);
    }
}, 60 * 60 * 1000);

function isLocalHostRequest(req) {
    const addr = req.socket.remoteAddress;
    return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

function createLocalAuthToken() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

http.createServer((req, res) => {
    try {
        const base = `http://${req.headers.host || 'localhost'}`;
        const url = new URL(req.url || '/', base);

        if (url.pathname === '/login') {
            if (!isLocalHostRequest(req)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                return res.end('Access denied: localhost only.');
            }

            const secret = url.searchParams.get('secret');
            if (secret === LOCAL_LOGIN_SECRET) {
                const token = createLocalAuthToken();
                localAuthTokens.add(token);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                return res.end(`
                    <h1>Local Login Success</h1>
                    <p>Your token:</p>
                    <pre>${token}</pre>
                    <p>Use <code>/status?token=${token}</code> or <code>/logout?token=${token}</code>.</p>
                `);
            }

            res.writeHead(200, { 'Content-Type': 'text/html' });
            return res.end(`
                <h1>Local Login</h1>
                <p>Open <code>http://localhost:${PORT}/login?secret=YOUR_SECRET</code></p>
                <p>Current secret is set by <code>LOCAL_LOGIN_SECRET</code>.</p>
            `);
        }

        if (url.pathname === '/status') {
            if (!isLocalHostRequest(req)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                return res.end('Access denied: localhost only.');
            }

            const token = url.searchParams.get('token');
            if (!token || !localAuthTokens.has(token)) {
                res.writeHead(401, { 'Content-Type': 'text/plain' });
                return res.end('Unauthorized. Login first using /login?secret=YOUR_SECRET');
            }

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({
                server: 'SIVA BOT',
                ownerId: OWNER_ID,
                ownerPass: OWNER_PASS ? 'SET' : 'NOT SET',
                localLoginSecret: LOCAL_LOGIN_SECRET ? 'SET' : 'NOT SET',
                state: {
                    ownerLoggedIn,
                    adminLoggedIn,
                    usersAccess: Object.keys(usersAccess).length,
                    running: Object.keys(running).filter(k => running[k]).length,
                    userTokens: Object.keys(userTokens).length,
                    globalToken: !!GLOBAL_TOKEN,
                    port: PORT
                }
            }, null, 2));
        }

        if (url.pathname === '/logout') {
            if (!isLocalHostRequest(req)) {
                res.writeHead(403, { 'Content-Type': 'text/plain' });
                return res.end('Access denied: localhost only.');
            }

            const token = url.searchParams.get('token');
            if (token && localAuthTokens.delete(token)) {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                return res.end('Logged out successfully.');
            }

            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Invalid or missing token.');
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('SIVA BOT OK');
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
    }
}).listen(PORT, () => console.log(`✅ Keep-alive server on port ${PORT}`));

const RENDER_URL = process.env.RENDER_URL || "";
if (RENDER_URL) {
    setInterval(() => {
        axios.get(RENDER_URL).catch(() => {});
        console.log("[PING] Keep-alive ping sent");
    }, 14 * 60 * 1000);
}

// Auto-save prediction data every 5 minutes
setInterval(() => {
    savePersistentData();
    console.log("[AUTO-SAVE] Prediction data saved");
}, 5 * 60 * 1000);

// ============================================================
//  STORAGE
// ============================================================
let ownerLoggedIn  = false;
let browserLock    = false;
let adminPasswords = {};
let adminLoggedIn  = {};
let usersAccess    = {};
let keyStore       = {};
let stats          = {};
let running        = {};
let sentPeriods    = {};
let ownerState     = null;
let adminState   = {};
let userAction   = {}; 
let userCreds      = {};
let autobetCfg     = {};
let autobetState   = {};
let profitTrack    = {};
let GLOBAL_TOKEN   = "";
let userTokens = {}; 
let userTimers = {};

function trackUserTimer(userId, timerId) {
    if (!userId) return timerId;
    if (!userTimers[userId]) userTimers[userId] = new Set();
    userTimers[userId].add(timerId);
    return timerId;
}

function clearUserTimers(userId) {
    if (!userId || !userTimers[userId]) return;
    for (const timerId of userTimers[userId]) {
        clearTimeout(timerId);
    }
    delete userTimers[userId];
}

// ============================================================
//  LOGGING HELPER (New)
// ============================================================
async function logBoth(chatId, msg, isError = false) {
    if (isError) console.error(msg);
    else console.log(msg);
    if (chatId) {
        // Use the global bot instance if available
        if (bot) {
            try {
                await bot.sendMessage(chatId, msg);
            } catch (e) {
                // Ignore message sending errors to prevent loops
            }
        }
    }
}

// ============================================================
//  PREDICTION RESULT STORAGE & STATISTICS
// ============================================================
// Store prediction results to improve accuracy over time
function ensurePredictionStorage(userId) {
    if (!persistentData.predictions) persistentData.predictions = {};
    if (!persistentData.predictions[userId]) {
        persistentData.predictions[userId] = {
            results: [],      // [{issue, timestamp, predicted, actual, won, level, confidence, reason}, ...]
            stats: {
                byLevel: {},  // {1: {total, wins, losses, accuracy}, ...}
                byType: {},   // {SIZE: {total, wins, losses, accuracy}, COLOR: {...}}
                overall: { total: 0, wins: 0, losses: 0, accuracy: 0 }
            }
        };
    }
    return persistentData.predictions[userId];
}

function savePredictionResult(userId, issue, predicted, actual, won, level, confidence, reason, predType = "SIZE", part = null) {
    try {
        const storage = ensurePredictionStorage(userId);
        
        // Record result
        const result = {
            issue: String(issue),
            timestamp: Date.now(),
            predicted,
            actual,
            won: !!won,
            level: Number(level) || 1,
            confidence: Number(confidence) || 50,
            reason,
            type: predType,
            part: Number(part) || null
        };
        
        storage.results.push(result);
        if (storage.results.length > 1000) {
            storage.results.shift(); // Keep last 1000 results
        }
        
        // Update statistics
        updatePredictionStats(userId);
        
        // Save to disk
        savePersistentData();
        
        return result;
    } catch (e) {
        console.error("[PREDICTION STORAGE ERROR]", e.message);
        return null;
    }
}

function updatePredictionStats(userId) {
    try {
        const storage = ensurePredictionStorage(userId);
        const { results } = storage;
        
        // Reset stats
        storage.stats = {
            byLevel: {},
            byType: {},
            overall: { total: 0, wins: 0, losses: 0, accuracy: 0 }
        };
        
        results.forEach(r => {
            const level = r.level || 1;
            const type = r.type || "SIZE";
            
            // By Level
            if (!storage.stats.byLevel[level]) {
                storage.stats.byLevel[level] = { total: 0, wins: 0, losses: 0, accuracy: 0 };
            }
            storage.stats.byLevel[level].total++;
            if (r.won) storage.stats.byLevel[level].wins++;
            else storage.stats.byLevel[level].losses++;
            storage.stats.byLevel[level].accuracy = 
                storage.stats.byLevel[level].total > 0 
                    ? (storage.stats.byLevel[level].wins / storage.stats.byLevel[level].total * 100).toFixed(1)
                    : 0;
            
            // By Type
            if (!storage.stats.byType[type]) {
                storage.stats.byType[type] = { total: 0, wins: 0, losses: 0, accuracy: 0 };
            }
            storage.stats.byType[type].total++;
            if (r.won) storage.stats.byType[type].wins++;
            else storage.stats.byType[type].losses++;
            storage.stats.byType[type].accuracy = 
                storage.stats.byType[type].total > 0 
                    ? (storage.stats.byType[type].wins / storage.stats.byType[type].total * 100).toFixed(1)
                    : 0;
            
            // Overall
            storage.stats.overall.total++;
            if (r.won) storage.stats.overall.wins++;
            else storage.stats.overall.losses++;
        });
        
        storage.stats.overall.accuracy = 
            storage.stats.overall.total > 0 
                ? (storage.stats.overall.wins / storage.stats.overall.total * 100).toFixed(1)
                : 0;
        
        savePersistentData();
    } catch (e) {
        console.error("[STATS UPDATE ERROR]", e.message);
    }
}

function getPredictionStats(userId, level = null) {
    const storage = ensurePredictionStorage(userId);
    if (level !== null) {
        return storage.stats.byLevel[level] || { total: 0, wins: 0, losses: 0, accuracy: 0 };
    }
    return storage.stats;
}

function getAdaptiveAccuracyLevel(userId, currentLevel, maxLvl = 15) {
    try {
        const storage = ensurePredictionStorage(userId);
        const recent = (storage.results || []).slice(-30);
        if (recent.length < 8) {
            return Math.max(1, Number(currentLevel) || 1);
        }

        const wins = recent.filter(r => !!r.won).length;
        const accuracy = (wins / recent.length) * 100;
        const safeBase = Math.max(1, Number(currentLevel) || 1);
        const safeMax = Math.max(1, Number(maxLvl) || 15);

        let boost = 0;
        if (accuracy >= 90) boost = 2;
        else if (accuracy >= 80) boost = 1;
        else if (accuracy >= 70) boost = 0;
        else if (accuracy <= 35) boost = -2;
        else if (accuracy <= 45) boost = -1;

        return Math.max(1, Math.min(safeMax, safeBase + boost));
    } catch (e) {
        console.error("[ADAPTIVE LEVEL ERROR]", e.message);
        return Math.max(1, Number(currentLevel) || 1);
    }
}

function getMlLevelRecommendation(userId, currentLevel, maxLvl = 15) {
    try {
        const storage = ensurePredictionStorage(userId);
        const recent = (storage.results || []).slice(-20);
        if (recent.length < 6) {
            return Math.max(1, Number(currentLevel) || 1);
        }

        const safeBase = Math.max(1, Number(currentLevel) || 1);
        const safeMax = Math.max(1, Number(maxLvl) || 15);

        const recentWins = recent.filter(r => !!r.won).length;
        const windowAccuracy = (recentWins / recent.length) * 100;
        const lastTen = recent.slice(-10);
        const lastTenWins = lastTen.filter(r => !!r.won).length;
        const recent10Accuracy = (lastTenWins / lastTen.length) * 100;

        let momentum = 0;
        for (let i = 1; i < recent.length; i++) {
            if (recent[i].won && !recent[i - 1].won) momentum += 1;
            if (!recent[i].won && recent[i - 1].won) momentum -= 1;
        }

        const riskPenalty = recent.filter(r => !r.won).slice(-4).length * 4;
        const mlScore = (windowAccuracy * 0.45) + (recent10Accuracy * 0.35) + (Math.max(-10, Math.min(10, momentum)) * 2.5) - riskPenalty;

        let delta = 0;
        if (mlScore >= 82) delta = 2;
        else if (mlScore >= 72) delta = 1;
        else if (mlScore <= 38) delta = -2;
        else if (mlScore <= 48) delta = -1;

        const combined = safeBase + delta;
        return Math.max(1, Math.min(safeMax, combined));
    } catch (e) {
        console.error("[ML LEVEL ERROR]", e.message);
        return Math.max(1, Number(currentLevel) || 1);
    }
}

// ============================================================
//  HELPERS
// ============================================================
async function fetchList() {
    try {
        const response = await axios.get(DRAW_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://bdgwin901.com",
                "Referer": "https://bdgwin901.com/",
                "Ar-Origin": "https://bdgwin901.com",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
            },
            timeout: 10000
        });
        if (response.data && response.data.data && response.data.data.list) {
            return response.data.data.list;
        }
        return [];
    } catch (error) {
        console.error("[FETCH LIST ERROR]", error.message);
        return null;
    }
}
// Helper parser function
async function parseBalanceResponse(r) {
    if (r.data && r.data.code === 0 && r.data.data && typeof r.data.data.balance !== 'undefined') {
        return { success: true, balance: r.data.data.balance };
    }
    return {
        success: false,
        message: r.data && r.data.msg ? r.data.msg : "Token expired or invalid"
    };
}

async function getLiveBalance(userId, chatId = null) {
    let token = getToken(userId);
    
    // Optional: Auto login if token is missing
    if (!token && chatId) {
        const ok = await autoLogin(userId, chatId, true);
        if (ok) token = getToken(userId);
    }

    if (!token) return { success: false, message: "No token" };

    const url = "https://api.bdg88zf.com/api/webapi/GetBalance";
    const headers = {
        "Authorization": "Bearer " + token,
        "Ar-Origin": "https://bdgwin901.com",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36"
    };

    try {
        const r = await axios.get(url, { headers, timeout: 5000 });
        return await parseBalanceResponse(r);
    } catch (e) {
        if (e.response && e.response.status === 405) {
            try {
                const r2 = await axios.post(url, {}, { headers, timeout: 5000 });
                return await parseBalanceResponse(r2);
            } catch (e2) {
                const errMsg = e2.response?.data?.msg || e2.message || "API Error";
                return { success: false, message: errMsg };
            }
        }
        const errMsg = e.response?.data?.msg || e.message || "API Error";
        return { success: false, message: errMsg };
    }
}

function initUser(id) {
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0 };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { 
        watch:false, 
        watchLoss:2, 
        baseBet:1, 
        maxLvl:15, 
        enabled:false, 
        customBets:[1,3,9,27,81,243,729,2187,6561,19683,59049,177147,531441,1594323,4782969],
        targetProfit: 1000,
        restartDelay: 1
    };
    if (!autobetState[id]) autobetState[id] = { 
        level:1, 
        consecutiveLoss:0, 
        levelLossCount:0,
        waitingAction: null,
        waitingTarget: 0,
        watchConsecutiveLosses: 0,
        inMart:false,
        isWaiting: false,
        nextStartTime: null
    };
    if (!profitTrack[id])  profitTrack[id]  = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0 };
}

// Persistent store loaded from bot_data.json
let persistentData = {};
function loadPersistentData() {
    try {
        const raw = fs.readFileSync("bot_data.json", "utf8");
        persistentData = JSON.parse(raw || "{}") || {};
    } catch (e) {
        console.warn("[DATA] Could not load bot_data.json, initializing new store.");
        persistentData = {};
    }
    if (!persistentData.keyStore) persistentData.keyStore = {};
    if (!persistentData.usersAccess) persistentData.usersAccess = {};
    if (!persistentData.predictions) persistentData.predictions = {};
    if (!persistentData.profitTrack) persistentData.profitTrack = {};
    keyStore = persistentData.keyStore;
    usersAccess = persistentData.usersAccess;
    profitTrack = persistentData.profitTrack;
}
function savePersistentData() {
    try {
        const current = fs.existsSync("bot_data.json") ? JSON.parse(fs.readFileSync("bot_data.json","utf8")||"{}") : {};
        // Merge known persistent stores
        current.keyStore      = keyStore                    || {};
        current.usersAccess   = usersAccess                 || {};
        current.profitTrack   = profitTrack                 || {};
        current.predictions   = persistentData.predictions  || {};
        fs.writeFileSync("bot_data.json", JSON.stringify(current, null, 2), "utf8");
    } catch (e) {
        console.error("[DATA] Failed to save bot_data.json:", e.message);
    }
}
loadPersistentData();

// Expire danger pairs older than the same TTL
function cleanupOldPairs() {
    // Deprecated: no-op kept for compatibility.
    return;
}

async function recordDangerTriple(tripleKey, chatId = null) {
    // Deprecated: removed persistent danger tracking.
    return;
}

async function recordDangerPair(pairKey, chatId = null) {
    // Deprecated: removed persistent pair tracking.
    return;
}

function hasAccess(id) {
    if (Number(id) === Number(OWNER_ID)) return true;
    if (running[id] === true) return true;
    const expiry = usersAccess[id];
    return !!(expiry && Date.now() < expiry);
}
function daysLeft(id) {
    if (Number(id) === Number(OWNER_ID)) return "∞";
    if (running[id] === true) return "RUN";
    const expiry = usersAccess[id];
    if (!expiry) return "0";
    const left = (expiry - Date.now()) / 86400000;
    return left > 0 ? left.toFixed(1) : "0";
}
function isAdmin(id)    { return adminPasswords[id] !== undefined; }
function isAdminIn(id)  { return adminLoggedIn[id] === true; }
function sleep(ms)      { return new Promise(r => setTimeout(r, ms)); }
function getToken(id)   { return userTokens[id] || GLOBAL_TOKEN || ""; }

function getBetAmount(userId, level) {
    const cfg = autobetCfg[userId];
    const safeLevel = Math.max(1, Number(level) || 1);

    if (cfg && Array.isArray(cfg.customBets) && cfg.customBets.length > 0) {
        const index = Math.min(safeLevel - 1, cfg.customBets.length - 1);
        const amount = Number(cfg.customBets[index]);
        return Number.isFinite(amount) && amount > 0 ? amount : (Number(cfg.baseBet) || 1);
    }

    const baseBet = Number(cfg && cfg.baseBet ? cfg.baseBet : 1) || 1;
    return baseBet * MULT[Math.min(safeLevel - 1, MULT.length - 1)];
}

function generateKey(days, by) {
    const k = "EARN WITH ME-"+crypto.randomBytes(3).toString('hex').toUpperCase()+"-"+crypto.randomBytes(2).toString('hex').toUpperCase();
    keyStore[k] = { days, used:false, usedBy:null, by:by||OWNER_ID };
    savePersistentData();
    return k;
}
function activateKey(userId, code) {
    const k = code.toUpperCase().trim();
    if (!keyStore[k])     return { ok:false, msg:"❌ Invalid key!" };
    if (keyStore[k].used) return { ok:false, msg:"❌ Key already used!" };

    const days = Number(keyStore[k].days) || 1;
    const currentExpiry = usersAccess[userId];
    const base = (currentExpiry && currentExpiry > Date.now()) ? currentExpiry : Date.now();
    const newExpiry = base + days * 86400000;

    keyStore[k].used=true;
    keyStore[k].usedBy=userId;
    usersAccess[userId] = newExpiry;
    savePersistentData();
    return { ok:true, days, expiry:new Date(newExpiry).toLocaleString() };
}
function activeUsersList() {
    const now=Date.now();
    const ids = new Set(Object.keys(usersAccess));
    Object.keys(running).forEach(id => { if (running[id]) ids.add(id); });

    const list = [...ids].filter(id => Number(id) === Number(OWNER_ID) || running[id] || Number(usersAccess[id]) > now);
    if (!list.length) return "No active users.";

    return list.map(id => {
        if (Number(id) === Number(OWNER_ID)) return "🟢 " + id + " | ♾️ Unlimited";
        if (running[id]) return "🟢 " + id + " | ⚡ Running";
        const expiry = Number(usersAccess[id]) || 0;
        return "🟢 " + id + " | " + ((expiry - now) / 86400000).toFixed(1) + "d";
    }).join("\n");
}
function adminList() {
    const ids=Object.keys(adminPasswords);
    return ids.length ? ids.map(id=>"👤 "+id+" | "+(adminLoggedIn[id]?"🟢 Online":"🔴 Offline")).join("\n") : "No admins.";
}
function allKeysList() {
    const keys=Object.entries(keyStore);
    return keys.length ? keys.map(([k,v])=>k+" → "+(v.used?"✅ Used":"🟢 "+v.days+"d")).join("\n") : "No keys.";
}

// ============================================================
//  DEVICE ID
// ============================================================
function getOrCreateDevice(userId) {
    if (!userCreds[userId]) userCreds[userId] = {};
    if (!userCreds[userId].deviceId) {
        userCreds[userId].deviceId = crypto.randomBytes(16).toString('hex');
    }
    return userCreds[userId].deviceId;
}

// ============================================================
//  SIGNATURES
// ============================================================
function makeLoginSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp; delete p.track;
    const keys = Object.keys(p).filter(k => {
        const v = p[k];
        if (v === null || v === undefined || v === "") return false;
        if (typeof v === 'object') return false;
        return true;
    }).sort();
    const sorted = {};
    keys.forEach(k => { sorted[k] = p[k]; });
    const str = JSON.stringify(sorted);
    const sig = crypto.createHash('md5').update(str).digest('hex').toUpperCase().slice(0,32);
    return sig;
}

function makeBetSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp;
    const keys = Object.keys(p).filter(k=>p[k]!==null&&p[k]!=="").sort();
    const sorted = {};
    keys.forEach(k=>{ sorted[k]=p[k]===0?0:p[k]; });
    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex').toUpperCase().slice(0,32);
}

// ============================================================
//  FETCH CAPTCHA
// ============================================================
async function fetchCaptcha() {
    try {
        const r = await axios.get(CAPTCHA_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://bdgwin8.vip",
                "Referer": "https://bdgwin8.vip",
                "Ar-Origin": "https://bdgwin901.com",
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
            },
            timeout: 10000
        });
        if (r.data?.code===0 && r.data?.data?.captchaId) {
            return r.data.data.captchaId;
        }
        return "";
    } catch(e) {
        console.error("[CAPTCHA ERR]", e.message);
        return "";
    }
}

// ============================================================
//  AUTO LOGIN (PUPPETEER VERSION)
// ============================================================
async function autoLogin(userId, chatId, silent = false) {
    const creds = userCreds[userId] || {};
    const { phone, pass } = creds;

    if (!phone || !pass) {
        await logBoth(chatId, `[AUTO LOGIN] User ${userId} has no phone or password set.`);
        return false;
    }

    // Browser Queue / Lock to prevent OOM on Render
    if (browserLock) {
        if (!silent) await logBoth(chatId, "⏳ System busy... waiting for login queue.");
        for (let i = 0; i < 45; i++) {
            if (!browserLock) break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (browserLock) {
            if (!silent) await logBoth(chatId, "⚠️ System too busy. Please try again in a minute.");
            return false;
        }
    }

    browserLock = true;
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--disable-gpu'
            ]
        });
        const page = await browser.newPage();
        await page.setDefaultNavigationTimeout(90000); 
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let capturedToken = null;
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.url().includes('GetBalance') && req.headers()['authorization']) {
                capturedToken = req.headers()['authorization'].replace(/^Bearer\s+/i, "");
            }
            req.continue();
        });

        await page.goto('https://bdgwin901.com/#/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
        
        // Wait for input fields to load
        await page.waitForSelector('input[type="text"], input[type="tel"], input[placeholder*="Phone"], input', { timeout: 30000 });
        await sleep(1000);

        // Phone number input field
        const phoneInput = await page.$('input[placeholder*="number"], input[type="tel"], .van-field__control');
        if (phoneInput) {
            await phoneInput.click({ clickCount: 3 });
            await phoneInput.press('Backspace');
            await phoneInput.type(phone, { delay: 50 });
        } else {
            const inputs = await page.$$('input');
            await inputs[1].type(phone, { delay: 50 });
        }

        await sleep(500);

        // Password input field (using 'pass' variable from creds)
        const passwordInput = await page.$('input[type="password"]');
        if (passwordInput) {
            await passwordInput.type(pass, { delay: 50 });
        } else {
            const inputs = await page.$$('input');
            await inputs[2].type(pass, { delay: 50 });
        }

        // Click Login button
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const loginBtn = btns.find(b => b.innerText.includes('Log in') || b.innerText.includes('Login'));
            if (loginBtn) loginBtn.click();
            else document.querySelector('form')?.submit();
        });

        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
        } catch (e) {
            // Ignore timeout, we'll check token anyway
        }
        await new Promise(r => setTimeout(r, 5000));

        await page.evaluate(() => {
            const closeBtn = document.querySelector('.van-icon-cross') || document.querySelector('.close-icon');
            if (closeBtn) closeBtn.click();
        });
        await new Promise(r => setTimeout(r, 1000));

        await page.evaluate(() => {
            const navItems = Array.from(document.querySelectorAll('div, span'));
            const lotteryBtn = navItems.find(el => el.innerText.trim() === 'Lottery');
            if (lotteryBtn) lotteryBtn.click();
        });
        await new Promise(r => setTimeout(r, 2000));

        await page.evaluate(() => {
            const navItems = Array.from(document.querySelectorAll('div, span'));
            const winGoBtn = navItems.find(el => el.innerText.trim() === 'Win Go');
            if (winGoBtn) winGoBtn.click();
        });

        for (let i = 0; i < 50; i++) {
            if (capturedToken) break;
            await new Promise(r => setTimeout(r, 1000));
        }

        if (capturedToken) {
            userTokens[userId] = capturedToken;
            await logBoth(chatId, `✅ [SUCCESS] Token captured successfully for user ${userId}!`);
            return true;
        } else {
            throw new Error("Token not found in requests after login sequence.");
        }

    } catch (err) {
        await logBoth(chatId, `❌ Login Error for user ${userId}: ${err.message}`, true);
        return false;
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error("[BROWSER] Error closing:", e.message);
            }
        }
        browserLock = false;
    }
}

// ============================================================
//  ROBUST LOGIN WITH CONTINUOUS RETRY
// ============================================================
async function robustLogin(userId, chatId, silent = false) {
    let success = await autoLogin(userId, chatId, silent);
    if (!success && !silent && chatId) {
        await logBoth(chatId, "❌ Login failed. Will retry automatically.");
    }
    return success;
}

// ============================================================
//  PLACE BET
// ============================================================
// PLACE BET (Modified to capture token from response if available)
// ============================================================
// ============================================================
//  IMPROVED PLACE BET FUNCTION (Silent Retries & Multi-Request Fix)
// ============================================================
// ============================================================
async function placeBet(userId, chatId, period, prediction, predType, level) {
    let token = getToken(userId);
    if (!token || token.length < 20) {
        console.log("[PLACE BET] Token missing or invalid, attempting autoLogin...");
        const ok = await autoLogin(userId, chatId, true);
        if (!ok) { 
            await send(chatId, "❌ Token இல்லை! Auto-login தோல்வியடைந்தது."); 
            return false; 
        }
        token = getToken(userId);
    }

    const cfg       = autobetCfg[userId];
    const betMult   = getBetAmount(userId, level);
    let bc = "";

    const maxRetries = 5; 
    const retryDelayMs = 2000; 

    if (predType === "SIZE")  bc = prediction === "BIG" ? "BigSmall_Big" : "BigSmall_Small";
    if (predType === "COLOR") bc = prediction === "RED" ? "Color_Red"    : "Color_Green";

    console.log(`[BET] ${bc} ₹${betMult} L${level} for Period: ${period}`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            // Dynamic generation inside the loop so random/timestamp/issueNumber are fresh on retry if needed
            const params = {
                amount:      1,
                betContent:  bc,
                betMultiple: betMult,
                gameCode:    "WinGo_30S", 
                issueNumber: String(period),
                language:    "en",
                random:      Math.floor(Math.random() * 1e12)
            };
            const signature = makeBetSign(params);
            const timestamp = Math.floor(Date.now() / 1000);
            const payload   = {...params, signature, timestamp};

            const r = await axios.post(BET_URL, payload, {
                headers: {
                    "authorization":    "Bearer " + token,
                    "content-type":     "application/json",
                    "Accept":           "application/json, text/plain, */*",
                    "Origin":           "https://bdgwin8.vip",
                    "Referer":          "https://bdgwin8.vip/",
                    "Ar-Origin":        "https://bdgwin8.vip",
                    "Sec-Ch-Ua":        '"Chromium";v="139"',
                    "Sec-Ch-Ua-Mobile": "?1",
                    "Sec-Fetch-Dest":   "empty",
                    "Sec-Fetch-Mode":   "cors",
                    "Sec-Fetch-Site":   "cross-site",
                    "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
                },
                timeout: 10000
            });

            const d = r.data;
            console.log(`[BET RESP] code:${d.code} msg:${d.msg}`);

            // Token check from response headers/body
            const newTokenFromResponseHeader = r.headers['authorization'] || r.headers['x-auth-token'];
            if (newTokenFromResponseHeader) {
                const cleanNewToken = newTokenFromResponseHeader.replace(/^Bearer\s+/i, "");
                if (cleanNewToken !== token) {
                    userTokens[userId] = cleanNewToken;
                    token = cleanNewToken; // update local variable too
                    console.log("[TOKEN UPDATE] New token captured from bet response headers!");
                }
            }

            if (d.data && d.data.token && d.data.token !== token) {
                 userTokens[userId] = d.data.token;
                 token = d.data.token;
                 console.log("[TOKEN UPDATE] New token captured from bet response body!");
            }

            // Success case
            if (d.code === 0 || d.msg === "Succeed" || d.msgCode === 0) {
                return { ok: true, amt: betMult, bc };
            }

            // Token Expiry Handling -> AUTOMATIC RELOGIN (User கேட்காத வண்ணம்)
            if (d.code === 401 || d.code === 40100 || (d.msg && (d.msg.toLowerCase().includes("token") || d.msg.toLowerCase().includes("expired")))) {
                console.log("[AUTO RELOGIN] Token expired during bet. Trying autoLogin...");
                const loginSuccess = await autoLogin(userId, chatId, true);
                if (loginSuccess) {
                    token = getToken(userId); // Get fresh token
                    console.log("[AUTO RELOGIN] Success! Retrying the bet with new token...");
                    continue; // Retry the loop with new token
                } else {
                    await send(chatId, "❌ Auto-login failed during token expiry.");
                    return false;
                }
            }

            // Retryable errors like Param is Invalid, issue number, etc.
            const retryableErrors = ["param is invalid", "the issue number does not exist", "period current settled"];
            const lowerMsg = (d.msg || "").toLowerCase();
            
            if (retryableErrors.some(errStr => lowerMsg.includes(errStr))) {
                console.log(`[BET RETRY] Retryable error: ${d.msg}. Retrying in ${retryDelayMs / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue; 
            }

            // Other unhandled API errors
            await send(chatId, "❌ Bet fail: " + (d.msg || JSON.stringify(d).substr(0, 60)));
            return false;

        } catch (err) {
            console.error("[BET ERR]", err.message);

            // Handle Axios 401 / Token errors inside catch block
            if (err.response && (err.response.status === 401 || (err.response.data && err.response.data.msg && (err.response.data.msg.toLowerCase().includes("token") || err.response.data.msg.toLowerCase().includes("expired"))))) {
                console.log("[AUTO RELOGIN] Token error caught via exception. Trying autoLogin...");
                const loginSuccess = await autoLogin(userId, chatId, true);
                if (loginSuccess) {
                    token = getToken(userId);
                    continue; // Retry after relogin
                } else {
                    await send(chatId, "❌ Auto-login failed during token error.");
                    return false;
                }
            }

            // For general network errors, retry if attempts left
            if (i < maxRetries - 1) {
                console.log(`[BET RETRY] Network error. Retrying in ${retryDelayMs / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue;
            }

            await send(chatId, "❌ Network error during bet: " + err.message);
            return false;
        }
    }

    console.log("[BET FAIL] All retries exhausted.");
    return false;
}
// ============================================================
// PREDICTION LOGIC — 8-PART MASTERMIND ULTRA v10 ENGINE
// Ported from wingo_bot_30s_8parts_final.py
// ============================================================

// -------- BASIC HELPERS --------
function getSize(num) { const n = Number(num); return n >= 5 ? "BIG" : "SMALL"; }
function isSmallJ(n) { return Number(n) <= 4; }
function isRedJ(n) { return [0,2,4,6,8].includes(Number(n)); }
function getSizeBS(n) { return isSmallJ(n) ? "S" : "B"; }
function opposite(size) { return size === "BIG" ? "SMALL" : (size === "SMALL" ? "BIG" : (size === "B" ? "S" : "B")); }
function getResultNum(item) {
    if (!item) return null;
    const num = item.number !== undefined ? item.number : item.winNumber;
    return num !== undefined ? Number(num) : null;
}
function checkABABPattern(list) {
    if (!list || list.length < 5) return false;
    const last5 = [];
    for (let i = 0; i < 5; i++) {
        const num = getResultNum(list[i]);
        if (num === null) return false;
        last5.push(getSize(num));
    }
    last5.reverse();
    const p = last5.join("");
    return p === "BSBSB" || p === "SBSBS";
}

// -------- 8-PART GLOBAL STATE (per-user independent) --------
const LOSS_TRIGGER = 6;

function createEngineState(name) {
    return {
        name, lossCount: 0, active: false, curPred: null,
        wins: 0, losses: 0, hist: [], bestStreak: 0, _winStreak: 0
    };
}

const userPartState = {};

function ensurePartState(userId) {
    if (!userPartState[userId]) {
        userPartState[userId] = {
            logicPart: 1, part5Level: 1,
            consecutiveLoss: 0, level: 1, streak: 0,
            hist: [], p4Markov: {}, p4DigitStats: {}, p8PatternDB: [],
            switchReason: "Started on P1 (default master)",
            lastSwitchFrom: null,
            e1: createEngineState("PART1"), e2: createEngineState("PART2"),
            e3: createEngineState("PART3"), e4: createEngineState("PART4"),
            e5: createEngineState("PART5"), e6: createEngineState("PART6"),
            e7: createEngineState("PART7"), e8: createEngineState("PART8"),
            e9: createEngineState("PART9")
        };
    }
    return userPartState[userId];
}

function resetPartState(userId) {
    delete userPartState[userId];
    return ensurePartState(userId);
}

function partEngine(st, part) {
    const arr = [null, st.e1, st.e2, st.e3, st.e4, st.e5, st.e6, st.e7, st.e8];
    if (part <= 8) return arr[part];
    if (part === 9) return st.e9 || st.e8;
    return st.e8;
}

function selectLowestStreakPart(st) {
    let bestPart = 1;
    let bestLoss = Infinity;
    for (let p = 1; p <= 8; p++) {
        const lc = partEngine(st, p).lossCount || 0;
        if (lc < bestLoss) {
            bestLoss = lc;
            bestPart = p;
        }
    }
    return bestPart;
}

function scorePartPattern(e) {
    const wins = Number(e.wins) || 0;
    const losses = Number(e.losses) || 0;
    const total = wins + losses;
    const overallRate = total > 0 ? wins / total : 0;
    const recent = Array.isArray(e.hist) ? e.hist.slice(-8) : [];
    const recentWins = recent.filter(h => !!h.won).length;
    const recentRate = recent.length > 0 ? recentWins / recent.length : 0;
    const bestStreak = Number(e.bestStreak) || 0;
    const lossPenalty = (Number(e.lossCount) || 0) * 0.12;
    return (overallRate * 45) + (recentRate * 35) + (bestStreak * 0.2) + (e.active ? 5 : 0) - lossPenalty;
}

function selectBestPatternPart(st, currentPart = st.logicPart || 1) {
    let bestPart = currentPart;
    let bestScore = -Infinity;
    for (let p = 1; p <= 8; p++) {
        const e = partEngine(st, p);
        const score = scorePartPattern(e);
        if (score > bestScore) {
            bestScore = score;
            bestPart = p;
        }
    }
    return bestPart;
}

function selectBestPart(st, triggerPart) {
    let bestPart = 1;
    let bestScore = [-Infinity, -Infinity, -Infinity];
    const tp = Number(triggerPart) || 0;
    for (let p = 1; p <= 8; p++) {
        const e = partEngine(st, p);
        const w = Number(e.wins) || 0;
        const l = Number(e.losses) || 0;
        const lc = Number(e.lossCount) || 0;
        const lossRate = (l + 1) / (w + l + 2);
        const score = [lossRate, lc, p === tp ? 0 : 1];
        if (
            score[0] > bestScore[0] ||
            (score[0] === bestScore[0] && score[1] > bestScore[1]) ||
            (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] > bestScore[2])
        ) {
            bestScore = score;
            bestPart = p;
        }
    }
    const rates = [];
    for (let p = 1; p <= 8; p++) {
        const e = partEngine(st, p);
        const w = Number(e.wins) || 0, l = Number(e.losses) || 0;
        rates.push(`P${p} ${(100*((l+1)/(w+l+2))).toFixed(0)}%(${l}/${w+l})`);
    }
    return { part: bestPart, lossRate: bestScore[0], summary: rates.join(" | ") };
}

function recordEngineResult(eng, won, issue, resultNum, pred) {
    eng.hist.push({ issue, result: resultNum, pred: pred.prediction || "?", numbers: pred.numbers || [], primary: pred.primary || 0, engine: pred.engine || eng.name, won });
    if (eng.hist.length > 400) eng.hist.shift();
    if (won) {
        eng.wins++; eng._winStreak++;
        if (eng._winStreak > eng.bestStreak) eng.bestStreak = eng._winStreak;
        eng.lossCount = 0; eng.active = false;
    } else {
        eng.losses++; eng._winStreak = 0; eng.lossCount++;
        if (!eng.active && eng.lossCount >= LOSS_TRIGGER) eng.active = true;
    }
}

// ============================================================
// PART 1 — MASTERMIND ULTRA v10 AI ENGINE
// ============================================================
function masterAiV10(history, level, st) {
    const fallback = (lvl) => ({
        prediction: lvl === 3 ? "B" : "S",
        confidence: lvl === 3 ? 97 : (lvl === 2 ? 93 : 88),
        numbers: lvl === 3 ? [7,8] : [2,3],
        primary: lvl === 3 ? 7 : 2,
        engine: "MASTERMIND ULTRA v10"
    });
    const nums = history.filter(n => typeof n === 'number' && !isNaN(n) && 0 <= n && n <= 9).map(Number);
    if (nums.length < 3) return fallback(level);

    const freq = new Array(10).fill(0);
    for (let i = 0; i < nums.length; i++) {
        const n = nums[i];
        const w = Math.pow(0.85, nums.length - 1 - i);
        freq[n] += w * 2;
        if (n > 0) freq[n-1] += w * 0.4;
        if (n < 9) freq[n+1] += w * 0.4;
    }

    const l3 = nums.slice(-3), l5 = nums.slice(-5);
    const l7 = nums.slice(-Math.min(7, nums.length));
    const l12 = nums.slice(-Math.min(12, nums.length));
    const sm3 = l3.filter(n => n <= 4).length;
    const sm5 = l5.filter(n => n <= 4).length;
    const sm7 = l7.filter(n => n <= 4).length;
    const sm12 = l12.filter(n => n <= 4).length;

    let ss = (sm3/3)*0.40 + (sm5/5)*0.28 + (sm7/7)*0.20 + (sm12/12)*0.12;
    let bs = ((3-sm3)/3)*0.40 + ((5-sm5)/5)*0.28 + ((7-sm7)/7)*0.20 + ((12-sm12)/12)*0.12;

    let sl = 0, sd = null;
    for (let i = nums.length - 1; i >= 0; i--) {
        const isS = nums[i] <= 4;
        if (sd === null) { sd = isS; sl = 1; }
        else if (isS === sd) sl++;
        else break;
    }
    if (sl >= 4) { if (sd) bs += 0.38; else ss += 0.38; }
    else if (sl >= 2) { if (sd) ss += 0.15; else bs += 0.15; }

    let alt = 0;
    for (let i = nums.length - 1; i > 0; i--) {
        if ((nums[i] <= 4) !== (nums[i-1] <= 4)) alt++;
        else break;
    }
    if (alt >= 3) { if (nums[nums.length-1] <= 4) ss += 0.28; else bs += 0.28; }

    if (sm5 >= 4) bs += 0.42;
    if (sm5 <= 1) ss += 0.42;
    if (sm3 === 3) bs += 0.22;
    if (sm3 === 0) ss += 0.22;

    let pred;
    if (level === 3) {
        pred = sm3 >= 2 ? "B" : "S";
        const sf = freq.slice(0,5).reduce((a,b)=>a+b,0);
        const bf = freq.slice(5,10).reduce((a,b)=>a+b,0);
        if (Math.abs(sf - bf) > 0.6) pred = bf > sf ? "B" : "S";
    } else if (level === 2) {
        if (st.consecutiveLoss >= 1 && st.hist.length > 0) {
            const lp = st.hist[st.hist.length - 1].pred || "S";
            pred = lp === "S" ? "B" : "S";
        } else pred = ss >= bs ? "S" : "B";
    } else pred = ss >= bs ? "S" : "B";

    const tgt = pred === "S" ? [0,1,2,3,4] : [5,6,7,8,9];
    const srt = [...tgt].sort((a,b) => freq[b] - freq[a]);
    const pri = srt[0];
    const sec = srt[1] !== undefined ? srt[1] : (pred === "S" ? 2 : 7);
    const thr = level === 3 ? (srt[2] !== undefined ? srt[2] : (pred === "S" ? 0 : 9)) : null;

    const diff = Math.abs(ss - bs);
    const bc = level === 3 ? 96 : (level === 2 ? 92 : 87);
    const sb = (st.streak || 0) >= 5 ? 2 : ((st.streak || 0) >= 3 ? 1 : 0);
    const conf = Math.min(99, Math.round(bc + diff * 6 + sb));
    const nums2 = thr === null ? [pri, sec] : [pri, sec, thr];
    const eng = level === 3 ? "JACKPOT-CONFIRM v10 💀" : (level === 2 ? "RECOVERY v10 🔥" : "MASTERMIND ULTRA v10");
    const pat = nums.slice(-9).map(n => n <= 4 ? "S" : "B").join("");
    return { prediction: pred, confidence: conf, numbers: nums2, primary: pri, pattern: pat, engine: eng };
}

// ============================================================
// PART 2 — DEEP PATTERN ANALYSIS ENGINE (20 signals)
// ============================================================
function part2AiAnalyze(results) {
    function extract(raw) {
        const out = [];
        for (const r of (raw || []).slice(0, 10)) {
            let v = r.number;
            if (v === null || v === undefined) {
                for (const f of ["result_number","num","value","result"]) {
                    v = r[f];
                    if (v !== null && v !== undefined) break;
                }
            }
            try {
                const n = parseInt(v);
                if (!isNaN(n) && 0 <= n && n <= 9) out.push(n);
            } catch(e) {}
        }
        return out;
    }
    const nums = extract(results);
    if (nums.length < 5) {
        return { prediction: "S", confidence: 60, numbers: [2,3], primary: 2, engine: "PART2-DEEP-10", pattern: "", big_count: 0, small_count: nums.length, pattern_score_big: 0, pattern_score_small: 0, patterns_triggered: 0, current_num: nums[0] || 0, signals: [] };
    }
    let score = 0.0; const hits = [];
    const current = nums[0];
    const sizes = nums.map(n => n >= 5 ? "B" : "S");

    let b = 0, s = 0;
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] === current) {
            const nxt = nums[i-1];
            if (nxt >= 5) b++; else s++;
        }
    }
    if (b + s) { score += ((b - s) / (b + s)) * 2.5; hits.push(`P1:${b}B/${s}S`); }

    const l3 = sizes.slice(0, 3), l5 = sizes.slice(0, 5);
    const b3 = l3.filter(x => x === "B").length, b5 = l5.filter(x => x === "B").length;
    if (l3.length === 3) {
        if (b3 === 3) { score -= 1.6; hits.push("P2:3B→S"); }
        else if (b3 === 0) { score += 1.6; hits.push("P2:3S→B"); }
        else if (b3 >= 2) { score -= 0.5; hits.push("P2:2/3B"); }
        else { score += 0.5; hits.push("P2:1/3B"); }
    }
    if (b5 >= 4) { score -= 1.3; hits.push("P3:4/5B→S"); }
    else if (b5 <= 1) { score += 1.3; hits.push("P3:1/5B→B"); }

    const altCount = sizes.slice(1).reduce((acc, v, i) => acc + (v !== sizes[i] ? 1 : 0), 0);
    if (altCount >= 7) {
        score += sizes[0] === "B" ? -1.5 : 1.5;
        hits.push("P4/P12:ALT");
    }

    const big = nums.filter(n => n >= 5).length;
    const small = nums.length - big;
    if (big >= 7) { score -= 0.8; hits.push("P6:B-heavy→S"); }
    else if (small >= 7) { score += 0.8; hits.push("P6:S-heavy→B"); }

    if (current === 8 || current === 9) { score += 0.4; hits.push("P7:HIGH"); }
    else if (current === 0 || current === 1) { score -= 0.4; hits.push("P7:LOW"); }

    const rev = sizes.slice(1).reduce((acc, v, i) => acc + (v !== sizes[i] ? 1 : 0), 0);
    const revRate = rev / Math.max(1, sizes.length - 1);
    if (revRate >= 0.65) { score += sizes[0] === "B" ? 0.8 : -0.8; hits.push("P8:HIGH-REV"); }
    else if (revRate <= 0.35) { score += sizes[0] === "B" ? -0.5 : 0.5; hits.push("P8:LOW-REV"); }

    if (nums.slice(1, 6).filter(n => n === current).length >= 2) {
        score += b > s ? 0.7 : -0.7; hits.push("P9:REPEAT");
    }

    let streak = 1;
    while (streak < sizes.length && sizes[streak] === sizes[0]) streak++;
    if (streak >= 3) {
        score += sizes[0] === "S" ? 1.2 : -1.2;
        hits.push(`P10/P11:STREAK${streak}`);
    }

    if (sizes.length >= 3 && sizes[1] === sizes[2]) {
        score += sizes[1] === "S" ? 0.6 : -0.6;
        hits.push("P13:PAIR");
    }

    let evenBig = 0, oddSmall = 0;
    for (let i = 1; i < nums.length; i++) {
        if (nums[i] === current) {
            const nxt = nums[i-1];
            if (nxt % 2 === 0 && nxt >= 5) evenBig++;
            if (nxt % 2 === 1 && nxt <= 4) oddSmall++;
        }
    }
    if (evenBig > oddSmall) { score += 0.3; hits.push("P16:EVEN→B"); }
    else if (oddSmall > evenBig) { score -= 0.3; hits.push("P16:ODD→S"); }

    const weighted = nums.reduce((acc, n, i) => acc + (Math.pow(0.9, i) * (n >= 5 ? 1 : -1)), 0);
    score += weighted * 0.06;

    if (sizes.length >= 5) {
        let pre = sizes[1], preLen = 1;
        while (preLen + 1 < sizes.length && sizes[preLen + 1] === pre) preLen++;
        if (sizes[0] !== pre && preLen >= 3) {
            score += sizes[0] === "B" ? -0.5 : 0.5;
            hits.push("P18:BREAK");
        }
    }

    if (current === 0 || current === 1) { score -= 0.7; hits.push("P19:EXTREME-LOW"); }
    else if (current === 8 || current === 9) { score += 0.7; hits.push("P19:EXTREME-HIGH"); }

    if (sizes.length >= 4) {
        const sig = sizes.slice(0, 3).join("");
        let nb = 0, ns = 0;
        for (let i = 1; i < sizes.length - 2; i++) {
            if (sizes.slice(i, i + 3).join("") === sig) {
                if (sizes[i-1] === "B") nb++; else ns++;
            }
        }
        if (nb + ns) {
            score += ((nb - ns) / (nb + ns)) * 1.0;
            hits.push(`P20:${sig}`);
        }
    }

    const predB = score > 0;
    const pred = predB ? "B" : "S";
    const confidence = Math.min(95, Math.max(60, Math.round(68 + Math.abs(score) * 4 + Math.min(8, hits.length * 0.5))));
    const target = predB ? [5,6,7,8,9] : [0,1,2,3,4];
    const freqMap = {};
    target.forEach(n => freqMap[n] = nums.filter(x => x === n).length);
    const top = [...target].sort((a, b) => (freqMap[b] - freqMap[a]) || (b - a));
    return {
        prediction: pred, confidence, numbers: [top[0], top[1]], primary: top[0],
        engine: "PART2-DEEP-10", pattern: sizes.slice(0, 9).join(""),
        big_count: big, small_count: small,
        pattern_score_big: Math.round(Math.max(score, 0) * 100) / 100,
        pattern_score_small: Math.round(Math.max(-score, 0) * 100) / 100,
        patterns_triggered: hits.length, current_num: current,
        big_examples: [], small_examples: [], signals: hits
    };
}

// ============================================================
// PART 3 — HYBRID SCORING ENGINE (8 modules, BIG/SMALL only)
// ============================================================
class TrendAnalyzer { analyze(nums) {
    if (nums.length < 5) return { score: 50, predicted_number: null };
    const n = nums.length; const sx = (n-1)*n/2; const sy = nums.reduce((a,b)=>a+b,0);
    let sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sxy += i * nums[i]; sxx += i*i; }
    const d = (n * sxx - sx * sx);
    const slope = (n * sxy - sx * sy) / Math.max(1, d);
    const nxt = Math.max(0, Math.min(9, Math.round(sy / n + slope * n)));
    return { score: Math.min(100, Math.round(50 + Math.abs(slope) * 25)), predicted_number: nxt };
}}
class PatternRecognizer { analyze(nums) {
    const w = 4;
    if (nums.length < w * 2) return { score: 45, predicted_number: null, matches: 0 };
    const tail = nums.slice(0, w); const matches = [];
    for (let i = w; i < nums.length - w; i++) {
        if (nums.slice(i, i + w).every((v, idx) => v === tail[idx])) matches.push(nums[i - 1]);
    }
    if (!matches.length) return { score: 45, predicted_number: null, matches: 0 };
    const freq = {}; matches.forEach(m => freq[m] = (freq[m] || 0) + 1);
    let best = matches[0], bc = 0;
    Object.keys(freq).forEach(k => { if (freq[k] > bc) { bc = freq[k]; best = Number(k); } });
    return { score: Math.min(95, 50 + matches.length * 8), predicted_number: best, matches: matches.length };
}}
class FrequencyAnalyzer { analyze(nums) {
    const ns = nums.slice(0, 30); const freq = {}; ns.forEach(n => freq[n] = (freq[n] || 0) + 1);
    const total = ns.length; if (!total) return { score: 50, predicted_number: 5 };
    let hot = 0, hp = 0;
    Object.keys(freq).forEach(k => { if (freq[k] > hp) { hp = freq[k]; hot = Number(k); } });
    const hotPct = hp / total * 100;
    return { score: Math.min(95, Math.round(50 + (hotPct - 10) * 3)), predicted_number: hot };
}}
class HotColdAnalyzer { analyze(nums) {
    const recent = nums.slice(0, 15), older = nums.slice(15, 50);
    const rf = {}, of = {};
    recent.forEach(n => rf[n] = (rf[n] || 0) + 1);
    older.forEach(n => of[n] = (of[n] || 0) + 1);
    const delta = {};
    for (let i = 0; i < 10; i++) delta[i] = ((rf[i]||0)/Math.max(recent.length,1)) - ((of[i]||0)/Math.max(older.length,1));
    let hot = 0, hv = -Infinity;
    for (let i = 0; i < 10; i++) if (delta[i] > hv) { hv = delta[i]; hot = i; }
    return { score: Math.min(90, Math.round(55 + hv * 80)), predicted_number: hot };
}}
class BigSmallAnalyzer { analyze(nums) {
    const ns = nums.slice(0, 20); const big = ns.filter(x => x >= 5).length; const total = ns.length;
    const bp = total ? big / total * 100 : 50; const sp = 100 - bp;
    let pred;
    if (bp >= 60) pred = "Small";
    else if (sp >= 60) pred = "Big";
    else pred = big >= total - big ? "Small" : "Big";
    return { score: Math.min(90, Math.round(50 + Math.abs(bp - 50) * 0.8)), predicted_size: pred, big_pct: Math.round(bp*10)/10, small_pct: Math.round(sp*10)/10 };
}}
class StreakDetector { analyze(nums) {
    if (!nums.length) return { score: 50, predicted_number: null, streak_length: 0 };
    const cur = nums[0]; let streak = 1;
    for (let i = 1; i < nums.length; i++) { if (nums[i] === cur) streak++; else break; }
    if (streak >= 3) {
        const alt = cur < 9 ? cur + 1 : cur - 1;
        return { score: Math.min(88, 55 + streak * 5), predicted_number: alt, streak_length: streak };
    }
    return { score: 50, predicted_number: null, streak_length: streak };
}}
class ReversalDetector { analyze(nums) {
    if (nums.length < 5) return { score: 50, predicted_number: null };
    const ns = nums.slice(0, 10); let zz = 0;
    for (let i = 1; i < ns.length - 1; i++) {
        if ((ns[i] > ns[i-1] && ns[i] > ns[i+1]) || (ns[i] < ns[i-1] && ns[i] < ns[i+1])) zz++;
    }
    const ratio = zz / (ns.length - 2);
    const direction = ns[0] > ns[1] ? "down" : "up";
    const predicted = direction === "down" ? Math.min(9, ns[0] + 2) : Math.max(0, ns[0] - 2);
    return { score: Math.min(85, Math.round(45 + ratio * 50)), predicted_number: predicted };
}}
class MomentumAnalyzer { analyze(nums) {
    if (nums.length < 4) return { score: 50, predicted_number: null };
    const recent = nums.slice(0, 5), prev = nums.slice(5, 10);
    const ra = recent.reduce((a,b)=>a+b,0) / recent.length;
    const pa = prev.length ? prev.reduce((a,b)=>a+b,0) / prev.length : ra;
    const mom = ra - pa;
    const nxt = Math.max(0, Math.min(9, Math.round(ra + mom * 0.5)));
    return { score: Math.min(88, Math.round(50 + Math.abs(mom) * 8)), predicted_number: nxt, momentum: Math.round(mom * 1000) / 1000 };
}}
const HYBRID_WEIGHTS = { trend: 18, pattern: 16, frequency: 12, hot_cold: 10, big_small: 10, streak: 8, reversal: 8, momentum: 8 };

function part3HybridAnalyze(results) {
    const fallback = { prediction: "B", confidence: 75, numbers: [6,7], primary: 6, engine: "PART3-HYBRID v1 🤖", pattern: "", big_pct: 50.0, small_pct: 50.0, signal: "WEAK", patterns_hit: "Statistical Prob", composite: 50 };
    if (!results || results.length < 10) return fallback;
    const nums = [];
    for (const r of results.slice(0, 10)) {
        let v = r.number;
        if (v === null || v === undefined) for (const f of ["result_number","num","value"]) { v = r[f]; if (v !== null && v !== undefined) break; }
        if (v !== null && v !== undefined) {
            try { const n = parseInt(v); if (!isNaN(n) && 0 <= n && n <= 9) nums.push(n); } catch(e) {}
        }
    }
    if (nums.length < 10) return fallback;
    const modules = {
        trend: new TrendAnalyzer(), pattern: new PatternRecognizer(),
        frequency: new FrequencyAnalyzer(), hot_cold: new HotColdAnalyzer(),
        big_small: new BigSmallAnalyzer(), streak: new StreakDetector(),
        reversal: new ReversalDetector(), momentum: new MomentumAnalyzer()
    };
    const moduleResults = {};
    for (const [name, mod] of Object.entries(modules)) {
        try { moduleResults[name] = mod.analyze(nums); }
        catch (e) { console.warn("[PART3-HYBRID]", name, e.message); moduleResults[name] = { score: 50, predicted_number: null }; }
    }
    const totalWeight = Object.values(HYBRID_WEIGHTS).reduce((a,b)=>a+b,0);
    const numberVotes = new Array(10).fill(0.0);
    let composite = 0.0;
    for (const [name, r] of Object.entries(moduleResults)) {
        const w = HYBRID_WEIGHTS[name] || 5;
        const s = Number(r.score || 50);
        composite += s * w;
        const num = r.predicted_number;
        if (num !== null && num !== undefined && 0 <= num && num <= 9) numberVotes[num] += w * (s / 100);
    }
    composite /= totalWeight;
    let predictedNumber = 0, pv = -1;
    for (let i = 0; i < 10; i++) if (numberVotes[i] > pv) { pv = numberVotes[i]; predictedNumber = i; }
    const bsResult = moduleResults.big_small || {};
    const predictedSize = bsResult.predicted_size || (predictedNumber >= 5 ? "Big" : "Small");
    const predBS = predictedSize === "Big" ? "B" : "S";
    const sideNums = predBS === "B" ? [5,6,7,8,9] : [0,1,2,3,4];
    const sideSorted = [...sideNums].sort((a,b) => numberVotes[b] - numberVotes[a]);
    const primary = sideSorted[0], second = sideSorted[1] !== undefined ? sideSorted[1] : primary;
    const confidence = Math.max(50, Math.min(99, Math.round(composite)));
    let signal;
    if (confidence >= 85) signal = "ULTRA STRONG";
    else if (confidence >= 75) signal = "STRONG";
    else if (confidence >= 65) signal = "MODERATE";
    else if (confidence >= 55) signal = "WEAK";
    else signal = "VERY WEAK";
    const patternsHit = [];
    if ((moduleResults.pattern || {}).matches > 0) patternsHit.push(`Pattern×${moduleResults.pattern.matches}`);
    if ((moduleResults.streak || {}).streak_length >= 3) patternsHit.push("Streak");
    if ((moduleResults.momentum || {}).momentum && Math.abs(moduleResults.momentum.momentum) > 1) patternsHit.push("Momentum");
    const pattern = nums.slice(0, 9).map(n => n <= 4 ? "S" : "B").join("");
    return {
        prediction: predBS, confidence, numbers: [primary, second], primary,
        engine: "PART3-HYBRID v1 🤖", pattern,
        big_pct: bsResult.big_pct || 50.0, small_pct: bsResult.small_pct || 50.0,
        signal, patterns_hit: patternsHit.length ? patternsHit.join(" | ") : "Statistical Prob",
        composite: Math.round(composite * 100) / 100
    };
}

// ============================================================
// PART 4 — ENSEMBLE AI ENGINE (Markov + Weighted + Simple)
// ============================================================
const MAX_MARKOV_ORDER = 4, LOOKBACK4 = 30;

function p4UpdateLearning(st, nums) {
    const sizes = nums.map(n => n <= 4 ? "SMALL" : "BIG");
    const digits = nums.map(n => String(n));
    for (let i = 0; i < digits.length; i++) {
        const d = digits[i], s = sizes[i];
        if (!st.p4DigitStats[d]) st.p4DigitStats[d] = { BIG: 0, SMALL: 0 };
        st.p4DigitStats[d][s]++;
    }
    for (let order = 2; order <= MAX_MARKOV_ORDER; order++) {
        if (sizes.length < order + 1) continue;
        for (let i = 0; i < sizes.length - order; i++) {
            const key = sizes.slice(i, i + order).join("");
            const nxt = sizes[i + order];
            if (!st.p4Markov[key]) st.p4Markov[key] = {};
            if (!st.p4Markov[key][nxt]) st.p4Markov[key][nxt] = { BIG: 0, SMALL: 0 };
            st.p4Markov[key][nxt][nxt]++;
        }
    }
}
function p4WeightedAnalysis(nums) {
    const recent = nums.slice(0, LOOKBACK4);
    const sizes = recent.map(n => n <= 4 ? "SMALL" : "BIG");
    const scores = { BIG: 0.0, SMALL: 0.0 };
    const totalW = (sizes.length * (sizes.length + 1)) / 2;
    const rev = [...sizes].reverse();
    for (let i = 0; i < rev.length; i++) scores[rev[i]] += ((i + 1) / totalW) * 100;
    if (sizes.length >= 3) {
        let streak = 1;
        for (let i = 1; i < sizes.length; i++) { if (sizes[i] === sizes[i-1]) streak++; else break; }
        if (streak >= 3) {
            const opp = sizes[0] === "BIG" ? "SMALL" : "BIG";
            scores[opp] += 20;
        }
    }
    const alts = sizes.slice(1).reduce((acc, v, i) => acc + (v !== sizes[i] ? 1 : 0), 0);
    if (alts >= sizes.length * 0.7) {
        const expected = sizes[0] === "BIG" ? "SMALL" : "BIG";
        scores[expected] += 15;
    }
    const count = {};
    nums.slice(0, LOOKBACK4).forEach(n => count[n] = (count[n] || 0) + 1);
    const sorted = Object.keys(count).map(k => ({ n: Number(k), c: count[k] })).sort((a,b)=>b.c - a.c).slice(0, 4);
    const hotBig = sorted.filter(d => d.n >= 5).length;
    if (hotBig >= 3) scores["BIG"] += 12;
    else if (hotBig <= 1) scores["SMALL"] += 12;
    return scores;
}
function p4MarkovPredict(st, sizes) {
    let bestPred = null, bestConf = 0;
    for (let order = MAX_MARKOV_ORDER; order >= 2; order--) {
        if (sizes.length < order) continue;
        const key = sizes.slice(0, order).join("");
        const stats = st.p4Markov[key] || {};
        let total = 0;
        for (const v of Object.values(stats)) total += (v.BIG || 0) + (v.SMALL || 0);
        if (total < 4) continue;
        let bigT = 0, smallT = 0;
        for (const v of Object.values(stats)) { bigT += v.BIG || 0; smallT += v.SMALL || 0; }
        const pred = bigT > smallT ? "BIG" : "SMALL";
        const conf = Math.max(bigT, smallT) / total * 100;
        if (conf > bestConf) { bestConf = conf; bestPred = pred; }
    }
    return { pred: bestPred, conf: Math.round(bestConf) };
}
function p4SimplePredict(nums) {
    const recent = nums.slice(0, 20);
    const bigCount = recent.filter(n => n >= 5).length;
    const smallC = recent.length - bigCount;
    const pred = bigCount > smallC ? "SMALL" : "BIG";
    const conf = 60 + Math.abs(bigCount - smallC) * 3;
    return { pred, conf: Math.min(90, conf) };
}
function part4EnsembleAnalyze(results, st) {
    const fallback = { prediction: "S", confidence: 70, numbers: [2,3], primary: 2, engine: "PART4-ENSEMBLE v1 🎯", pattern: "", big_pct: 50.0, small_pct: 50.0 };
    if (!results || results.length < 10) return fallback;
    const nums = [];
    for (const r of results.slice(0, 10)) {
        let v = r.number;
        if (v === null || v === undefined) for (const f of ["result_number","num","value"]) { v = r[f]; if (v !== null && v !== undefined) break; }
        if (v !== null && v !== undefined) {
            try { const n = parseInt(v); if (!isNaN(n) && 0 <= n && n <= 9) nums.push(n); } catch(e) {}
        }
    }
    if (nums.length < 10) return fallback;
    p4UpdateLearning(st, nums);
    const sizes = nums.map(n => n <= 4 ? "SMALL" : "BIG");
    const votes = { BIG: 0.0, SMALL: 0.0 };
    const wScores = p4WeightedAnalysis(nums);
    const wWinner = wScores.BIG >= wScores.SMALL ? "BIG" : "SMALL";
    votes[wWinner] += Math.max(wScores.BIG, wScores.SMALL);
    const { pred: mp, conf: mc } = p4MarkovPredict(st, sizes);
    if (mp) votes[mp] += mc * 1.2;
    const sp = p4SimplePredict(nums);
    votes[sp.pred] += sp.conf * 0.6;
    const finalPredStr = votes.BIG >= votes.SMALL ? "BIG" : "SMALL";
    const predBS = finalPredStr === "BIG" ? "B" : "S";
    const rawConf = Math.min(95, Math.round(votes[finalPredStr] * 0.9));
    const confidence = Math.max(65, rawConf);
    const sideNums = predBS === "B" ? [5,6,7,8,9] : [0,1,2,3,4];
    const numFreq = {};
    nums.slice(0, 30).forEach(n => numFreq[n] = (numFreq[n] || 0) + 1);
    const sideSorted = [...sideNums].sort((a,b) => (numFreq[b] || 0) - (numFreq[a] || 0));
    const primary = sideSorted[0], second = sideSorted[1] !== undefined ? sideSorted[1] : primary;
    const recent10 = nums.slice(0, 10);
    const bigC = recent10.filter(n => n >= 5).length;
    const smallC = recent10.length - bigC;
    const bigPct = Math.round(bigC / Math.max(recent10.length, 1) * 1000) / 10;
    const smallPct = Math.round((100 - bigPct) * 10) / 10;
    const pattern = nums.slice(0, 9).map(n => n <= 4 ? "S" : "B").join("");
    return { prediction: predBS, confidence, numbers: [primary, second], primary, engine: "PART4-ENSEMBLE v1 🎯", pattern, big_pct: bigPct, small_pct: smallPct };
}

// ============================================================
// PART 5 / PART 6 / PART 7 — SHORT ENGINES
// ============================================================
const PART5_RULES = { 1: "SAME", 2: "SAME", 3: "SAME", 4: "SAME", 5: "OPPOSITE", 6: "SAME", 7: "OPPOSITE", 8: "SAME", 9: "SAME", 10: "SAME", 11: "SAME", 12: "OPPOSITE", 13: "SAME", 14: "OPPOSITE" };
const PART6_MAP = { 0: "S", 1: "B", 2: "S", 3: "S", 4: "B", 5: "S", 6: "B", 7: "S", 8: "B", 9: "S" };

function part5LevelPredict(results, level) {
    const nums = [];
    for (const r of (results || []).slice(0, 10)) {
        const v = r.number;
        if (v !== null && v !== undefined && /^\d+$/.test(String(v))) {
            const n = parseInt(v);
            if (0 <= n && n <= 9) nums.push(n);
        }
    }
    const latest = nums[0] || 0;
    const base = isSmallJ(latest) ? "S" : "B";
    const safeLevel = Math.max(1, Math.min(14, Number(level) || 1));
    const rule = PART5_RULES[safeLevel] || "SAME";
    const pred = rule === "SAME" ? base : (base === "S" ? "B" : "S");
    const nums2 = pred === "B" ? [5,6] : [0,1];
    return { prediction: pred, confidence: 75, numbers: nums2, primary: pred === "B" ? 5 : 0, engine: "PART5-LEVEL", level: safeLevel, rule, latest_num: latest };
}
function part6Analyze(results) {
    const nums = [];
    for (const r of (results || []).slice(0, 10)) {
        const v = r.number;
        if (v !== null && v !== undefined && /^\d+$/.test(String(v))) {
            const n = parseInt(v);
            if (0 <= n && n <= 9) nums.push(n);
        }
    }
    const latest = nums[0] || 0;
    const pred = PART6_MAP[latest];
    return { prediction: pred, confidence: 75, numbers: pred === "B" ? [5,6] : [0,1], primary: pred === "B" ? 5 : 0, engine: "PART6-CUSTOM-MAP", latest_num: latest };
}
function part7Analyze(results) {
    const nums = [];
    for (const r of (results || []).slice(0, 10)) {
        const v = r.number;
        if (v !== null && v !== undefined && /^\d+$/.test(String(v))) {
            const n = parseInt(v);
            if (0 <= n && n <= 9) nums.push(n);
        }
    }
    const last5 = nums.slice(0, 5);
    const big = last5.filter(n => n >= 5).length;
    const small = last5.length - big;
    const pred = big >= small ? "B" : "S";
    return { prediction: pred, confidence: last5.length === 5 ? 80 : 70, numbers: pred === "B" ? [5,6] : [0,1], primary: pred === "B" ? 5 : 0, engine: "PART7-LAST5-MAJORITY", last5, big_count: big, small_count: small };
}

// ============================================================
// PART 8 — ERROR BOT V8 WALK-FORWARD ENGINE
// ============================================================
function p8Num(r) {
    if (typeof r !== 'object' || !r) return null;
    for (const k of ["number", "result_number", "num", "value"]) {
        const v = r[k];
        if (v !== null && v !== undefined) {
            try { const n = parseInt(v); if (!isNaN(n) && 0 <= n && n <= 9) return n; } catch(e) {}
        }
    }
    return null;
}
function p8History(hist) {
    const out = [];
    for (const r of (hist || []).slice(0, 10)) {
        const n = p8Num(r);
        if (n !== null) out.push(n >= 5 ? "BIG" : "SMALL");
    }
    return out;
}
function p8Clamp(x, a = -1.0, b = 1.0) { return Math.max(a, Math.min(b, Number(x))); }
function p8Signed(b, s) {
    const t = Math.abs(b) + Math.abs(s);
    return t ? (b - s) / t : 0.0;
}
function p8Entropy(h) {
    if (!h.length) return 1.0;
    const b = h.filter(x => x === "BIG").length / h.length;
    const sm = 1 - b;
    const log2 = Math.log2;
    return (-(b * (b ? log2(b) : 0))) + (-(sm * (sm ? log2(sm) : 0)));
}
function p8Run(h) {
    if (!h.length) return { side: null, len: 0 };
    let n = 1;
    while (n < h.length && h[n] === h[0]) n++;
    return { side: h[0], len: n };
}
function p8Balance(h, n) {
    const a = h.slice(0, n);
    const b = a.filter(x => x === "BIG").length;
    const s = a.length - b;
    return a.length ? p8Signed(b, s) : 0.0;
}
function p8Context(h, order) {
    if (h.length <= order + 1) return { score: 0.0, b: 0, s: 0, count: 0 };
    const key = h.slice(0, order).join("|");
    let b = 0, s = 0, c = 0;
    for (let i = order; i < h.length; i++) {
        if (h.slice(i - order, i).join("|") !== key) continue;
        const nxt = h[i - 1];
        if (nxt === "BIG") b++; else s++;
        c++;
    }
    return { score: p8Signed(b, s), b, s, count: c };
}
function p8WalkForward(h, order, minTrain = 18) {
    if (h.length < minTrain + order + 3) return { acc: 0.5, samples: 0, edge: 0.0 };
    let correct = 0, samples = 0;
    for (let t = minTrain; t < h.length - order - 1; t++) {
        const train = h.slice(t);
        const key = h.slice(t - order, t).join("|");
        let b = 0, s = 0;
        for (let i = order; i < train.length; i++) {
            if (train.slice(i - order, i).join("|") !== key) continue;
            if (train[i - 1] === "BIG") b++; else s++;
        }
        if (b + s < 2) continue;
        const pred = b >= s ? "BIG" : "SMALL";
        const actual = h[t - 1];
        if (pred === actual) correct++;
        samples++;
    }
    const acc = samples ? correct / samples : 0.5;
    return { acc, samples, edge: p8Clamp((acc - 0.5) * 2) };
}
function p8Backoff(h) {
    let score = 0.0, totalW = 0.0, support = 0.0; const rows = [];
    for (let order = 1; order <= 8; order++) {
        const c = p8Context(h, order);
        if (c.count < 2) continue;
        const wf = p8WalkForward(h, order, 18);
        const supportW = Math.min(1.0, c.count / 8);
        const validationW = 0.55 + 0.45 * Math.max(0.0, wf.edge);
        const orderW = 0.45 + 0.55 * (order / 8);
        const w = supportW * validationW * orderW;
        score += c.score * w; totalW += w; support += c.count * w;
        rows.push({ order, count: c.count, score: c.score, wf: wf.acc, samples: wf.samples });
    }
    return { score: totalW ? score / totalW : 0.0, support, rows };
}
function p8PatternNext(row) {
    for (const k of ["next", "nextOutcome", "next_outcome", "result", "outcome", "prediction"]) {
        const v = row[k];
        if (typeof v === 'string') {
            const up = v.toUpperCase();
            if (up === "BIG" || up === "SMALL") return up;
        }
    }
    return null;
}
function p8PatternKey(pattern) {
    return pattern.map(x => String(x).toUpperCase()).join("|");
}
function p8Reliability(row) {
    try {
        let r = Number(row.reliability !== undefined ? row.reliability : (row.accuracy || 0));
        if (r > 1) r /= 100;
        return p8Clamp(r, 0, 1);
    } catch(e) { return 0.0; }
}
function p8PatternDatabase(h, st) {
    let b = 0, s = 0, e = 0, best = 0.0; const names = [];
    for (const length of [3,4,5,6,7,8,10]) {
        if (h.length < length) continue;
        const key = p8PatternKey(h.slice(0, length));
        let lb = 0.0, ls = 0.0; let local = 0;
        for (const row of (st.p8PatternDB || [])) {
            const pattern = row.pattern;
            if (!Array.isArray(pattern) || pattern.length < length) continue;
            if (p8PatternKey(pattern.slice(0, length)) !== key) continue;
            const nxt = p8PatternNext(row);
            if (!nxt) continue;
            const rel = p8Reliability(row);
            let total;
            try { total = Number(row.wins || 0) + Number(row.losses || 0); } catch(e) { total = 0; }
            const sampleQuality = total >= 5 ? Math.min(1.0, total / 20) : 0.35;
            const w = (0.15 + 0.85 * rel) * sampleQuality * (0.55 + length / 20);
            if (nxt === "BIG") lb += w; else ls += w;
            local++;
            if (names.length < 8) names.push(`${row.id || '?'}:${nxt}@${length}`);
        }
        if (local) {
            b += Math.min(3, lb); s += Math.min(3, ls); e += Math.min(6, lb + ls);
            best = Math.max(best, Math.abs(p8Signed(lb, ls)));
        }
    }
    return { score: p8Signed(b, s), evidence: e, b, s, best, names };
}
function p8Motif(h) {
    let b = 0, s = 0, e = 0;
    for (const length of [2,3,4]) {
        if (h.length < length + 2) continue;
        const key = h.slice(0, length);
        for (let i = length; i < h.length; i++) {
            const slice = h.slice(i - length, i);
            if (slice.length !== key.length) continue;
            if (!slice.every((v, idx) => v === key[idx])) continue;
            const nxt = h[i - 1];
            if (nxt === "BIG") b++; else s++;
            e++;
        }
    }
    return { score: e ? p8Signed(b, s) : 0.0, evidence: e };
}
function p8RunModel(h) {
    const r = p8Run(h);
    if (!r.len) return { score: 0.0, evidence: 0 };
    let b = 0, s = 0, e = 0; let i = 1;
    while (i < h.length - 1) {
        let length = 1;
        while (i + length < h.length && h[i + length] === h[i]) length++;
        if (length === r.len) {
            if (h[i - 1] === "BIG") b++; else s++;
            e++;
        }
        i += Math.max(1, length);
    }
    return { score: e ? p8Signed(b, s) : 0.0, evidence: e };
}
function p8Regime(h) {
    const sh = p8Balance(h, 6), md = p8Balance(h, 12), lg = p8Balance(h, 24);
    const run = p8Run(h); const ent = p8Entropy(h.slice(0, 20));
    let regime = "MIXED";
    if (run.len >= 4) regime = "RUN";
    else if (Math.abs(sh) >= 0.55 && (sh === 0 || md === 0 || (sh > 0) === (md > 0))) regime = "MOMENTUM";
    else if (Math.abs(lg) >= 0.28 && (sh > 0) !== (lg > 0)) regime = "ROTATION";
    else if (ent > 0.97) regime = "HIGH_ENTROPY";
    return { short: sh, med: md, long: lg, run, entropy: ent, regime };
}
function part8Analyze(results, st) {
    const h = p8History(results);
    if (!h.length) return { prediction: "S", confidence: 51, numbers: [0,1], primary: 0, engine: "PART8-V8-WALK-FORWARD", pattern: "NO DATA", regime: "MIXED", support: 0 };
    const mk = p8Backoff(h), db = p8PatternDatabase(h, st), motif = p8Motif(h), run = p8RunModel(h), reg = p8Regime(h);
    let score = mk.score*0.50 + db.score*0.14 + motif.score*0.10 + run.score*0.08 + reg.short*0.08 + reg.med*0.06 + reg.long*0.04;
    if (reg.regime === "HIGH_ENTROPY") score *= 0.72;
    const signals = [mk.score, db.score, motif.score, run.score, reg.short, reg.med, reg.long].filter(x => Math.abs(x) > 0.08);
    const agreement = signals.length ? signals.filter(x => (x >= 0) === (score >= 0)).length / signals.length : 0.5;
    const support = mk.rows.reduce((a, r) => a + r.count, 0) + db.evidence + motif.evidence + run.evidence;
    const margin = Math.min(1.0, Math.abs(score));
    const strongest = mk.rows.length ? [...mk.rows].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0] : null;
    let side;
    if (Math.abs(score) < 0.06 || support < 3) {
        side = (strongest && Math.abs(strongest.score) >= 0.12 && strongest.score >= 0) || (!strongest && reg.short >= 0) ? "BIG" : "SMALL";
    } else side = score >= 0 ? "BIG" : "SMALL";
    let confidence = Math.round(50 + margin*20 + agreement*10 + Math.min(1.0, support/24)*12);
    if (reg.regime === "HIGH_ENTROPY") confidence -= 8;
    if (Math.abs(score) < 0.10) confidence -= 5;
    confidence = Math.max(51, Math.min(86, confidence));
    const nums = side === "BIG" ? [5,6,7,8,9] : [0,1,2,3,4];
    const primary = nums[2], second = nums[1];
    const parts = [strongest ? `CTX-${strongest.order}` : "BACKOFF", "WALK-FWD", reg.regime];
    if (db.best >= 0.65) parts.push("DB-VALIDATED");
    if (reg.run.len >= 3) parts.push("RUN-CHECK");
    return {
        prediction: side === "BIG" ? "B" : "S", confidence, numbers: [primary, second], primary,
        engine: "PART8-V8-WALK-FORWARD", pattern: parts.join(" • "),
        regime: reg.regime, entropy: reg.entropy, support,
        context_score: mk.score, db_score: db.score, motif_score: motif.score,
        run_score: run.score, agreement,
        strongest_order: strongest ? strongest.order : 0,
        walk_forward: strongest ? strongest.wf : 0.5,
        pattern_votes: db.names.length, patterns: db.names.length ? db.names : ["LIVE CONTEXT"]
    };
}

// ============================================================
// PART 9 — 10×10 DETERMINISTIC LOOKUP TABLE
// ============================================================
const PART9_RULE = [
    ["SKIP","SKIP","SMALL 1","SMALL 2","SMALL 3","SMALL 4","BIGBIG 5","BIGBIG 6","BIGBIG 7","BIGBIG 8"],
    [null,"SKIP","SKIP","SMALL 1","SMALL 2","SMALL 3","SMALL 4","BIGBIG 5","BIGBIG 6","BIGBIG 7"],
    ["BIGBIG 6","SKIP","SKIP","SKIP","SMALL 1","SMALL 2","SMALL 3","SMALL 4","BIGBIG 5","BIGBIG 6"],
    ["BIGBIG 7","BIGBIG 8","SKIP","SKIP","SKIP","SMALL 1","SMALL 2","SMALL 3","SMALL 4","BIGBIG 5"],
    ["BIGBIG 8","BIGBIG 7","BIGBIG 6","SKIP","SKIP","SKIP","SMALL 1","SMALL 2","SMALL 3","SMALL 4"],
    ["BIGBIG 9","BIGBIG 8","BIGBIG 7","BIGBIG 6","SKIP","SKIP","SKIP","SMALL 1","SMALL 2","SMALL 3"],
    ["SMALL 0","BIGBIG 9","BIGBIG 8","BIGBIG 7","BIGBIG 6","SKIP","SKIP","SKIP","SMALL 1","SMALL 2"],
    ["SMALL 1","SMALL 0","BIGBIG 9","BIGBIG 8","BIGBIG 7","BIGBIG 6","SKIP","SKIP","SKIP","SMALL 1"],
    ["SMALL 2","SMALL 1","SMALL 0","BIGBIG 9","BIGBIG 8","BIGBIG 7","BIGBIG 6","SKIP","SKIP","SKIP"],
    ["SMALL 3","SMALL 2","SMALL 1","SMALL 0","BIGBIG 9","BIGBIG 8","BIGBIG 7","BIGBIG 6","SKIP","SKIP"]
];
function part9DeterministicAnalyze(results) {
    if (!results || results.length < 2) {
        return { prediction: "S", confidence: 50, numbers: [2,3], primary: 2, engine: "PART9-LOOKUP-TABLE 🎰", pattern: "INSUFFICIENT DATA", rule: "SKIP", level: 0 };
    }
    let lastResult, prevResult;
    try {
        lastResult = parseInt(results[0].number || results[0].result_number || 0);
        prevResult = parseInt(results[1].number || results[1].result_number || 0);
    } catch(e) {
        return { prediction: "S", confidence: 50, numbers: [2,3], primary: 2, engine: "PART9-LOOKUP-TABLE 🎰", pattern: "EXTRACTION ERROR", rule: "SKIP", level: 0 };
    }
    lastResult = Math.max(0, Math.min(9, lastResult));
    prevResult = Math.max(0, Math.min(9, prevResult));
    let rule = PART9_RULE[prevResult][lastResult];
    if (rule === null || rule === undefined) rule = "SKIP";
    if (rule === "SKIP") {
        return { prediction: "S", confidence: 40, numbers: [2,3], primary: 2, engine: "PART9-LOOKUP-TABLE 🎰", pattern: `SKIP (P:${prevResult} L:${lastResult})`, rule: "SKIP", level: 0 };
    }
    const parts = rule.split(" ");
    if (parts.length < 2) {
        return { prediction: "S", confidence: 50, numbers: [2,3], primary: 2, engine: "PART9-LOOKUP-TABLE 🎰", pattern: "PARSE ERROR", rule: "SKIP", level: 0 };
    }
    const predType = parts[0];
    let confidenceLevel = parseInt(parts[1]);
    if (isNaN(confidenceLevel)) confidenceLevel = 5;
    let prediction, confidence, numbers;
    if (predType === "SMALL") {
        prediction = "S"; confidence = Math.min(99, 70 + confidenceLevel * 5); numbers = [2,3];
    } else if (predType === "BIGBIG") {
        prediction = "B"; confidence = Math.min(99, 70 + confidenceLevel * 5); numbers = [7,8];
    } else {
        return { prediction: "S", confidence: 50, numbers: [2,3], primary: 2, engine: "PART9-LOOKUP-TABLE 🎰", pattern: "UNKNOWN TYPE", rule: "SKIP", level: 0 };
    }
    return { prediction, confidence, numbers, primary: numbers[0], engine: "PART9-LOOKUP-TABLE 🎰", pattern: `Rule[${prevResult}][${lastResult}]=${rule}`, rule, level: confidenceLevel, prev_result: prevResult, last_result: lastResult };
}

// ============================================================
// PART DISPATCHER & WIN CHECK
// ============================================================
function generatePartPrediction(part, results, st) {
    if (part === 1) {
        const buf = [];
        for (const r of (results || []).slice(0, 9)) buf.unshift(parseInt(r.number || 0) || 0);
        return masterAiV10(buf, st.level, st);
    }
    if (part === 2) return part2AiAnalyze(results);
    if (part === 3) return part3HybridAnalyze(results);
    if (part === 4) return part4EnsembleAnalyze(results, st);
    if (part === 5) return part5LevelPredict(results, st.part5Level);
    if (part === 6) return part6Analyze(results);
    if (part === 7) return part7Analyze(results);
    if (part === 8) return part8Analyze(results, st);
    if (part === 9) return part9DeterministicAnalyze(results);
    return part8Analyze(results, st);
}

function checkWinPart(part, resultNum, pred) {
    const direct = (pred.prediction || "S").toUpperCase();
    const actual = isSmallJ(resultNum) ? "S" : "B";
    if (part === 1) {
        const oppPred = direct === "B" ? "S" : "B";
        const oppNums = oppPred === "S" ? [0,1,2,3,4] : [5,6,7,8,9];
        return actual === oppPred || (pred.numbers && pred.numbers.length && oppNums.slice(0, 2).includes(resultNum));
    }
    if (direct === "BIG" || direct === "SMALL") {
        const norm = direct === "BIG" ? "B" : "S";
        return actual === norm || (pred.numbers && pred.numbers.slice(0, 2).includes(resultNum));
    }
    return actual === direct || (pred.numbers && pred.numbers.slice(0, 2).includes(resultNum));
}

// ============================================================
// MAIN decidePrediction — uses 8-PART rotation system
// ============================================================
function decidePrediction(list, currentLevel, userId) {
    if (!list || list.length < 3) return null;
    const st = ensurePartState(userId);
    // Map autobet L1-15 → st.level for Part1 engine (1,2,3)
    const lvl = Number(currentLevel);
    if (lvl >= 1 && lvl <= 5) st.level = 1;
    else if (lvl >= 6 && lvl <= 10) st.level = 2;
    else st.level = 3;

    const currentPart = st.logicPart || 1;
    const mlPart = selectBestPatternPart(st, currentPart);
    if (mlPart !== currentPart) {
        st.logicPart = mlPart;
        st.switchReason = `ML pattern override -> P${mlPart}`;
    }

    const part = st.logicPart;
    const eng = partEngine(st, part);

    const resultsArr = [];
    for (let i = 0; i < Math.min(10, list.length); i++) {
        const n = getResultNum(list[i]);
        if (n !== null) resultsArr.push({ number: n, issueNumber: list[i].issueNumber });
    }
    if (resultsArr.length < 3) return null;

    st._lastResultsArr = resultsArr.slice(0, 10);
    st._lastPartPreds = st._lastPartPreds || {};
    for (let p = 1; p <= 8; p++) {
        try {
            const predP = generatePartPrediction(p, resultsArr, st);
            st._lastPartPreds[p] = predP || null;
        } catch (e) {
            st._lastPartPreds[p] = null;
        }
    }

    const rawPred = generatePartPrediction(part, resultsArr, st);
    eng.curPred = rawPred;
    st._lastPartPreds[part] = rawPred;

    // Convert S/B to BIG/SMALL for bot.js signal system
    let val = rawPred.prediction || "S";
    if (val === "S") val = "SMALL";
    else if (val === "B") val = "BIG";
    else if (val === "SMALL" || val === "BIG") {}
    else val = isSmallJ(rawPred.primary || 0) ? "SMALL" : "BIG";

    const pe = partEngine(st, part);
    const w = Number(pe.wins) || 0, l = Number(pe.losses) || 0;
    const total = w + l;
    const partStats = `P${part} W${w}/L${l}${total?` (${(100*w/total).toFixed(1)}% WR)`:""} | streak ${pe.lossCount||0}L`;
    const switchLine = st.switchReason ? ` | ${st.switchReason}` : "";
    const reason = `${rawPred.engine || 'PART'+part} | ${partStats}${switchLine}`;
    const conf = Math.max(50, Math.min(99, Number(rawPred.confidence) || 75));

    const signal = {
        type: "SIZE",
        val,
        reason,
        conf,
        numbers: rawPred.numbers || [],
        primary: rawPred.primary,
        engine: rawPred.engine || ("PART" + part),
        part,
        rawPred
    };

    return signal;
}

// -------- PART STATE UPDATE (called after each result is known) --------
// 8-PART PARALLEL INDEPENDENT STREAK ARCHITECTURE:
// - EVERY period, ALL 8 parts (1..8) have their own prediction evaluated against the result digit.
// - Each part tracks its own independent consecutive lossCount (streak).
// - Active part only: gets the real bet, display, record. 7 inactive parts run SILENTLY in parallel.
// - Any part (active OR inactive) that reaches LOSS_TRIGGER=6 consecutive losses TRIGGERS immediately → fast switch.
// - Active part WIN: all 8 part lossCount reset to 0, switch immediately to P1.
// - Triggered switch: switch to HIGHEST LOSS RATE part via selectBestPart, reset the triggered part's streak to 0.
function updatePartStateAfterResult(userId, issueNumber, resultNum, won) {
    const st = ensurePartState(userId);
    const part = st.logicPart || 1;
    const eng = partEngine(st, part);
    const pred = eng.curPred || { prediction: "?", numbers: [] };

    const partPreds = st._lastPartPreds || {};
    st._lastPartPreds = {};
    for (let p = 1; p <= 8; p++) {
        const pe = partEngine(st, p);
        const pp = partPreds[p] || pe.curPred || null;
        if (!pp || pp.prediction === null || pp.prediction === undefined) continue;

        const pWon = checkWinPart(p, resultNum, pp);
        pe.hist.push({ issue: issueNumber, result: resultNum, pred: pp.prediction || "?", numbers: pp.numbers || [], primary: pp.primary || 0, engine: pp.engine || pe.name, won: !!pWon, parallel: p !== part });
        if (pe.hist.length > 400) pe.hist.shift();

        if (pWon) {
            pe.wins++; pe._winStreak++;
            if (pe._winStreak > pe.bestStreak) pe.bestStreak = pe._winStreak;
            pe.lossCount = 0;
            pe.active = false;
        } else {
            pe.losses++; pe._winStreak = 0;
            pe.lossCount = (pe.lossCount || 0) + 1;
            if (!pe.active && pe.lossCount >= LOSS_TRIGGER) pe.active = true;
        }

        if (p === part) pe.curPred = null;
    }

    recordEngineResult(eng, !!won, issueNumber, resultNum, pred);
    st.hist.push({ issue: issueNumber, pred: pred.prediction, won: !!won, part: part });
    if (st.hist.length > 100) st.hist.shift();

    if (won) {
        st.consecutiveLoss = 0;
        st.streak = (st.streak || 0) + 1;
        for (let p = 1; p <= 8; p++) {
            const e = partEngine(st, p);
            e.lossCount = 0;
            e.curPred = null;
            e.active = false;
        }
        if (part !== 1) {
            st.switchReason = `WIN on P${part} → reset to P1 (master)`;
            st.lastSwitchFrom = part;
        } else {
            st.switchReason = `WIN on P${part} (master)`;
            st.lastSwitchFrom = part;
        }
        st.logicPart = 1;
    } else {
        st.consecutiveLoss++;
        st.streak = 0;
        eng.lossCount = (eng.lossCount || 0) + 1;

        const patternPart = selectBestPatternPart(st, part);
        const lowestPart = selectLowestStreakPart(st);
        const nextPart = patternPart !== part ? patternPart : lowestPart;
        const shouldSwitch = eng.lossCount >= LOSS_TRIGGER || (nextPart !== part && (partEngine(st, nextPart).lossCount || 0) <= (eng.lossCount || 0));

        if (shouldSwitch) {
            st.lastSwitchFrom = part;
            st.switchReason = `ML best pattern -> P${nextPart} (win-rate override)`;
            st.logicPart = nextPart;
            eng.lossCount = 0;
            const nextEng = partEngine(st, nextPart);
            nextEng.active = true;
            nextEng.curPred = null;
        }
    }

    eng.curPred = null;
}

// ============================================================
// 2. handleWin - UI & Stats
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel) {
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const st = userPartState[userId] || {};
    const part = st.logicPart || 1;
    const pe = (st.e1 && partEngine(st, part)) || null;
    const amt = getBetAmount(userId, betLevel);
    const profit = amt * 0.98;
    if (autobetState && autobetState[userId]) {
        autobetState[userId].level = 1;
    }
    
    pt.totalBets++; pt.wins++; pt.pnl += profit; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.winStreak++; pt.lossStreak = 0;
    if(pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;

    let partLine = "Part   : P" + part;
    if (pe) {
        const w = Number(pe.wins)||0, l = Number(pe.losses)||0, t = w+l;
        partLine = "Part   : P" + part + " (" + (pe.name || ("PART"+part)) + ") W" + w + "/L" + l + (t?` ${(100*w/t).toFixed(1)}%`:"");
    }
    if (st.switchReason) partLine += "\nSwitch : " + st.switchReason;

    await send(chatId,
"╔══════════════════════════╗\n"+
"║  ✅ WIN! 🎉              ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ "+partLine+"\n"+
"║ Profit : +₹"+profit.toFixed(2)+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Streak : "+pt.winStreak+" wins\n"+
"║ Total  : "+pt.wins+"W/"+pt.losses+"L\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
    );
    await sendSticker(chatId, WIN_STICKER);
}

// ============================================================
// 3. handleLoss - UI & Stats
// ============================================================
async function handleLoss(userId, chatId, actual, num, betLevel) {
    const stAuto = autobetState[userId];
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const st = userPartState[userId] || {};
    const part = st.logicPart || 1;
    const pe = (st.e1 && partEngine(st, part)) || null;
    const amt = getBetAmount(userId, betLevel);
    
    pt.totalBets++; pt.losses++; pt.pnl -= amt; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.lossStreak++; pt.winStreak = 0;
    if(pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;

    let partLine = "Part   : P" + part;
    if (pe) {
        const w = Number(pe.wins)||0, l = Number(pe.losses)||0, t = w+l;
        partLine = "Part   : P" + part + " (" + (pe.name || ("PART"+part)) + ") W" + w + "/L" + l + (t?` ${(100*w/t).toFixed(1)}%`:"") + " | streak " + (pe.lossCount||0) + "L";
    }
    if (st.switchReason) partLine += "\nSwitch : " + st.switchReason;

    if(stAuto.level >= 15){
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  🛑 L15 LOSS — BOT STOPPED ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ "+partLine+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Status : AutoBet stopped.\n"+
"╚══════════════════════════╝"
        );
    } else if(betLevel < (cfg.maxLvl || 15)){
        const next = getBetAmount(userId, stAuto.level);
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  ❌ LOSS                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ "+partLine+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"╠══════════════════════════╣\n"+
"║ Next L"+stAuto.level+" : ₹"+next+"\n"+
"╚══════════════════════════╝"
        );
    } else {
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  💀 MAX LEVEL LOSS       ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ "+partLine+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Reset  : L1 | Watch 0/"+cfg.watchLoss+"\n"+
"╚══════════════════════════╝"
        );
    }
    await sendSticker(chatId, LOSS_STICKER);
}

// ============================================================
// PREDICT LOOP
// ============================================================

async function runPredict(userId, chatId) {
    if (!running[userId]) return;
    initUser(userId);
    const st = autobetState[userId];
    const cfg = autobetCfg[userId];

    if (st.isWaiting) {
        if (Date.now() >= st.nextStartTime) {
            st.isWaiting = false;
            profitTrack[userId].pnl = 0;
            await send(chatId, "🔄 Timed Restart! Starting new section...");
        } else {
            return trackUserTimer(userId, setTimeout(() => {
                if (running[userId]) runPredict(userId, chatId);
            }, 30000));
        }
    }

    const list = await fetchList();
    if (!list) return trackUserTimer(userId, setTimeout(() => {
        if (running[userId]) runPredict(userId, chatId);
    }, 15000));

    const next = (BigInt(list[0].issueNumber) + 1n).toString();
    if (sentPeriods[userId].has(next)) return setTimeout(() => runPredict(userId, chatId), 2000);
    sentPeriods[userId].add(next);
    if (sentPeriods[userId].size > 50) {
        const firstItem = sentPeriods[userId].values().next().value;
        sentPeriods[userId].delete(firstItem);
    }

    const signal = decidePrediction(list, st.level, userId);
    if (!signal) return trackUserTimer(userId, setTimeout(() => {
        if (running[userId]) runPredict(userId, chatId);
    }, 5000));

    // Store prediction (before checking if it wins/loses)
    const periodNumber = next;
    savePredictionResult(userId, periodNumber, signal.val, null, null, st.level, signal.conf || 50, signal.reason, signal.type || "SIZE", signal.part || 0);

    const waitingDueToLevel = st.waitingAction === 'watch';

    let abLine = "🤖 AutoBet: OFF";
    let canBet = false;
    let waitLine = "";

    if (!cfg || !cfg.enabled) {
        abLine = "🤖 AutoBet: OFF";
        canBet = false;
    } else if (waitingDueToLevel) {
        canBet = false;
        if (st.waitingAction === 'watch') {
            waitLine = `\nWatch: ${st.watchConsecutiveLosses}/${st.waitingTarget} losses`;
            abLine = `👀 WATCH MODE (${st.level})`;
        }
    } else if (cfg.watch && st.consecutiveLoss < cfg.watchLoss) {
        abLine = `👀 WATCHING: ${st.consecutiveLoss}/${cfg.watchLoss}`;
        waitLine = `\nWatch Loss: ${st.consecutiveLoss}/${cfg.watchLoss}`;
        canBet = false;
    } else {
        canBet = true;
        const curBet = getBetAmount(userId, st.level);
        abLine = (st.level > 1 ? "📈 MART " : "💰 BET ") + "L" + st.level + ": ₹" + curBet;
    }

    const msgText = 
"╔══════════════════════════╗\n"+
"║    👑 EARN WITH ME AI    ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Signal  : "+(signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")+"\n"+
"║ Reason  : "+signal.reason+"\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
waitLine+"\n"+
"╚══════════════════════════╝";
    await send(chatId, msgText, { reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]} });

    let betPlaced = false;
    if (canBet) {
        const result = await placeBet(userId, chatId, next, signal.val, signal.type, st.level);
        if (result && result.ok) {
            betPlaced = true;
            await send(chatId, "✅ Bet Success! ₹" + result.amt + " L" + st.level + "\n⏳ Checking result...");
        } else if (result && !result.ok) {
            await send(chatId, "❌ Bet Failed: " + (result.msg || "Unknown error"));
        }
    }

    checkResult(userId, chatId, next, signal.val, signal.type, betPlaced);
}

// ============================================================
// RESULT CHECKER
// ============================================================
async function checkResult(userId, chatId, target, predicted, predType, betPlaced) {
    let tries = 0;
    const cfg = autobetCfg[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];

    const poll = async () => {
        if (!running[userId]) return;
        if (++tries > 25) {
            await logBoth(chatId, "⏱ Timeout — checking next period...");
            setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 3000);
            return;
        }

        const list = await fetchList();
        if (!list || BigInt(list[0].issueNumber) < BigInt(target)) {
            return setTimeout(poll, 10000);
        }

        const res = list.find(i => i.issueNumber === target) || list[0];
        const num = parseInt(res.number || res.winNumber || 0);
        let actual;
        if (predType === "SIZE") actual = num >= 5 ? "BIG" : "SMALL";
        else actual = num === 0 ? "RED" : num === 5 ? "GREEN" : num % 2 === 0 ? "RED" : "GREEN";

        const win = predicted === actual;
        const betLevel = st.level;
        const curPart = (userPartState[userId] && userPartState[userId].logicPart) || 0;

        if (win) st.consecutiveLoss = 0;
        else st.consecutiveLoss++;
        if (st.consecutiveLoss > 999) st.consecutiveLoss = 999;

        // Store prediction result
        savePredictionResult(userId, target, predicted, actual, win, betLevel, 75, "PREDICTION_CHECK", predType, curPart);

        // Martingale progression: every loss advances to the next level.
        // Do not override it with adaptive/ML logic, which can reduce the bet after a loss.
        if (betPlaced && !win) {
            st.level = getNextLevel(betLevel, cfg.maxLvl);
            if (st.level >= 15) {
                running[userId] = false;
                await send(chatId, "🛑 L15 loss reached — AutoBet stopped.");
            }
        } else if (betPlaced && win) {
            st.level = 1;
        }

        try {
            updatePartStateAfterResult(userId, target, num, win);
        } catch (e) { console.error("[PART-STATE-UPDATE]", e.message); }

        const s = stats[userId];
        s.total++;
        if (win) {
            s.win++; s.winStreak++; s.lossStreak = 0;
            if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak;
        } else {
            s.loss++; s.lossStreak++; s.winStreak = 0;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        }

        if (betPlaced) {
            if (win) await handleWin(userId, chatId, actual, num, betLevel);
            else await handleLoss(userId, chatId, actual, num, betLevel);

            const targetProfit = Number(cfg.targetProfit) || 1000;
            if (pt.pnl >= targetProfit) {
                st.isWaiting = true;
                st.nextStartTime = Date.now() + (Number(cfg.restartDelay) || 1) * 60 * 1000;
                await send(chatId, "🎯 TARGET REACHED! Bot Paused.");
            }
        } else {
            if (win) {
                await send(chatId,
                    "╔══════════════════════════╗\n" +
                    "║  👀 WATCH RESULT: WIN! ✅ ║\n" +
                    "╠══════════════════════════╣\n" +
                    "║ Number : " + num + "\n" +
                    "║ Result : " + actual + "\n" +
                    "║ Status : Correct Prediction\n" +
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, WIN_STICKER);
            } else {
                await send(chatId,
                    "╔══════════════════════════╗\n" +
                    "║  👀 WATCH RESULT: LOSS ❌ ║\n" +
                    "╠══════════════════════════╣\n" +
                    "║ Number : " + num + "\n" +
                    "║ Result : " + actual + "\n" +
                    "║ Status : Incorrect Prediction\n" +
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, LOSS_STICKER);
            }
        }

        trackUserTimer(userId, setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 8000));
    };
    trackUserTimer(userId, setTimeout(poll, 10000));
}

// ============================================================
// PREDICT LOOP - REMOVED
// ============================================================

// runPredict removed

// ============================================================
// RESULT CHECKER
// ============================================================
// checkResult removed

module.exports = { decidePrediction, runPredict, checkResult };

function showStats(chatId,userId){
    const d=stats[userId],rate=d.total?((d.win/d.total)*100).toFixed(1):"0.0";
    const bar="🟦".repeat(d.total?Math.round(d.win/d.total*10):0)+"⬜".repeat(d.total?10-Math.round(d.win/d.total*10):10);
    send(chatId,"📊 STATS\n\nTotal: "+d.total+"\nWins: "+d.win+"\nLosses: "+d.loss+"\nAcc: "+rate+"%\n"+bar+"\n\nBest Win: "+d.maxWinStreak+" streak\nWorst Loss: "+d.maxLossStreak+" streak");
}
async function profitReport(chatId,userId){
    initUser(userId);
    const pt=profitTrack[userId],cfg=autobetCfg[userId];
    const rate=pt.totalBets?((pt.wins/pt.totalBets)*100).toFixed(1):"0.0";
    const amounts=cfg.customBets.slice(0,cfg.maxLvl);
    let balance = "❌ No token";
    const balResult = await getLiveBalance(userId);
    if(balResult.success){
        balance = "₹"+balResult.balance;
    } else if (balResult.message){
        balance = "⚠️ "+balResult.message;
    }
    send(chatId,
"💰 PROFIT REPORT\n\n"+
"Balance: "+balance+"\n"+
"Bets   : "+pt.totalBets+"\nWins   : "+pt.wins+"\nLoss   : "+pt.losses+"\nRate   : "+rate+"%\n"+
"P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"Best W : "+pt.maxW+" | Worst L: "+pt.maxL+"\n\n"+
"Mart: ₹"+amounts.join("→₹")
    );
}
async function autobetStatus(chatId, userId) {
    initUser(userId);
    const cfg = autobetCfg[userId], st = autobetState[userId], pt = profitTrack[userId];
    const amounts = cfg.customBets.slice(0, cfg.maxLvl);
    const creds = userCreds[userId] || {};

    let liveBal = "❌ No token";
    let token = getToken(userId);
    const hasToken = token && token.length > 20;
    if (hasToken) {
        const result = await getLiveBalance(userId);
        if (result.success) {
            liveBal = "₹" + result.balance;
        } else {
            liveBal = "⚠️ " + result.message;
        }
    } else if (creds.phone) {
        liveBal = "❌ Login Required";
    }

    let waitLine = "";
    if (st.isWaiting) {
        const diff = Math.round((st.nextStartTime - Date.now()) / 60000);
        waitLine = "\n⏳ Waiting: " + diff + " mins to restart";
    }

    send(chatId,
"🤖 AUTOBET STATUS\n\n"+
"💰 Live Balance: "+liveBal+"\n"+
"Enabled  : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(token.length>20?"✅":"❌")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n"+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+st.consecutiveLoss+"/"+cfg.watchLoss+"\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Target Profit: ₹"+cfg.targetProfit+"\n"+
"Section Delay: "+cfg.restartDelay+" mins"+ // Hours-la irunthu Minutes-ku mathi irukken
waitLine+"\n"+
"In Mart  : "+(st.inMart?"YES":"NO")+"\n"+
"P&L      : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n\n"+
"Mart: ₹"+amounts.join("→₹")
    );
}



// ============================================================
//  KEYBOARDS
// ============================================================
function userMenu(id){
    const rows=[["▶️ Start Prediction","🛑 Stop"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔑 My Token"]];
    if(isAdmin(id))rows.push(["👑 Admin Panel"]);
    return{keyboard:rows,resize_keyboard:true};
}
const ownerMenu={keyboard:[["👥 All Users","👮 All Admins"],["👤 Add Admin","🗑 Remove Admin"],["🔑 Generate Key","📋 All Keys"],["🟢 Add User","🔴 Remove User"],["🔐 Set Token","📊 All Status"],["🚪 Owner Logout"]],resize_keyboard:true};
const adminMenu={keyboard:[["👥 Active Users","🔑 Generate Key"],["🟢 Add User","🔴 Remove User"],["📋 All Keys","🚪 Admin Logout"]],resize_keyboard:true};
const autobetMenu={keyboard:[
    ["✅ Enable AutoBet","❌ Disable AutoBet"],
    ["👀 Watch Mode ON","👀 Watch Mode OFF"],
    ["💰 Set Base Bet","📈 Set Max Level"],
    ["🎯 Set Profit Target", "⏳ Set Section Delay"],
    ["🔢 Set Watch Losses","📊 AutoBet Status"],
    ["📝 Set Custom Bets","📊 Part Stats","🔙 Back"]
],resize_keyboard:true};

function partStatsFor(userId) {
    const st = ensurePartState(userId);
    const active = st.logicPart || 1;
    const lines = [];
    lines.push("╔════════════════════════════════╗");
    lines.push("║      📊 ALL PART STATS         ║");
    lines.push("╠════════════════════════════════╣");
    lines.push("║ Active : P" + active + " (" + (partEngine(st, active).name || "PART"+active) + ")");
    if (st.switchReason) lines.push("║ Switch : " + st.switchReason);
    lines.push("╠════════════════════════════════╣");
    let totalW = 0, totalL = 0;
    const rows = [];
    for (let p = 1; p <= 8; p++) {
        const e = partEngine(st, p);
        const w = Number(e.wins)||0, l = Number(e.losses)||0, t = w+l;
        totalW += w; totalL += l;
        const lr = (100*((l+1)/(w+l+2))).toFixed(0);
        const wr = t ? (100*w/t).toFixed(1) : "0.0";
        const mark = (p === active) ? "◀" : " ";
        rows.push("║ P"+p+" "+mark+" │ W"+w+" L"+l+" │ WR "+wr+"% │ LR~"+lr+"% │ BS "+(e.bestStreak||0)+" │ s"+(e.lossCount||0));
    }
    rows.forEach(r => lines.push(r));
    lines.push("╠════════════════════════════════╣");
    const ttl = totalW + totalL;
    const twr = ttl ? ((100*totalW/ttl).toFixed(1)) : "0.0";
    lines.push("║ TOTAL  │ W"+totalW+" L"+totalL+" ("+ttl+") WR "+twr+"%");
    lines.push("╚════════════════════════════════╝");
    return lines.join("\n");
}
async function partStats(chatId, userId) {
    initUser(userId);
    const text = partStatsFor(userId);
    await send(chatId, text);
}

// ============================================================
//  BOT INIT
// ============================================================
let bot;
let pollingRecovery = false;
function recoverPolling(err) {
    if (pollingRecovery || !bot) return;
    pollingRecovery = true;
    console.warn("[POLL] Recovering from polling error:", err?.message || err);
    bot.stopPolling().catch(() => {});
    setTimeout(() => {
        try {
            bot.startPolling();
            console.log("[POLL] Polling restarted successfully.");
        } catch (e) {
            console.error("[POLL] Polling restart failed:", e?.message || e);
        } finally {
            pollingRecovery = false;
        }
    }, 5000);
}
function startBot(){
    if(bot){try{bot.stopPolling();}catch(e){}}
    bot=new TelegramBot(BOT_TOKEN,{polling:{interval:1000,autoStart:true,params:{timeout:30}}});
    bot.on("polling_error",err=>{
        const msg = err?.message || String(err);
        if (msg.includes("ECONNRESET") || msg.includes("EFATAL") || msg.includes("socket hang up")) {
            recoverPolling(err);
            return;
        }
        console.error("Poll:", msg);
    });
    bot.on("error",err=>{
        const msg = err?.message || String(err);
        if (msg.includes("ECONNRESET") || msg.includes("EFATAL") || msg.includes("socket hang up")) {
            console.warn("Bot error recovered:", msg);
            return;
        }
        console.error("Bot:", msg);
    });
    addHandlers();
    console.log("✅ SIVA BOT running...");

}

async function send(chatId,text,opts={}){
    try{return await bot.sendMessage(chatId,text,opts);}
    catch(e){if(e.message&&e.message.includes("parse entities")){try{const o={...opts};delete o.parse_mode;return await bot.sendMessage(chatId,text,o);}catch(e2){}}console.error("send:",e.message?.substr(0,60));}
}
async function sendSticker(chatId,sid){try{await bot.sendSticker(chatId,sid);}catch(e){}}

// ============================================================
//  AUTO LOGIN TASK
// ============================================================


// ============================================================
//  HANDLERS
// ============================================================
function addHandlers(){
    bot.onText(/\/start/,(msg)=>{
        const id=msg.from.id;initUser(id);
        const status=hasAccess(id)?"✅ ACTIVE — "+daysLeft(id)+"d left":"❌ NO ACCESS";
        send(msg.chat.id,
"╔══════════════════════════╗\n║  👑EARN WITH ME BOT    ║\n╠══════════════════════════╣\n"+
"║ Status : "+status+"\n║ ID     : "+id+"\n║ Admin  : "+ADMIN_HANDLE+"\n╠══════════════════════════╣\n"+
"║ /key CODE to activate    ║\n╚══════════════════════════╝",
        {reply_markup:userMenu(id)});
    });

    bot.onText(/\/key (.+)/,(msg,match)=>{
        const id=msg.from.id;initUser(id);
        const res=activateKey(id,match[1].trim());
        if(res.ok){send(msg.chat.id,"🎊 KEY ACTIVATED!\n⏳ "+res.days+" days\n📅 "+res.expiry,{reply_markup:userMenu(id)});send(OWNER_ID,"🔔 Key used!\nUser: "+id+"\nDays: "+res.days);}
        else send(msg.chat.id,res.msg);
    });

    bot.onText(/\/setcreds (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const parts=match[1].trim().split(/\s+/);
        if(parts.length<2)return send(id,"❌ Format:\n/setcreds FULLPHONE PASSWORD\n\nExample:\n/setcreds 916381605525 mypassword");
        const phone=parts[0],pass=parts.slice(1).join(" ");
        if(!userCreds[id])userCreds[id]={};
        userCreds[id].phone=phone;userCreds[id].pass=pass;
        send(id,"✅ Saved!\n📱 "+phone+"\n🔄 Testing login...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/setmytoken (.+)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const tok=match[1].trim().replace(/^Bearer\s+/i,"");
        if(tok.length<20)return send(id,"❌ Token too short!");
        userTokens[id]=tok;
        send(id,"✅ Token saved!\n..."+tok.slice(-12)+"\n\n🤖 AutoBet Setup → ✅ Enable");
    });

    bot.onText(/\/login/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        send(id,"🔄 Logging in...");
        autoLogin(id,msg.chat.id,false);
    });

    bot.onText(/\/owner/,(msg)=>{
        if(msg.from.id!==OWNER_ID)return;
        if(ownerLoggedIn)return send(OWNER_ID,"Already in!",{reply_markup:ownerMenu});
        ownerState={action:"login"};send(OWNER_ID,"� Owner password:");
    });

    bot.onText(/\/adminlogin (.+)/,(msg,match)=>{
        const id=msg.from.id,pass=match[1].trim();
        if(!isAdmin(id))return send(id,"Not admin.");
        if(pass===adminPasswords[id]){adminLoggedIn[id]=true;send(id,"✅ Admin Login!",{reply_markup:userMenu(id)});}
        else send(id,"❌ Wrong!");
    });

    bot.onText(/\/predstats/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        initUser(id);
        
        const stats = getPredictionStats(id);
        let report = "📊 PREDICTION STATISTICS\n\n";
        report += `📈 Overall\n`;
        report += `  Total: ${stats.overall.total}\n`;
        report += `  Wins: ${stats.overall.wins}\n`;
        report += `  Losses: ${stats.overall.losses}\n`;
        report += `  Accuracy: ${stats.overall.accuracy}%\n\n`;
        
        report += `🎯 By Level\n`;
        Object.keys(stats.byLevel).sort((a,b)=>Number(a)-Number(b)).forEach(level=>{
            const s = stats.byLevel[level];
            report += `  L${level}: ${s.wins}W/${s.losses}L (${s.accuracy}%)\n`;
        });
        
        report += `\n🎲 By Type\n`;
        Object.keys(stats.byType).forEach(type=>{
            const s = stats.byType[type];
            report += `  ${type}: ${s.wins}W/${s.losses}L (${s.accuracy}%)\n`;
        });
        
        send(id, report);
    });

    bot.onText(/\/history/,(msg)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        initUser(id);
        
        const storage = ensurePredictionStorage(id);
        const recent = storage.results.slice(-10).reverse();
        
        if(recent.length === 0) return send(id, "📋 No prediction history yet.");
        
        let report = "📋 LAST 10 PREDICTIONS\n\n";
        recent.forEach((r, i)=>{
            const icon = r.won ? "✅" : "❌";
            report += `${i+1}. ${icon} Issue: ${r.issue}\n`;
            report += `   Pred: ${r.predicted} | Result: ${r.actual || "pending"}\n`;
            report += `   L${r.level} | Conf: ${r.confidence}%\n\n`;
        });
        
        send(id, report);
    });

    bot.on("message",async msg=>{
        const id=msg.from.id,text=msg.text;
        if(!text||text.startsWith("/"))return;
        initUser(id);

        const OB=["👥 All Users","👮 All Admins","👤 Add Admin","🗑 Remove Admin","🔑 Generate Key","📋 All Keys","🟢 Add User","🔴 Remove User","🔐 Set Token","📊 All Status","🚪 Owner Logout"];
        const AB=["👥 Active Users","🔑 Generate Key","🟢 Add User","🔴 Remove User","📋 All Keys","🚪 Admin Logout"];

        if(id===OWNER_ID&&ownerState){
            const s=ownerState;
            if(s.action==="login"){if(text===OWNER_PASS){ownerLoggedIn=true;ownerState=null;return send(OWNER_ID,"👑 Welcome!",{reply_markup:ownerMenu});}else return send(OWNER_ID,"❌ Wrong!");}
            if(OB.includes(text)){ownerState=null;}
            else if(s.action==="addadmin"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(OWNER_ID,"❌");ownerState={action:"addadmin",step2:true,tid:t};return send(OWNER_ID,"ID:"+t+"\nPassword:");}else{if(text.length<6)return send(OWNER_ID,"❌ Min 6");adminPasswords[s.tid]=text;adminLoggedIn[s.tid]=false;ownerState=null;send(OWNER_ID,"✅ Admin: "+s.tid,{reply_markup:ownerMenu});send(s.tid,"🎉 Admin!\n/adminlogin "+text);return;}}
            else if(s.action==="removeadmin"){const t=parseInt(text);if(isNaN(t))return;delete adminPasswords[t];delete adminLoggedIn[t];ownerState=null;send(OWNER_ID,"🚫 Removed",{reply_markup:ownerMenu});return;}
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(OWNER_ID,"❌ Days?");const k=generateKey(d,OWNER_ID);ownerState=null;return send(OWNER_ID,"🔑 Key:\n\n"+k+"\n\n"+d+"d\n/key "+k,{reply_markup:ownerMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(OWNER_ID,"❌");ownerState={action:"adduser",step2:true,tid:t};return send(OWNER_ID,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(OWNER_ID,"❌");usersAccess[s.tid]=Date.now()+d*86400000;ownerState=null;send(OWNER_ID,"✅ "+s.tid+" "+d+"d",{reply_markup:ownerMenu});send(s.tid,"🎊 VIP! "+d+" days\n▶️ Start Prediction!");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(Number(t)===Number(OWNER_ID))return send(OWNER_ID,"❌ Owner access cannot be removed.",{reply_markup:ownerMenu});const was=hasAccess(t);delete usersAccess[t];running[t]=false;ownerState=null;send(OWNER_ID,was?"🚫 Removed":"⚠️ Not active",{reply_markup:ownerMenu});if(was)send(t,"🔴 Access removed.");return;}
            else if(s.action==="settoken"){GLOBAL_TOKEN=text.trim().replace(/^Bearer\s+/i,"");ownerState=null;return send(OWNER_ID,"✅ Global Token set!",{reply_markup:ownerMenu});}
        }

        if(id===OWNER_ID&&ownerLoggedIn){
            if(text==="👥 All Users")    return send(OWNER_ID,"👥\n\n"+activeUsersList());
            if(text==="👮 All Admins")   return send(OWNER_ID,"👮\n\n"+adminList());
            if(text==="👤 Add Admin")    {ownerState={action:"addadmin"};return send(OWNER_ID,"User ID:");}
            if(text==="🗑 Remove Admin") {ownerState={action:"removeadmin"};return send(OWNER_ID,"Admin ID:");}
            if(text==="🔑 Generate Key") {ownerState={action:"genkey"};return send(OWNER_ID,"Days?");}
            if(text==="📋 All Keys")     return send(OWNER_ID,"📋\n\n"+allKeysList());
            if(text==="🟢 Add User")     {ownerState={action:"adduser"};return send(OWNER_ID,"User ID:");}
            if(text==="🔴 Remove User")  {ownerState={action:"removeuser"};return send(OWNER_ID,"User ID?");}
            if(text==="🔐 Set Token")    {ownerState={action:"settoken"};return send(OWNER_ID,"Token paste:");}
            if(text==="📊 All Status")    {
                const ids = Object.keys(usersAccess);
                if(ids.length === 0) return send(OWNER_ID, "No users found.");
                let report = "📊 TEAM MEMBERS ALL STATUS 📊\n\n";
                ids.forEach(uid => {
                    initUser(uid);
                    const pt = profitTrack[uid];
                    const st = autobetState[uid];
                    const pnlStr = (pt.pnl >= 0 ? "+" : "") + pt.pnl.toFixed(2);
                    report += `👤 ID: ${uid}\n`;
                    report += `💰 Total Bet: ₹${(pt.totalBetAmount || 0).toFixed(2)}\n`;
                    report += `📈 Profit: ₹${pnlStr}\n`;
                    report += `🎮 Level: L${st.level}\n`;
                    report += `📊 Win/Loss: ${pt.wins}W / ${pt.losses}L\n`;
                    report += `------------------------\n`;
                });
                return send(OWNER_ID, report);
            }
            if(text==="🚪 Owner Logout") {ownerLoggedIn=false;return send(OWNER_ID,"🔒 Out.",{reply_markup:userMenu(id)});}
        }

        if(isAdmin(id) && isAdminIn(id) && adminState[id]){
            const s = adminState[id];
            if(AB.includes(text)){ delete adminState[id]; }
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌ Days?");const k=generateKey(d,id);delete adminState[id];return send(id,"🔑 Key:\n\n"+k+"\n\n"+d+"d",{reply_markup:adminMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(id,"❌");adminState[id]={action:"adduser",step2:true,tid:t};return send(id,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌");usersAccess[s.tid]=Date.now()+d*86400000;delete adminState[id];send(id,"✅ "+s.tid+" "+d+"d",{reply_markup:adminMenu});send(s.tid,"🎊 ACCESS! "+d+"d");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(Number(t)===Number(OWNER_ID))return send(id,"❌ Owner access cannot be removed.",{reply_markup:adminMenu});const was=hasAccess(t);delete usersAccess[t];running[t]=false;delete adminState[id];send(id,was?"🚫 Removed":"⚠️ Not active",{reply_markup:adminMenu});if(was)send(t,"🔴 Removed.");return;}
        }

        if(hasAccess(id) && userAction[id]){
            const s = userAction[id];
            if(text === "🔙 Back") { delete userAction[id]; }
            else if(s.action === "setbase"){
                const v = parseInt(text);
                if(isNaN(v) || v < 1) return send(id, "❌ Invalid Amount! Min ₹1.");
                autobetCfg[id].baseBet = v;
                delete userAction[id];
                const a = MULT.slice(0, autobetCfg[id].maxLvl).map(m => v * m);
                return send(id, "✅ Base Bet Updated: ₹" + v + "\nMartingale: ₹" + a.join("→₹"), {reply_markup: autobetMenu});
            }
            else if(s.action === "setlvl"){
                const v = parseInt(text);
                if(isNaN(v) || v < 1 || v > 15) return send(id, "❌ Invalid Level! Enter 1-15.");
                autobetCfg[id].maxLvl = v;
                delete userAction[id];
                const a = MULT.slice(0, v).map(m => autobetCfg[id].baseBet * m);
                return send(id, "✅ Max Level Updated: L" + v + "\nMartingale: ₹" + a.join("→₹"), {reply_markup: autobetMenu});
            }
            else if(s.action === "setwloss"){
                const v = parseInt(text);
                if(isNaN(v) || v < 0) return send(id, "❌ Invalid Number!");
                autobetCfg[id].watchLoss = v;
                delete userAction[id];
                return send(id, "✅ Watch Loss Updated: " + v + "\n(Bot will wait for " + v + " losses before betting)", {reply_markup: autobetMenu});
            }
            else if(s.action === "setcustom"){
                const vals = text.split(/[, ]+/).map(v => parseInt(v.trim())).filter(v => !isNaN(v) && v > 0);
                if(vals.length === 0) return send(id, "❌ Invalid Format! Use: 1,4,7,9");
                autobetCfg[id].customBets = vals;
                autobetCfg[id].maxLvl = vals.length;
                delete userAction[id];
                return send(id, "✅ Custom Bets Updated!\nLevels: " + vals.length + "\nSequence: ₹" + vals.join(" → ₹"), {reply_markup: autobetMenu});
            }
        }

        if(isAdmin(id)&&isAdminIn(id)){
            if(text==="👥 Active Users") return send(id,"👥\n\n"+activeUsersList());
            if(text==="🔑 Generate Key") {adminState[id]={action:"genkey"};return send(id,"Days?");}
            if(text==="🟢 Add User")     {adminState[id]={action:"adduser"};return send(id,"User ID?");}
            if(text==="🔴 Remove User")  {adminState[id]={action:"removeuser"};return send(id,"User ID?");}
            if(text==="📋 All Keys")     return send(id,"📋\n\n"+allKeysList());
            if(text==="🚪 Admin Logout") {adminLoggedIn[id]=false;return send(id,"🔒 Out.",{reply_markup:userMenu(id)});}
        }

        if(text==="👑 Admin Panel"&&isAdmin(id)){
            if(!isAdminIn(id))return send(id,"Login:\n/adminlogin YOUR_PASS");
            return send(id,"👑 Admin",{reply_markup:adminMenu});
        }

        if(text==="🤖 AutoBet Setup"){
            if(!hasAccess(id))return send(id,"❌ No access.");
            const cfg=autobetCfg[id],creds=userCreds[id]||{};
            const amounts=MULT.slice(0,cfg.maxLvl).map(m=>cfg.baseBet*m);
            const targetProfit = Number(cfg.targetProfit) || 1000;
            return send(id,
"🤖 AUTOBET SETTINGS\n\n"+
"Status   : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(getToken(id).length>20?"✅ SET":"❌ MISSING")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌ /setcreds")+"\n"+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+cfg.watchLoss+" consecutive\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Target   : ₹"+targetProfit+"\n\n"+
"Mart: ₹"+amounts.join("→₹")+"\n\n"+
"/setcreds 916381605525 PASSWORD\n"+
"/setmytoken TOKEN",
            {reply_markup:autobetMenu});
        }

        if(text==="✅ Enable AutoBet"){
            const creds=userCreds[id]||{};
            if(!getToken(id)&&!creds.phone)return send(id,"❌ /setcreds FULLPHONE PASSWORD\nor /setmytoken TOKEN");
            autobetCfg[id].enabled=true;
            if(!getToken(id)&&creds.phone){
                send(id,"🔄 Auto login...");
                const ok=await autoLogin(id,msg.chat.id,true);
                if(ok)send(id,"✅ AutoBet ON!\n₹"+autobetCfg[id].baseBet+" | Watch:"+(autobetCfg[id].watch?autobetCfg[id].watchLoss+"L":"OFF"),{reply_markup:userMenu(id)});
                else send(id,"⚠️ Login fail. /setcreds பண்ணு.",{reply_markup:autobetMenu});
            } else {
                send(id,"✅ AutoBet ON!\n₹"+autobetCfg[id].baseBet+" | Watch:"+(autobetCfg[id].watch?autobetCfg[id].watchLoss+"L":"OFF"),{reply_markup:userMenu(id)});
            }
            return;
        }
        if(text==="❌ Disable AutoBet"){autobetCfg[id].enabled=false;return send(id,"❌ AutoBet OFF",{reply_markup:userMenu(id)});}
        if(text==="👀 Watch Mode ON") {autobetCfg[id].watch=true;return send(id,"👀 Watch ON — "+autobetCfg[id].watchLoss+" losses → bet");}
        if(text==="👀 Watch Mode OFF"){autobetCfg[id].watch=false;return send(id,"👀 Watch OFF — Direct bet!");}
                        // --- CORRECTED SETTINGS HANDLERS ---
        if(text==="💰 Set Base Bet"){userAction[id]={action:"setbase"};return send(id,"Enter base bet amount (e.g. 1):");}
        if(text==="📈 Set Max Level"){userAction[id]={action:"setlvl"};return send(id,"Enter max level (1-15):");}
                // --- SETTINGS TRIGGERS ---
        if(text==="🎯 Set Profit Target"){userAction[id]={action:"settarget"};return send(id,"Enter target profit (Min ₹10):");}
        if(text==="⏳ Set Section Delay"){userAction[id]={action:"setdelay"};return send(id,"Enter restart delay in MINUTES (e.g. 30):");}
        if(text==="📝 Set Custom Bets"){userAction[id]={action:"setcustom"};return send(id,"📝 Enter Custom Bet Sequence (e.g. 1,4,7,9):");}
if(text==="🔢 Set Watch Losses"){
    userAction[id]={action:"setwloss"};
    return send(id,"Enter watch loss count (e.g. 3):");
}

        // --- INPUT SAVING LOGIC ---
        if(hasAccess(id) && userAction[id]){
            const s = userAction[id];
            if(text === "🔙 Back") { delete userAction[id]; }
            
            else if(s.action === "settarget"){
                const v = Number(text);
                if(!Number.isFinite(v) || v < 10) return send(id, "❌ Min ₹10 kudunga!");
                autobetCfg[id].targetProfit = v;
                delete userAction[id];
                return send(id, "✅ Profit target set to ₹"+v, {reply_markup: autobetMenu});
            }
            else if(s.action === "setdelay"){
                const v = parseInt(text);
                if(isNaN(v) || v < 1) return send(id, "❌ Invalid minutes!");
                autobetCfg[id].restartDelay = v;
                delete userAction[id];
                return send(id, "✅ Section delay set to "+v+" minutes", {reply_markup: autobetMenu});
            }
            else if(s.action === "setcustom"){
                const vals = text.split(/[, ]+/).map(v => parseInt(v.trim())).filter(v => !isNaN(v) && v > 0);
                if(vals.length === 0) return send(id, "❌ Format error! Use: 1,4,7,9");
                autobetCfg[id].customBets = vals;
                autobetCfg[id].maxLvl = vals.length;
                delete userAction[id];
                return send(id, "✅ Custom Bets Updated!\nLevels: " + vals.length + "\nSequence: ₹" + vals.join(" → ₹"), {reply_markup: autobetMenu});
            }
            // ... matha setbase, setlvl code-um ithu kulla thaan varum
        }

        // --- IMPORTANT: AWAIT ADDED ---
        if(text==="📊 AutoBet Status") return await autobetStatus(msg.chat.id,id);
        if(text==="📊 Part Stats") return await partStats(msg.chat.id,id);

        if(text==="🔙 Back")return await send(id,"Main Menu",{reply_markup:userMenu(id)});

        if(text==="🔑 My Token"){
            const tok=getToken(id),creds=userCreds[id]||{};
            return send(id,"Token: "+(tok.length>20?"✅ ..."+tok.slice(-12):"❌")+"\nLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n\n/setcreds FULLPHONE PASSWORD\n/setmytoken TOKEN\n/login — Test");
        }

      if(text==="▶️ Start Prediction"){
            if(!hasAccess(id))return send(msg.chat.id,"❌ No access!\n📩 "+ADMIN_HANDLE+"\nID: "+id);
            if(running[id])return send(msg.chat.id,"⚠️ Already running!");

            running[id]=true;
            sentPeriods[id]=new Set();
            autobetState[id]={
                level:1,
                consecutiveLoss:0,
                levelLossCount:0,
                waitingAction:null,
                waitingTarget:0,
                watchConsecutiveLosses:0,
                inMart:false,
                isWaiting:false,
                nextStartTime:null
            };
            resetPartState(id);

            const cfg=autobetCfg[id];
            await send(msg.chat.id,
"🚀 ENGINE ON!\n\nAutoBet: "+(cfg.enabled?"✅ ON":"❌ OFF")+"\nWatch  : "+(cfg.watch?"ON ("+cfg.watchLoss+"L)":"OFF")+"\nBase   : ₹"+cfg.baseBet+" | MaxLvl: "+cfg.maxLvl+"\n\n💡 Using 8-PART MASTERMIND ULTRA v10 ENGINE (Part1 → Part8 on 6 losses)"
            );
            runPredict(id,msg.chat.id);
        }
        if(text==="🛑 Stop")   {
            running[id]=false;
            clearUserTimers(id);
            autobetCfg[id] = autobetCfg[id] || {};
            autobetCfg[id].enabled = false;
            send(msg.chat.id,"🛑 Stopped.");
            // Aggressive memory cleanup
            delete sentPeriods[id];
            delete autobetState[id];
            delete stats[id];
            delete profitTrack[id];
            delete userPartState[id];
            if (global.gc) global.gc(); // Trigger GC if available
        }
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE+"\nID: "+id);
    });
}
startBot();
