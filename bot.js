const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');
const fs          = require('fs');

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    = process.env.BOT_TOKEN || "8999335291:AAFgHVTbDpWHlq2bscIbkiw6cs08CATeQpQ"
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
    if (!userStates[id])   userStates[id]   = { resultHistory:[], currentMode:null, lastPrediction:null };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { 
        watch:false, 
        watchLoss:2, 
        baseBet:1, 
        maxLvl:15, 
        enabled:false, 
        customBets:[1,3,9,27,81,243,729,2187,6561,19683,59049,177147,531441,1594323,4782969],
        targetProfit: 1000,    // NEW: Profit target set panna
        restartDelay: 1        // NEW: Restart time (hours) set panna
    };
    if (!autobetState[id]) autobetState[id] = { 
        level:1, 
        consecutiveLoss:0, 
        levelLossCount:0,
        waitingAction: null,
        waitingTarget: 0,
        watchConsecutiveLosses: 0,
        inMart:false,
        isWaiting: false,      // NEW: Bot waiting-la irukka-nu check panna
        nextStartTime: null    // NEW: Thirumba eppo start aakanum-nu store panna
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
    keyStore = persistentData.keyStore;
    usersAccess = persistentData.usersAccess;
}
function savePersistentData() {
    try {
        const current = fs.existsSync("bot_data.json") ? JSON.parse(fs.readFileSync("bot_data.json","utf8")||"{}") : {};
        // Merge known persistent stores
        current.keyStore      = keyStore                    || {};
        current.usersAccess   = usersAccess                 || {};
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
// ============================================================
// COMPLETE BOT LOGIC WITH 4-PREDICTION PATTERN MODE EXTENSION & FIXES
// ============================================================
// ============================================================
// COMPLETE BOT LOGIC WITH STRICT 4-CONSECUTIVE LOSS REQUIREMENT (NO WINS ALLOWED)
// ============================================================
let userStates = {};

function buildBSFromList(list, count = 15) {
    if (!list || !Array.isArray(list)) return [];
    const sliced = list.slice(0, count);
    const resultHistory = [];

    for (let i = sliced.length - 1; i >= 0; i--) {
        const item = sliced[i];
        const num = parseInt(item.number || item.winNumber || 0);
        const size = num >= 5 ? "BIG" : "SMALL";
        resultHistory.push(size);
    }
    return resultHistory;
}

function initState(userId) {
    if (!userStates[userId]) {
        userStates[userId] = {
            mode: "NORMAL",
            pendingPrediction: true,
            forcedModeQueue: [],
            historyModes: [],
            periodCounter: 0,
            normalWinsIn20: 0,
            recoveryWinsIn20: 0,
            lastPredictionWasLoss: false,
            consecutivePatternLoss: 0,
            predictionOutcomes: [],
            resultSizeHistory: [],
            // patternStats and dangerPatterns storage disabled
            c4Active: false,
            c5Triggered: false,
                awaitingSamePair: false,
                alt4Active: false,
                ababActive: false,
            lastDecisionSource: null,
            lastLossLevel: 0,
            l5RecoveryMode: false,
            waitingForDouble: false
        };
    } else {
        if (!userStates[userId].historyModes) userStates[userId].historyModes = [];
        if (!userStates[userId].forcedModeQueue) userStates[userId].forcedModeQueue = [];
        if (userStates[userId].periodCounter === undefined) userStates[userId].periodCounter = 0;
        if (userStates[userId].normalWinsIn20 === undefined) userStates[userId].normalWinsIn20 = 0;
        if (userStates[userId].recoveryWinsIn20 === undefined) userStates[userId].recoveryWinsIn20 = 0;
        if (userStates[userId].lastPredictionWasLoss === undefined) userStates[userId].lastPredictionWasLoss = false;
        if (userStates[userId].consecutivePatternLoss === undefined) userStates[userId].consecutivePatternLoss = 0;
        if (userStates[userId].predictionOutcomes === undefined) userStates[userId].predictionOutcomes = [];
        if (userStates[userId].resultSizeHistory === undefined) userStates[userId].resultSizeHistory = [];
        // patternStats/dangerPatterns intentionally not initialized — storage disabled
        // skip counters removed
        if (userStates[userId].c4Active === undefined) userStates[userId].c4Active = false;
        if (userStates[userId].c5Triggered === undefined) userStates[userId].c5Triggered = false;
        if (userStates[userId].awaitingSamePair === undefined) userStates[userId].awaitingSamePair = false;
        if (userStates[userId].alt4Active === undefined) userStates[userId].alt4Active = false;
        if (userStates[userId].ababActive === undefined) userStates[userId].ababActive = false;
        if (userStates[userId].lastDecisionSource === undefined) userStates[userId].lastDecisionSource = null;
        if (userStates[userId].lastLossLevel === undefined) userStates[userId].lastLossLevel = 0;
        if (userStates[userId].l5RecoveryMode === undefined) userStates[userId].l5RecoveryMode = false;
        if (userStates[userId].waitingForDouble === undefined) userStates[userId].waitingForDouble = false;
    }
}

function getLevelRequirement(level) {
    const safeLevel = Math.max(1, Math.min(LEVEL_REQUIREMENTS.length, Number(level) || 1));
    return LEVEL_REQUIREMENTS[safeLevel - 1] || 1;
}

function getNormalPrediction(sizes) {
    if (!sizes || !sizes.length) return "SMALL";
    const bigCount = sizes.filter(size => size === "BIG").length;
    return bigCount >= 3 ? "BIG" : "SMALL";
}

function getOppositePrediction(value) {
    return value === "BIG" ? "SMALL" : "BIG";
}

function isAlternating4Pattern(sizes) {
    if (!sizes || sizes.length < 4) return false;
    const last4 = sizes.slice(-4).map(v => v === 'BIG' ? 'B' : 'S').join('');
    return last4 === 'BSBS' || last4 === 'SBSB';
}

function isAlternating(sizes, minLen = 4) {
    if (!sizes || sizes.length < minLen) return false;
    // Ensure the sequence alternates for the provided slice
    for (let i = 1; i < sizes.length; i++) {
        if (sizes[i] === sizes[i - 1]) return false;
    }
    return true;
}

function hasTripleInLastFive(numbers) {
    if (!numbers || numbers.length < 3) return null;
    const last5 = numbers.slice(-5);
    const counts = {};
    for (const num of last5) {
        if (typeof num !== 'number' || Number.isNaN(num)) continue;
        counts[num] = (counts[num] || 0) + 1;
        if (counts[num] >= 3) return num;
    }
    return null;
}

function buildPatternKeys(sizes) {
    const seq = (sizes || []).slice(-12).map(v => (v === 'BIG' || v === 'B' || v === 1 ? 'B' : 'S'));
    const keys = [];
    for (let len = 4; len <= Math.min(6, seq.length); len++) {
        keys.push(seq.slice(-len).join(''));
    }
    return keys;
}

function getPatternPrediction(patternKey) {
    if (!patternKey) return 'SMALL';
    const bigCount = patternKey.split('').filter(v => v === 'B').length;
    return bigCount >= Math.ceil(patternKey.length / 2) ? 'BIG' : 'SMALL';
}

function findDangerPattern(state, patternKeys) {
    // Deprecated: pattern danger lookup disabled.
    return null;
}

function findBestWinPattern(state, patternKeys) {
    // Deprecated: pattern memory disabled.
    return null;
}

function updatePatternMemory(userId, sizeHistory, wasWin) {
    // Deprecated: no-op to remove pattern memory.
    return;
}

function decidePrediction(list, currentLevel, userId) {
    if (!list || list.length < 2) {
        return null;
    }

    initState(userId);
    const state = userStates[userId];

    if (state.waitingForDouble) {
        return {
            type: "SKIP",
            val: "SKIP",
            pat: "WAIT_DOUBLE",
            reason: "WAITING_FOR_BB_SS"
        };
    }

    // Evaluate skip and danger logic in priority order before normal prediction:
    // 1. persistent danger pair skip (last-two numeric results with count>=3)
    // 2. danger patterns from patternStats
    // 3. L5 recovery high win pattern prediction
    // 4. C5 loss streak strategy
    // 5. alternating ABAB/BABA wait logic
    // 6. C4 pattern reversal logic
    // 7. pending ALT4_WAIT state (waiting for same last pair)
    // 8. any active skipRemaining countdown
    // 9. C1 violet/repeated number skip
    // 10. C2 triple same number in last 5 skip
    // 11. C3 BBBSSS/SSSBBB skip wait
    // 12. finally, NORMAL prediction
    const recentItems = list.slice(0, 10).reverse();
    const numbers = recentItems.map(item => parseInt(item.number || item.winNumber || 0));
    const sizes = numbers.map(num => num >= 5 ? "BIG" : "SMALL");
    // prepare commonly used slices and a normal prediction even when we later skip
    const last5Sizes = sizes.slice(-5);
    const last6Sizes = sizes.slice(-6);
    const last4Sizes = sizes.slice(-4);
    const last2Sizes = sizes.slice(-2);
    const latestResult = last5Sizes[last5Sizes.length - 1] || "SMALL";
    const normalPrediction = getNormalPrediction(last5Sizes);

    // Persistent danger/pair/triple logic removed. Proceed to normal checks only.
    const violetCount = numbers.slice(-5).filter(num => num === 0 || num === 5).length;
    const repeatedNumber = hasTripleInLastFive(numbers);
    const c3Trigger = last6Sizes.length >= 6 && (last6Sizes.join("") === "BBBSSS" || last6Sizes.join("") === "SSSBBB");
    const c4Trigger = last4Sizes.length >= 4 && (last4Sizes.join("") === "BSBS" || last4Sizes.join("") === "SBSB");
    const alternating4WaitTrigger = isAlternating4Pattern(last4Sizes); // ABAB or BABA pattern
    const sameLastPair = last2Sizes.length === 2 && last2Sizes[0] === last2Sizes[1];
    const recentOutcomes = (state.predictionOutcomes || []).slice(-5);
    const c5Trigger = recentOutcomes.length === 5 && recentOutcomes.every(outcome => outcome === "LOSS");
    const patternKeys = buildPatternKeys(sizes);
    const highWinPattern = null; // pattern memory disabled

    // NOTE: dangerousPattern checks removed. Only persistent
    // last-two-number pairs (persistentData.dangerPairs) are treated
    // as danger. Pattern-derived danger (state.dangerPatterns) is
    // intentionally ignored per updated rule.

    // L5 recovery pattern logic disabled (pattern memory removed)

    // C5 logic simplified: don't force skip, continue normal prediction

    // ABAB and ALT4 logic removed per user request (No ABAB rule)
    state.ababActive = false;
    state.alt4Active = false;

    // Apply 9-level rule mapping: map any level into 1..9
    const mappedLevel = ((Number(currentLevel) - 1) % 9) + 1;
    let predictedVal = normalPrediction;
    const prev = latestResult || normalPrediction;

    // L5, L7, L8 — Exact Rule Implementation
    if (mappedLevel === 5 || mappedLevel === 7 || mappedLevel === 8) {
        // Step 1: Check latest 5 actual results for BSBSB or SBSBS
        const patternStr = last5Sizes.map(s => s === "BIG" ? "B" : "S").join("");
        const isAlternatingPattern = (patternStr === "BSBSB" || patternStr === "SBSBS");

        if (isAlternatingPattern) {
            // Rule: Prediction = OPPOSITE of latest result
            predictedVal = getOppositePrediction(prev);
        } else {
            // Rule: Normal level rule (L5, L7, and L8 are all OPPOSITE)
            predictedVal = getOppositePrediction(prev);
        }
    } else {
        // L1-L4, L6, L9: Normal level rule (SAME)
        predictedVal = prev;
    }

    state.lastDecisionSource = `L${mappedLevel}`;
    return {
        type: "SIZE",
        val: predictedVal,
        conf: 85,
        pat: `L${mappedLevel}`,
        reason: `LEVEL_${mappedLevel}`
    };
}

function updateAfterResult(userId, wasWin, actual, betPlaced, betLevel) {
    initState(userId);
    const state = userStates[userId];
    
    const isSkip = actual === null;
    state.lastPredictionWasLoss = isSkip ? false : !wasWin;
    state.periodCounter++;

    if (!isSkip && typeof actual !== 'undefined') {
        const sizeVal = actual === 'BIG' || actual === 'SMALL' ? actual : (actual >= 5 ? 'BIG' : 'SMALL');
        state.resultSizeHistory.push(sizeVal);
        if (state.resultSizeHistory.length > 18) state.resultSizeHistory.shift();
        
        // Clear waitingForDouble if BB or SS appears
        if (state.waitingForDouble) {
            const last2 = state.resultSizeHistory.slice(-2).map(s => s === 'BIG' ? 'B' : 'S').join('');
            if (last2 === 'BB' || last2 === 'SS') {
                state.waitingForDouble = false;
            }
        }
        
        updatePatternMemory(userId, state.resultSizeHistory, wasWin);
    }

    if (isSkip) {
        return;
    }
    const outcome = wasWin ? "WIN" : "LOSS";
    state.predictionOutcomes.push(outcome);
    if (state.predictionOutcomes.length > 5) {
        state.predictionOutcomes.shift();
    }

    if (state.lastDecisionSource === "C4") {
        if (wasWin) {
            state.c4Active = true;
        } else {
            state.c4Active = false;
        }
    } else if (state.lastDecisionSource === "C5") {
        state.c5Triggered = false;
        state.c4Active = false;
    } else if (state.lastDecisionSource === "SKIP") {
        state.c4Active = false;
    } else if (state.lastDecisionSource === "ALT4_ACTIVE" || state.alt4Active) {
        // ALT4 active: clear mode on a loss (handled below in result handling)
        // keep c4Active off
        state.c4Active = false;
    }

    if (isSkip) {
        return;
    }

    const currentActiveMode = (state.historyModes.length > 0) ? state.historyModes[state.historyModes.length - 1] : (state.mode === "NORMAL" ? "N" : "R");
    
    if (wasWin) {
        state.consecutivePatternLoss = 0;
        
        // Detect win on alternating pattern (BSBSB or SBSBS)
        const last5 = state.resultSizeHistory.slice(-5).map(s => s === 'BIG' ? 'B' : 'S').join('');
        if (last5 === 'BSBSB' || last5 === 'SBSBS') {
            state.waitingForDouble = true;
        }

        if (currentActiveMode === "N") {
            state.normalWinsIn20++;
        } else {
            state.recoveryWinsIn20++;
        }
    } else {
        state.consecutivePatternLoss++;

        if (state.mode === "NORMAL") {
            state.mode = "RECOVERY";
            state.historyModes.push("R");
        } else {
            state.mode = "NORMAL";
            state.historyModes.push("N");
        }
        if (state.historyModes.length > 20) {
            state.historyModes.shift();
        }
    }

    if (typeof autobetState !== 'undefined' && autobetState[userId]) {
        const st = autobetState[userId];
        const cfg = autobetCfg[userId];

        // ABAB follow logic removed per user request
        if (betPlaced && wasWin) {
            st.level = 1;
            st.consecutiveLoss = 0;
            st.levelLossCount = 0;
            st.waitingAction = null;
            st.waitingTarget = 0;
            st.watchConsecutiveLosses = 0;
            state.lastLossLevel = 0;
            state.l5RecoveryMode = false;
            return false;
        }

        if (betPlaced && !wasWin) {
            const currentRule = getLevelRule(betLevel);
            const nextLevel = getNextLevel(betLevel, cfg.maxLvl);
            st.level = nextLevel;
            st.levelLossCount = 0;
            state.lastLossLevel = betLevel;
            state.l5RecoveryMode = betLevel === 5;

            if (currentRule.type === 'watch') {
                st.waitingAction = 'watch';
                st.waitingTarget = currentRule.lossesRequired;
                st.watchConsecutiveLosses = 0;
            } else if (currentRule.type === 'skip') {
                // 'skip' rule removed: treat as immediate waitingAction with target but without skip counter
                st.waitingAction = 'watch';
                st.waitingTarget = currentRule.skipPeriods;
                st.watchConsecutiveLosses = 0;
            } else {
                st.waitingAction = null;
                st.waitingTarget = 0;
                st.watchConsecutiveLosses = 0;
            }

            if (cfg && cfg.watch) {
                st.consecutiveLoss = (st.consecutiveLoss || 0) + 1;
            }

            if (st.level >= 15) {
                return true;
            }
            return false;
        }

        if (st.waitingAction === 'watch') {
            if (wasWin) {
                st.watchConsecutiveLosses = 0;
            } else {
                st.watchConsecutiveLosses = (st.watchConsecutiveLosses || 0) + 1;
            }
            if (st.watchConsecutiveLosses >= st.waitingTarget) {
                st.waitingAction = null;
                st.waitingTarget = 0;
                st.watchConsecutiveLosses = 0;
            }
        } else if (cfg && cfg.watch) {
            if (wasWin) {
                st.consecutiveLoss = 0;
            } else {
                st.consecutiveLoss = (st.consecutiveLoss || 0) + 1;
            }
        }
    }

    // If ALT4 active mode was running, clear it on a loss (stop when one loss occurs)
    // ALT4 reset logic removed per user request

    return false;
}

function getStatus(userId) {
    initState(userId);
    const state = userStates[userId];
    return state.mode;
}

// ============================================================
// 2. handleWin - UI & Stats
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel) {
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = getBetAmount(userId, betLevel);
    const profit = amt * 0.98;
    if (autobetState && autobetState[userId]) {
        autobetState[userId].level = 1;
    }
    
    pt.totalBets++; pt.wins++; pt.pnl += profit; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.winStreak++; pt.lossStreak = 0;
    if(pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;

    await send(chatId,
"╔══════════════════════════╗\n"+
"║  ✅ WIN! 🎉              ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
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
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = getBetAmount(userId, betLevel);
    
    pt.totalBets++; pt.losses++; pt.pnl -= amt; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.lossStreak++; pt.winStreak = 0;
    if(pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;

    if(st.level >= 15){
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  🛑 L15 LOSS — BOT STOPPED ║\n"+
"╠══════════════════════════╣\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Status : AutoBet stopped.\n"+
"╚══════════════════════════╝"
        );
    } else if(betLevel < (cfg.maxLvl || 15)){
        const next = getBetAmount(userId, st.level);
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  ❌ LOSS                 ║\n"+
"╠══════════════════════════╣\n"+
"║ Number : "+num+"\n"+
"║ Result : "+actual+"\n"+
"║ Loss   : -₹"+amt+"\n"+
"║ P&L    : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"╠══════════════════════════╣\n"+
"║ Next L"+st.level+" : ₹"+next+"\n"+
"╚══════════════════════════╝"
        );
    } else {
        await send(chatId,
"╔══════════════════════════╗\n"+
"║  💀 MAX LEVEL LOSS       ║\n"+
"╠══════════════════════════╣\n"+
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
function parseItem(item) {
    const n = +(item.number || item.winNumber || 0);
    return {
        n,
        size: n >= 5 ? "BIG" : "SMALL",
        color:
            n === 0 ? "RED" :
            n === 5 ? "GREEN" :
            n % 2 === 0 ? "RED" : "GREEN"
    };
}

async function runPredict(userId, chatId) {
    if(!running[userId]) return;
    initUser(userId);
    const state = userStates[userId];
    const st = autobetState[userId];
    const cfg = autobetCfg[userId];

    if (st.isWaiting) {
        if (Date.now() >= st.nextStartTime) {
            st.isWaiting = false;
            profitTrack[userId].pnl = 0; 
            await send(chatId, "🔄 Timed Restart! Starting new section...");
        } else {
            return setTimeout(()=>runPredict(userId,chatId), 30000);
        }
    }

    const list = await fetchList();
    if(!list) return setTimeout(()=>runPredict(userId,chatId), 15000);

    const next = (BigInt(list[0].issueNumber)+1n).toString();
    if(sentPeriods[userId].has(next)) return setTimeout(()=>runPredict(userId,chatId), 2000);
    sentPeriods[userId].add(next);
    if (sentPeriods[userId].size > 50) {
        const firstItem = sentPeriods[userId].values().next().value;
        sentPeriods[userId].delete(firstItem);
    }

    const signal = decidePrediction(list, st.level, userId);
    if(!signal) return setTimeout(()=>runPredict(userId,chatId), 5000);

    const waitingDueToLevel = st.waitingAction === 'watch';
    const isWaitDouble = signal.type === "SKIP" && signal.pat === "WAIT_DOUBLE";

    let abLine = "🤖 AutoBet: OFF";
    let canBet = false;
    let waitLine = "";

    if (isWaitDouble) {
        abLine = "⏳ WAITING FOR BB/SS";
        waitLine = "\nSkip: Alternating Win";
        canBet = false;
    } else if (!cfg || !cfg.enabled) {
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

    const patternName = signal && signal.pat ? signal.pat : (state && state.mode ? state.mode : "NORMAL");

    await send(chatId,
"╔══════════════════════════╗\n"+
"║    👑 EARN WITH ME AI    ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Signal  : "+(signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")+"\n"+
"║ Pattern : "+patternName+"\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
waitLine+"\n"+
"╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]}}
    );

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

        const shouldStopBot = updateAfterResult(userId, win, actual, betPlaced, betLevel);

        // maintain numeric history for user state (last numbers)
        initState(userId);
        if (!userStates[userId].resultNumberHistory) userStates[userId].resultNumberHistory = [];
        userStates[userId].resultNumberHistory.push(num);
        if (userStates[userId].resultNumberHistory.length > 20) userStates[userId].resultNumberHistory.shift();

        // If the result was a loss, record the last-three-number triple
        // for danger tracking. This happens when a bet was placed OR when
        // the decision originated from a skip-related reason (so skipped
        // predictions still contribute to dangerTriples).
        // Removed persistent danger/pair recording; no action needed on loss.

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

            if (shouldStopBot) {
                running[userId] = false;
                await send(chatId, "🛑 L15 loss reached — AutoBet stopped.");
            }
        } else {
            if (win) {
                await send(chatId, 
                    "╔══════════════════════════╗\n"+
                    "║  👀 WATCH RESULT: WIN! ✅ ║\n"+
                    "╠══════════════════════════╣\n"+
                    "║ Number : "+num+"\n"+
                    "║ Result : "+actual+"\n"+
                    "║ Status : Correct Prediction\n"+
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, WIN_STICKER);
            } else {
                await send(chatId, 
                    "╔══════════════════════════╗\n"+
                    "║  👀 WATCH RESULT: LOSS ❌ ║\n"+
                    "╠══════════════════════════╣\n"+
                    "║ Number : "+num+"\n"+
                    "║ Result : "+actual+"\n"+
                    "║ Status : Incorrect Prediction\n"+
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, LOSS_STICKER);
            }
        }

        setTimeout(() => { if (running[userId]) runPredict(userId, chatId); }, 8000);
    };
    setTimeout(poll, 10000);
}

module.exports = { decidePrediction, updateAfterResult, getStatus, initState, buildBSFromList, runPredict, checkResult };

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
    ["📝 Set Custom Bets","🔙 Back"]
],resize_keyboard:true};

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

        if(text==="🔙 Back")return await send(id,"Main Menu",{reply_markup:userMenu(id)});

        if(text==="🔑 My Token"){
            const tok=getToken(id),creds=userCreds[id]||{};
            return send(id,"Token: "+(tok.length>20?"✅ ..."+tok.slice(-12):"❌")+"\nLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌")+"\n\n/setcreds FULLPHONE PASSWORD\n/setmytoken TOKEN\n/login — Test");
        }

      if(text==="▶️ Start Prediction"){
            if(!hasAccess(id))return send(msg.chat.id,"❌ No access!\n📩 "+ADMIN_HANDLE+"\nID: "+id);
            if(running[id])return send(msg.chat.id,"⚠️ Already running!");

            running[id]=true;sentPeriods[id]=new Set();
            autobetState[id]={
                level:1,
                consecutiveLoss:0,
                levelLossCount:0,
                waitingAction:null,
                waitingTarget:0,
                watchConsecutiveLosses:0,
                inMart:false
            };

            // Load previous B/S history from API
            const prevList = await fetchList();
            initState(id);

            if (prevList && prevList.length >= 4) {
                // Build B/S history
                userStates[id].resultHistory = buildBSFromList(prevList, 15);
                await send(msg.chat.id, "📋 Loaded history: " + (userStates[id].resultHistory || []).join(''));


            }

            const cfg=autobetCfg[id];
            await send(msg.chat.id,
"🚀 ENGINE ON!\n\nAutoBet: "+(cfg.enabled?"✅ ON":"❌ OFF")+"\nWatch  : "+(cfg.watch?"ON ("+cfg.watchLoss+"L)":"OFF")+"\nBase   : ₹"+cfg.baseBet+" | MaxLvl: "+cfg.maxLvl
            );
            runPredict(id,msg.chat.id);
        }
        if(text==="🛑 Stop")   {
            running[id]=false;
            send(msg.chat.id,"🛑 Stopped.");
            // Aggressive memory cleanup
            delete sentPeriods[id];
            delete userStates[id];
            delete autobetState[id];
            delete stats[id];
            delete profitTrack[id];
            if (global.gc) global.gc(); // Trigger GC if available
        }
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE+"\nID: "+id);
    });
}
startBot();
