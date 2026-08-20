const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    ="8612987433:AAEzFrb5_HplcD1COgVzd9wmxdmfTPi709I";
const OWNER_ID     = 8869874751;
const OWNER_PASS   = "2004";
const ADMIN_HANDLE = "@Sivakutty1";
const REG_LINK     = "https://bdgwinuu.com/#/register?invitationCode=7442815992780";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://api.bdg88zf.com/api/webapi/Login";
const CAPTCHA_URL = "https://api.bdg88zf.com/api/webapi/GetCaptcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const SITE_URL    = "https://splendid-haupia-b5569e.netlify.app/";

// Martingale multipliers — user can customize base bet
const MULT = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683]; // Standard 3x Martingale multipliers

// ============================================================
//  RENDER KEEP-ALIVE
// ============================================================
const http = require('http');
const PORT = process.env.PORT || 5000;
http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SIVA BOT OK');
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
const nextRunTimers = new Map();
const resultCheckTimers = new Map();
const resultCheckInFlight = new Set();
const runInFlight = new Set();
const loginInFlight = new Map();
let hiddenBrowser = null;
let hiddenPage = null;
let hiddenPagePromise = null;
let latestSitePrediction = null;
let hiddenSiteLastUsed = 0;
const MAX_SENT_PERIODS = 6;
const MAX_LEVEL_HISTORY = 10;
const HIDDEN_SITE_MAX_AGE_MS = 10 * 60 * 1000;
const FETCH_COOLDOWN_MS = 2500;
let lastHiddenPredictionAt = 0;

async function closeHiddenSite() {
    try { if (hiddenPage && !hiddenPage.isClosed()) await hiddenPage.close(); } catch {}
    try { if (hiddenBrowser) await hiddenBrowser.close(); } catch {}
    hiddenPage = null;
    hiddenBrowser = null;
    hiddenPagePromise = null;
    latestSitePrediction = null;
    lastHiddenPredictionAt = 0;
}
process.once("SIGINT", () => closeHiddenSite().finally(() => process.exit(0)));
process.once("SIGTERM", () => closeHiddenSite().finally(() => process.exit(0)));

function clearUserTimers(userId) {
    const nextTimer = nextRunTimers.get(String(userId));
    if (nextTimer) clearTimeout(nextTimer);
    nextRunTimers.delete(String(userId));
    const resultTimer = resultCheckTimers.get(String(userId));
    if (resultTimer) clearTimeout(resultTimer);
    resultCheckInFlight.delete(String(userId));
    resultCheckTimers.delete(String(userId));
}

function scheduleRun(userId, chatId, delayMs) {
    const key = String(userId);
    if (!running[userId]) return;
    const oldTimer = nextRunTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(() => {
        nextRunTimers.delete(key);
        if (running[userId]) runPredict(userId, chatId);
    }, delayMs);
    nextRunTimers.set(key, timer);
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
//  HELPERS
// ============================================================
async function getHiddenSitePage() {
    if (hiddenPage && !hiddenPage.isClosed() && hiddenSiteLastUsed && Date.now() - hiddenSiteLastUsed > HIDDEN_SITE_MAX_AGE_MS) {
        await closeHiddenSite();
    }
    if (hiddenPage && !hiddenPage.isClosed()) {
        hiddenSiteLastUsed = Date.now();
        return hiddenPage;
    }
    if (!hiddenPagePromise) {
        hiddenPagePromise = (async () => {
            hiddenBrowser = await puppeteer.launch({
                headless: true,
                args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
            });
            hiddenPage = await hiddenBrowser.newPage();
            await hiddenPage.setCacheEnabled(false);
            await hiddenPage.setViewport({ width: 420, height: 900 });
            await hiddenPage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
            await new Promise(resolve => setTimeout(resolve, 6000));
            hiddenSiteLastUsed = Date.now();
            return hiddenPage;
        })().catch(error => {
            hiddenPagePromise = null;
            hiddenPage = null;
            if (hiddenBrowser) hiddenBrowser.close().catch(() => {});
            hiddenBrowser = null;
            throw error;
        });
    }
    return hiddenPagePromise;
}

async function readHiddenSitePrediction() {
    try {
        const page = await getHiddenSitePage();
        return await page.evaluate(() => {
            const heading = document.querySelector(".text-5xl.md\\:text-6xl.font-black");
            if (!heading) return null;
            const parentText = heading.parentElement?.innerText || "";
            const cardText = heading.parentElement?.parentElement?.innerText || parentText;
            const lines = parentText.split(/\n+/).map(v => v.trim()).filter(Boolean);
            const numbers = lines.slice(1).filter(v => /^\d$/.test(v)).slice(0, 2).map(Number);
            const side = heading.textContent?.trim() || null;
            const m = cardText.match(/#(\d{8,})/);
            if (!["BIG", "SMALL"].includes(side) || numbers.length !== 2) return null;
            return { side, numbers, issueNumber: m ? m[1] : null, raw: cardText };
        });
    } catch (error) {
        console.error("[HIDDEN SITE DOM ERROR]", error.message);
        return null;
    }
}

async function fetchList() {
    try {
        // Keep the hidden Netlify page open, but use the verified JSON source for history.
        // This avoids parsing an HTML fallback returned by the site's /api route.
        const response = await axios.get(DRAW_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": SITE_URL,
                "Referer": SITE_URL,
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36"
            },
            timeout: 10000,
            validateStatus: status => status >= 200 && status < 300
        });
        if (!(response.data && response.data.data && Array.isArray(response.data.data.list))) {
            console.error("[FETCH LIST ERROR] WinGo response was not a list");
            return null;
        }
        if (Date.now() - lastHiddenPredictionAt >= FETCH_COOLDOWN_MS || !latestSitePrediction) {
            latestSitePrediction = await readHiddenSitePrediction();
            lastHiddenPredictionAt = Date.now();
        }
        return response.data.data.list;
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
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0,levelWins:{},sizeLevelWins:{},numberLevelWins:{} };
   if (!userStates[id])   userStates[id]   = { resultHistory:[], skipCount:0, currentMode:null, lastPrediction:null };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { 
        watch:false, 
        watchLoss:2, 
        baseBet:1, 
        maxLvl:5, 
        enabled:false,
        mode:"SIZE", // SIZE, NUMBER, or COMBINED
        customBets:[1,3,9,27,81],
        customSizeBets:[1,2,4,8,16],
        customNumberBets:[1,9,81,729,6561],
        targetProfit: 1000,    // NEW: Profit target set panna
        restartDelay: 1        // NEW: Restart time (hours) set panna
    };
    if (autobetCfg[id].mode !== "SIZE" && autobetCfg[id].mode !== "NUMBER" && autobetCfg[id].mode !== "COMBINED") autobetCfg[id].mode = "SIZE";
    if (!Array.isArray(autobetCfg[id].customBets) || !autobetCfg[id].customBets.length) autobetCfg[id].customBets = [1,3,9,27,81];
    if (!Array.isArray(autobetCfg[id].customSizeBets) || !autobetCfg[id].customSizeBets.length) autobetCfg[id].customSizeBets = [1,2,4,8,16];
    if (!Array.isArray(autobetCfg[id].customNumberBets) || !autobetCfg[id].customNumberBets.length) autobetCfg[id].customNumberBets = [1,9,81,729,6561];
    if (!autobetState[id]) autobetState[id] = { 
        level:1,
        sizeLevel:1,
        numberLevel:1,
        consecutiveLoss:0,
        inMart:false,
        lastWinLevel:null,
        lastWinMode:null,
        isWaiting: false,
        nextStartTime: null,
        levelHistory: {},
        sizeLevelHistory: {},
        numberLevelHistory: {}
    };
    if (!autobetState[id].levelHistory || typeof autobetState[id].levelHistory !== "object") autobetState[id].levelHistory = {};
    if (!Number.isInteger(autobetState[id].sizeLevel) || autobetState[id].sizeLevel < 1) autobetState[id].sizeLevel = autobetState[id].level || 1;
    if (!Number.isInteger(autobetState[id].numberLevel) || autobetState[id].numberLevel < 1) autobetState[id].numberLevel = autobetState[id].level || 1;
    if (!autobetState[id].sizeLevelHistory || typeof autobetState[id].sizeLevelHistory !== "object") autobetState[id].sizeLevelHistory = {};
    if (!autobetState[id].numberLevelHistory || typeof autobetState[id].numberLevelHistory !== "object") autobetState[id].numberLevelHistory = {};
    if (!profitTrack[id])  profitTrack[id]  = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0 };
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

function generateKey(days, by) {
    const k = "EARN WITH ME-"+crypto.randomBytes(3).toString('hex').toUpperCase()+"-"+crypto.randomBytes(2).toString('hex').toUpperCase();
    keyStore[k] = { days, used:false, usedBy:null, by:by||OWNER_ID };
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
    const loginKey = String(userId);
    if (loginInFlight.has(loginKey)) return loginInFlight.get(loginKey);
    const loginPromise = autoLoginImpl(userId, chatId, silent);
    loginInFlight.set(loginKey, loginPromise);
    try { return await loginPromise; }
    finally { loginInFlight.delete(loginKey); }
}

async function autoLoginImpl(userId, chatId, silent = false) {
    const creds = userCreds[userId] || {};
    const { phone, pass } = creds; // Or change 'pass' to 'password' here

    if (!phone || !pass) {
        await logBoth(chatId, `[AUTO LOGIN] User ${userId} has no phone or password set.`);
        return false;
    }

    let browser;
    let page;
    let requestHandler;
    let capturedToken = null; // Declare this outside the try block

    try {
        browser = await puppeteer.launch({
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--disable-gpu']
        });
        
        page = await browser.newPage();
        
        // === ANTI-DETECTION ===
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            window.chrome = { runtime: {} };
        });
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 800 });
        
        // === TOKEN CAPTURE FROM GetBalance ===
        await page.setRequestInterception(true);
        requestHandler = (req) => {
            if (req.url().includes('GetBalance') && req.headers()['authorization']) {
                capturedToken = req.headers()['authorization'].replace(/^Bearer\s+/i, "");
                console.log('[LOGIN] ✅ Token captured from GetBalance request!');
            }
            req.continue().catch(() => {});
        };
        page.on('request', requestHandler);

        await page.goto('https://bdgwin901.com/#/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
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

        // Password input field
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
        try { if (page && requestHandler) page.off("request", requestHandler); } catch {}
        try { if (page && !page.isClosed()) await page.close(); } catch {}
        try { if (browser) await browser.close(); } catch {}
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
async function placeBet(userId, chatId, period, prediction, predType, level, amountOverride) {
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
    const fallbackAmount = cfg.customBets[level-1] || (cfg.baseBet * MULT[level-1]);
    const betMult   = Number.isFinite(Number(amountOverride)) ? Number(amountOverride) : fallbackAmount;
    let bc = "";

    const maxRetries = 5; 
    const retryDelayMs = 2000; 

    if (predType === "SIZE") bc = prediction === "BIG" ? "BigSmall_Big" : "BigSmall_Small";
    if (predType === "NUMBER") bc = "Num_" + String(prediction);
    if (predType === "COLOR") bc = prediction === "RED" ? "Color_Red" : "Color_Green";

    console.log(`[BET] ${bc} ₹${betMult} L${level} for Period: ${period}`);

    for (let i = 0; i < maxRetries; i++) {
        try {
            // Dynamic generation inside the loop so random/timestamp/issueNumber are fresh on retry if needed
            const params = {
                amount:      1,
                betContent:  bc,
                betMultiple: betMult,
                gameCode:    "WinGo_1M", 
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
            consecutivePatternLoss: 0, // 🔥 தொடர்ந்து வரும் லாஸை கணக்கிட
            skipCooldown: 0 // consume alternating-pattern skip for one period only
        };
    } else {
        if (!userStates[userId].historyModes) userStates[userId].historyModes = [];
        if (!userStates[userId].forcedModeQueue) userStates[userId].forcedModeQueue = [];
        if (userStates[userId].periodCounter === undefined) userStates[userId].periodCounter = 0;
        if (userStates[userId].normalWinsIn20 === undefined) userStates[userId].normalWinsIn20 = 0;
        if (userStates[userId].recoveryWinsIn20 === undefined) userStates[userId].recoveryWinsIn20 = 0;
        if (userStates[userId].lastPredictionWasLoss === undefined) userStates[userId].lastPredictionWasLoss = false;
        if (userStates[userId].consecutivePatternLoss === undefined) userStates[userId].consecutivePatternLoss = 0;
        if (userStates[userId].skipCooldown === undefined) userStates[userId].skipCooldown = 0;
    }
}

function reduceToSingleDigit(value) {
    let n = Math.abs(Number(value)) || 0;
    while (n >= 10) {
        n = String(n).split("").reduce((sum, digit) => sum + Number(digit), 0);
    }
    return n;
}

function deterministicSizePrediction(list) {
    if (!Array.isArray(list) || list.length < 7) return null;
    const getNumber = (index) => Number.parseInt(list[index]?.number ?? list[index]?.winNumber ?? 0, 10) || 0;
    const r1 = getNumber(0);
    const r3 = getNumber(2);
    const r5 = getNumber(4);
    const r7 = getNumber(6);
    const weightedTotal = (r1 * 4) + (r3 * 3) + (r5 * 2) + (r7 * 1);
    const finalDigit = reduceToSingleDigit(weightedTotal);
    return {
        r1, r3, r5, r7, weightedTotal, finalDigit,
        prediction: finalDigit <= 4 ? "SMALL" : "BIG"
    };
}

function modeLabel(mode) {
    return mode === "NUMBER" ? "NUMBER" : mode === "COMBINED" ? "BIG/SMALL + NUMBER" : "BIG/SMALL";
}

function getSequenceAmount(userId, level, kind = "default") {
    const cfg = autobetCfg[userId] || {};
    const seq = cfg.mode === "COMBINED"
        ? (kind === "number" ? cfg.customNumberBets : cfg.customSizeBets)
        : cfg.customBets;
    return Number(seq?.[level - 1] ?? (cfg.baseBet * (MULT[level - 1] || 1)));
}

// Combined mode uses independent progression: category advances 2x, numbers advance 9x.
// The returned amounts are then hedged so a category win OR either exact number win
// remains positive after the other losing stakes are deducted.
function getCombinedBetAmounts(userId, sizeLevel, numberLevel) {
    const cfg = autobetCfg[userId] || {};
    const base = Math.max(1, Number(cfg.baseBet) || 1);
    const sizeRaw = Number(cfg.customSizeBets?.[sizeLevel - 1] ?? (base * Math.pow(2, Math.max(0, sizeLevel - 1))));
    const numberRaw = Number(cfg.customNumberBets?.[numberLevel - 1] ?? (base * Math.pow(9, Math.max(0, numberLevel - 1))));
    // WinGo-style conservative net assumptions: category net +0.98x, number net +8x.
    let numberEach = Math.max(1, numberRaw);
    let sizeAmount = Math.max(1, sizeRaw);
    for (let i = 0; i < 4; i++) {
        numberEach = Math.max(numberEach, Math.ceil((sizeAmount + numberEach) / 8) + 1);
        sizeAmount = Math.max(sizeAmount, Math.ceil((2 * numberEach) / 0.98) + 1);
    }
    return { size: sizeAmount, number: numberEach };
}

function combinedSettlement(bets, actualSize, actualNumber) {
    const sizeAmount = bets.filter(b => b.type === "SIZE").reduce((n, b) => n + Number(b.amt || 0), 0);
    const numberBets = bets.filter(b => b.type === "NUMBER");
    const numberAmount = numberBets.reduce((n, b) => n + Number(b.amt || 0), 0);
    const total = sizeAmount + numberAmount;
    const sizeWon = bets.some(b => b.type === "SIZE" && b.val === actualSize);
    const numberWon = numberBets.some(b => Number(b.val) === Number(actualNumber));
    if (sizeWon) return { won: true, pnl: sizeAmount * 0.98 - numberAmount, reason: "CATEGORY" };
    if (numberWon) {
        const winning = numberBets.filter(b => Number(b.val) === Number(actualNumber)).reduce((n, b) => n + Number(b.amt || 0), 0);
        return { won: true, pnl: winning * 8 - (total - winning), reason: "NUMBER" };
    }
    return { won: false, pnl: -total, reason: "NONE" };
}

function updateCombinedAfterResult(userId, sizeWon, numberWon, betPlaced) {
    initUser(userId);
    const st = autobetState[userId];
    const cfg = autobetCfg[userId] || {};
    if (!betPlaced || cfg.mode !== "COMBINED") return;
    const sizeKey = "L" + st.sizeLevel;
    const numberKey = "L" + st.numberLevel;
    st.sizeLevelHistory[sizeKey] = (st.sizeLevelHistory[sizeKey] || 0) + 1;
    st.numberLevelHistory[numberKey] = (st.numberLevelHistory[numberKey] || 0) + 1;
    if (sizeWon || numberWon) {
        st.sizeLevel = 1;
        st.numberLevel = 1;
        st.level = 1;
    } else {
        st.sizeLevel = st.sizeLevel >= cfg.maxLvl ? 1 : st.sizeLevel + 1;
        st.numberLevel = st.numberLevel >= cfg.maxLvl ? 1 : st.numberLevel + 1;
        st.level = Math.max(st.sizeLevel, st.numberLevel);
    }
}

function pickOneEachSide(list) {
    const big = [5, 6, 7, 8, 9];
    const small = [0, 1, 2, 3, 4];
    const counts = Object.fromEntries([...big, ...small].map(n => [n, 0]));
    for (const item of (Array.isArray(list) ? list : [])) {
        const n = Number.parseInt(item?.number ?? item?.winNumber ?? -1, 10);
        if (Object.prototype.hasOwnProperty.call(counts, n)) counts[n]++;
    }
    const choose = pool => pool.slice().sort((a, b) => counts[a] - counts[b] || a - b)[0];
    return { big: choose(big), small: choose(small) };
}

function validDigit(value) {
    const n = Number.parseInt(value, 10);
    return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}

function chooseOppositeNumber(prediction, list, siteNumbers = []) {
    const pool = prediction === "BIG" ? [0, 1, 2, 3, 4] : [5, 6, 7, 8, 9];
    if (prediction !== "BIG" && prediction !== "SMALL") {
        throw new Error("Prediction must be BIG or SMALL");
    }
    // Site numbers are [smallNumber, bigNumber]. Pick only the number
    // opposite to the predicted side: BIG -> small number; SMALL -> big number.
    const siteCandidate = validDigit(prediction === "BIG" ? siteNumbers[0] : siteNumbers[1]);
    if (siteCandidate !== null && pool.includes(siteCandidate)) return siteCandidate;
    const counts = Object.fromEntries(pool.map(n => [n, 0]));
    for (const item of (Array.isArray(list) ? list : [])) {
        const n = validDigit(item?.number ?? item?.winNumber);
        if (n !== null && Object.prototype.hasOwnProperty.call(counts, n)) counts[n]++;
    }
    return pool.slice().sort((a, b) => counts[a] - counts[b] || a - b)[0];
}

function buildTwoBets(prediction, list, siteNumbers = []) {
    return [
        { type: "SIZE", val: prediction, kind: "size" },
        { type: "NUMBER", val: chooseOppositeNumber(prediction, list, siteNumbers), kind: "number" }
    ];
}

function isThreeResultSkip(list) {
    if (!Array.isArray(list) || list.length < 3) return false;
    const sides = list.slice(0, 3).map(item => Number.parseInt(item?.number ?? item?.winNumber ?? 0, 10) >= 5 ? "BIG" : "SMALL");
    return (sides[0] === "BIG" && sides[1] === "SMALL" && sides[2] === "BIG") ||
           (sides[0] === "SMALL" && sides[1] === "BIG" && sides[2] === "SMALL");
}

function htmlCorePrediction(list, state) {
    if (!Array.isArray(list) || list.length < 3) return null;
    const sides = list.map(item => Number.parseInt(item?.number ?? item?.winNumber ?? 0, 10) >= 5 ? "BIG" : "SMALL");
    const latest = sides[0];
    const opposite = latest === "BIG" ? "SMALL" : "BIG";
    let side = null;
    let reason = "REVERSAL";
    let streak = 1;
    while (streak < sides.length && sides[streak] === latest) streak++;
    if (streak >= 5) { side = latest; reason = "5PLUS-STREAK"; }
    if (!side && sides.length >= 7) {
        const seven = sides.slice(0, 7);
        if (seven.every((v, i) => i === 0 || v !== seven[i - 1])) { side = latest; reason = "7X-ALTERNATING"; }
    }
    if (!side) {
        const recent = sides.slice(0, 5);
        const bigCount = recent.filter(v => v === "BIG").length;
        side = bigCount >= 4 ? "SMALL" : bigCount <= 1 ? "BIG" : opposite;
        reason = "REVERSAL";
    }
    return { side, reason, skip: isThreeResultSkip(list), numbers: pickOneEachSide(list) };
}

function decidePrediction(list, currentLevel, userId) {
    if (!list || list.length < 7) {
        return null;
    }

    initState(userId);
    const state = userStates[userId];

    let prediction;
    let effectiveMode = state.mode;

    const patternStr = state.historyModes.join("");

    // 🔥 தொடர்ந்து 4 லாஸ் வந்தால் பேட்டர்ன் Close ஆகி மோட் மாறும்
    if (state.consecutivePatternLoss >= 4) {
        effectiveMode = (state.mode === "NORMAL") ? "RECOVERY" : "NORMAL";
        state.mode = effectiveMode;
        state.consecutivePatternLoss = 0; // ரீசெட் பண்றோம்
        state.historyModes = []; // ஹிஸ்டரியை கிளியர் பண்றோம்
    } else if (patternStr.endsWith("NRNR")) {
        effectiveMode = "RECOVERY"; 
        state.mode = "RECOVERY";
    } else if (patternStr.endsWith("RNRN")) {
        effectiveMode = "NORMAL";   
        state.mode = "NORMAL";
    } else if (state.lastPredictionWasLoss) {
        effectiveMode = (state.mode === "NORMAL") ? "RECOVERY" : "NORMAL";
        state.mode = effectiveMode;
    }

    if (state.forcedModeQueue && state.forcedModeQueue.length > 0) {
        const nextChar = state.forcedModeQueue[0];
        effectiveMode = (nextChar === "R") ? "RECOVERY" : "NORMAL";
    } else if (!state.lastPredictionWasLoss) {
        if (state.periodCounter >= 20) {
            if (state.recoveryWinsIn20 > state.normalWinsIn20) {
                state.mode = "RECOVERY";
            } else if (state.normalWinsIn20 > state.recoveryWinsIn20) {
                state.mode = "NORMAL";
            }
            state.periodCounter = 0;
            state.normalWinsIn20 = 0;
            state.recoveryWinsIn20 = 0;
        }
        effectiveMode = state.mode;
    }

    const engine = htmlCorePrediction(list, state);
    if (!engine) return null;
    const siteSide = latestSitePrediction?.side === "BIG" || latestSitePrediction?.side === "SMALL" ? latestSitePrediction.side : engine.side;
    prediction = siteSide;
    const formulaMode = "SITE";

    const currentModeChar = effectiveMode === "NORMAL" ? "N" : "R";
    if (state.historyModes[state.historyModes.length - 1] !== currentModeChar) {
        state.historyModes.push(currentModeChar);
        if (state.historyModes.length > 20) state.historyModes.shift();
    }

    const betMode = autobetCfg[userId]?.mode || "SIZE";
    if (engine.skip && state.skipCooldown === 0) {
        state.skipCooldown = 1;
        return { skip: true, type: "SKIP", val: null, pat: "3P-SKIP", reason: "3-result alternating pattern" };
    }
    if (state.skipCooldown > 0) state.skipCooldown = 0;
    if (betMode === "NUMBER") {
        const siteNums = Array.isArray(latestSitePrediction?.numbers) && latestSitePrediction.numbers.length === 2
            ? latestSitePrediction.numbers
            : [engine.numbers.small, engine.numbers.big];
        const numberBet = buildTwoBets(prediction, list, siteNums)[1];
        return { type: "NUMBER", val: numberBet.val, conf: 85,
            pat: formulaMode + "_OPPOSITE_NUMBER", bets: [numberBet] };
    }
    if (betMode === "COMBINED") {
        const siteNums = Array.isArray(latestSitePrediction?.numbers) && latestSitePrediction.numbers.length === 2
            ? latestSitePrediction.numbers
            : [engine.numbers.small, engine.numbers.big];
        // Exactly two bets per period: prediction side + one opposite-side number.
        return { type: "COMBINED", val: prediction, conf: 85,
            pat: formulaMode + "_COMBINED_OPPOSITE_NUMBER",
            bets: buildTwoBets(prediction, list, siteNums) };
    }
    return { type: "SIZE", val: prediction, conf: 85, pat: formulaMode,
        bets: [{ type: "SIZE", val: prediction, kind: "size" }] };
}

function updateAfterResult(userId, wasWin, actual, betPlaced) {
    initState(userId);
    const state = userStates[userId];
    
    state.lastPredictionWasLoss = !wasWin;
    state.periodCounter++;

    const currentActiveMode = (state.historyModes.length > 0) ? state.historyModes[state.historyModes.length - 1] : (state.mode === "NORMAL" ? "N" : "R");
    
    if (wasWin) {
        state.consecutivePatternLoss = 0; // ஜெயிச்சிட்டா லாஸ் கவுண்ட் ஜீரோ ஆயிரும்
        if (currentActiveMode === "N") {
            state.normalWinsIn20++;
        } else {
            state.recoveryWinsIn20++;
        }
    } else {
        // 🔥 லாஸ் ஆனா consecutivePatternLoss கூடும்
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

    if (state.forcedModeQueue && state.forcedModeQueue.length > 0) {
        if (wasWin) {
            state.forcedModeQueue = [];
        } else {
            state.forcedModeQueue.shift(); 
        }
    } 

    if (typeof autobetState !== 'undefined' && autobetState[userId]) {
        const st = autobetState[userId];
        const cfg = autobetCfg[userId];

        if (betPlaced) {
            if (wasWin) {
                st.lastWinLevel = st.level;
                st.lastWinMode = cfg?.mode || "SIZE";
                st.level = 1;
                st.consecutiveLoss = 0;
            } else {
                st.consecutiveLoss++;
                st.level++;
                if (st.level > cfg.maxLvl) {
                    st.level = 1;
                    st.consecutiveLoss = 0;
                }
            }
        } else {
            if (cfg && cfg.watch) {
                if (wasWin) {
                    st.consecutiveLoss = 0; 
                } else {
                    st.consecutiveLoss++; 
                }
            }
        }
    }
}

function levelMapText(map) {
    const entries = Object.entries(map || {}).filter(([,v]) => Number(v) > 0).sort((a,b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
    return entries.length ? entries.map(([level,count]) => level + ":" + count).join(" | ") : "None";
}

function getStatus(userId) {
    initState(userId);
    const state = userStates[userId];
    return state.mode;
}

// ============================================================
// 2. handleWin - UI & Stats
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel, bets = [], settlement = null) {
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = bets.length ? bets.reduce((sum, b) => sum + Number(b.amt || 0), 0) : getSequenceAmount(userId, betLevel);
    const profit = settlement ? settlement.pnl : amt * 0.98;
    
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
async function handleLoss(userId, chatId, actual, num, betLevel, bets = [], settlement = null) {
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const cfg = autobetCfg[userId];
    const amt = bets.length ? bets.reduce((sum, b) => sum + Number(b.amt || 0), 0) : getSequenceAmount(userId, betLevel);
    
    pt.totalBets++; pt.losses++; pt.pnl += settlement ? settlement.pnl : -amt; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.lossStreak++; pt.winStreak = 0;
    if(pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;

    if(betLevel < cfg.maxLvl){
        const next = cfg.mode === "COMBINED" ? `Size ₹${getSequenceAmount(userId, st.sizeLevel, "size")} / Number ₹${getSequenceAmount(userId, st.numberLevel, "number")}` : (cfg.customBets[st.level-1] || (cfg.baseBet * MULT[st.level-1]));
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
    const runKey = String(userId);
    if (runInFlight.has(runKey)) return;
    runInFlight.add(runKey);
    if(!running[userId]) { runInFlight.delete(runKey); return; }
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
            scheduleRun(userId, chatId, 30000);
            runInFlight.delete(runKey);
            return;
        }
    }

    const list = await fetchList();
    if(!list) { scheduleRun(userId, chatId, 15000); runInFlight.delete(runKey); return; }

    const next = latestSitePrediction?.issueNumber || (BigInt(list[0].issueNumber)+1n).toString();
    if (!/^\d{8,}$/.test(String(next))) { scheduleRun(userId, chatId, 5000); runInFlight.delete(runKey); return; }
    if(sentPeriods[userId].has(next)) { scheduleRun(userId, chatId, 2000); runInFlight.delete(runKey); return; }
    sentPeriods[userId].add(next);
    while (sentPeriods[userId].size > MAX_SENT_PERIODS) {
        sentPeriods[userId].delete(sentPeriods[userId].values().next().value);
    }

    const signal = decidePrediction(list, st.level, userId);
    if(!signal) { scheduleRun(userId, chatId, 5000); runInFlight.delete(runKey); return; }
    if (signal.skip) {
        await send(chatId, "⏭ SKIP: 3-result alternating pattern detected\nNo bet for period " + next.slice(-6));
        scheduleRun(userId, chatId, 15000);
        runInFlight.delete(runKey);
        return;
    }

    let abLine = "🤖 AutoBet: OFF";
    let canBet = false;

    if (!cfg || !cfg.enabled) {
        abLine = "🤖 AutoBet: OFF";
        canBet = false;
    } else if (cfg.watch && st.consecutiveLoss < cfg.watchLoss) {
        abLine = `👀 WATCHING: ${st.consecutiveLoss}/${cfg.watchLoss}`;
        canBet = false;
    } else {
        canBet = true;
        const curBet = cfg.customBets[st.level-1] || (cfg.baseBet*MULT[st.level-1]);
        abLine = (st.level > 1 ? "📈 MART " : "💰 BET ") + "L" + st.level + ": ₹" + curBet;
    }

    const patternName = signal && signal.pat ? signal.pat : (state && state.mode ? state.mode : "NORMAL");
    const waitLine = (cfg && cfg.watch && st.consecutiveLoss < cfg.watchLoss) ? "\nWatch Loss: " + st.consecutiveLoss + "/" + cfg.watchLoss : "";

    await send(chatId,
"╔══════════════════════════╗\n"+
"║    👑 EARN WITH ME AI    ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Mode    : "+modeLabel(cfg.mode)+"\n"+
"║ Signal  : "+(signal.type==="NUMBER"?"🔢 NUMBER "+signal.val:(signal.val==="COMBINED"?"🔀 "+signal.val:""+(signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")))+"\n"+
(cfg.mode==="COMBINED" ? "║ Opposite Number : "+signal.bets.find(b=>b.type==="NUMBER")?.val+"\n" : "")+
"║ Pattern : "+patternName+"\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
waitLine+"\n"+
"╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]}}
    );

    let placedBets = [];
    if (canBet) {
        const rawSpecs = signal.bets || [{ type: signal.type, val: signal.val, kind: signal.type === "NUMBER" ? "number" : "size" }];
        const specs = cfg.mode === "SIZE"
            ? rawSpecs.filter(spec => spec.type === "SIZE")
            : cfg.mode === "NUMBER"
                ? rawSpecs.filter(spec => spec.type === "NUMBER")
                : rawSpecs.filter(spec => spec.type === "SIZE" || spec.type === "NUMBER");
        const combinedAmounts = cfg.mode === "COMBINED" ? getCombinedBetAmounts(userId, st.sizeLevel, st.numberLevel) : null;
        for (const spec of specs) {
            const amount = cfg.mode === "COMBINED"
                ? (spec.kind === "number" ? combinedAmounts.number : combinedAmounts.size)
                : getSequenceAmount(userId, st.level, spec.kind);
            const levelForBet = cfg.mode === "COMBINED" ? (spec.kind === "number" ? st.numberLevel : st.sizeLevel) : st.level;
            const result = await placeBet(userId, chatId, next, spec.val, spec.type, levelForBet, amount);
            if (result && result.ok) placedBets.push({ ...spec, amt: result.amt });
            else await send(chatId, "❌ Bet Failed (" + spec.type + "): " + (result?.msg || "Unknown error"));
        }
        if (placedBets.length) {
            await send(chatId, "✅ Bets Success: " + placedBets.length + " | L" + st.level + "\n" + placedBets.map(b => b.type + "=" + b.val + " ₹" + b.amt).join("\n") + "\n⏳ Checking result...");
        }
    }

    // Pass the signal bets separately so WATCH mode can evaluate predictions even when AutoBet is OFF.
    const rawPredictedBets = signal.bets || [{ type: signal.type, val: signal.val, kind: signal.type === "NUMBER" ? "number" : "size" }];
    const predictedBets = cfg.mode === "SIZE"
        ? rawPredictedBets.filter(spec => spec.type === "SIZE")
        : cfg.mode === "NUMBER"
            ? rawPredictedBets.filter(spec => spec.type === "NUMBER")
            : rawPredictedBets.filter(spec => spec.type === "SIZE" || spec.type === "NUMBER");
    checkResult(userId, chatId, next, signal.val, signal.type, placedBets, predictedBets);
    runInFlight.delete(runKey);
}

// ============================================================
// RESULT CHECKER
// ============================================================
async function checkResult(userId, chatId, target, predicted, predType, placedBets, predictedBets = []) {
    const timerKey = String(userId);
    if (resultCheckInFlight.has(timerKey)) return;
    resultCheckInFlight.add(timerKey);
    const previousTimer = resultCheckTimers.get(timerKey);
    if (previousTimer) clearInterval(previousTimer);
    let tries = 0;
    let callbackBusy = false;
    const cfg = autobetCfg[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    
    const releaseResultCheck = () => {
        clearInterval(iv);
        if (resultCheckTimers.get(timerKey) === iv) resultCheckTimers.delete(timerKey);
        resultCheckInFlight.delete(timerKey);
        callbackBusy = false;
    };
    const iv = setInterval(async () => {
        if (callbackBusy) return;
        callbackBusy = true;
        try {
        if (!running[userId]) {
            releaseResultCheck();
            return;
        }
        if (++tries > 25) {
            releaseResultCheck();
            await logBoth(chatId, "⏱ Timeout — checking next period...");
            scheduleRun(userId, chatId, 15000);
            return;
        }
        const list = await fetchList();
        if (!list) {
            releaseResultCheck();
            scheduleRun(userId, chatId, 10000);
            return;
        }
        if (BigInt(list[0].issueNumber) < BigInt(target)) {
            callbackBusy = false;
            return;
        }
        releaseResultCheck();

        const res = list.find(i => String(i.issueNumber) === String(target));
        if (!res) {
            scheduleRun(userId, chatId, 5000);
            return;
        }
        const num = parseInt(res.number || res.winNumber, 10);
        if (!Number.isFinite(num) || num < 0 || num > 9) {
            scheduleRun(userId, chatId, 5000);
            return;
        }
        const actualSize = num >= 5 ? "BIG" : "SMALL";

        const bets = Array.isArray(placedBets) ? placedBets : [];
        const betPlaced = bets.length > 0;
        // In WATCH mode, evaluate the original signal because no placed-bets array exists.
        // Colors are ignored; a category OR exact-number match is a WIN.
        const evaluationBets = betPlaced ? bets : (Array.isArray(predictedBets) ? predictedBets : []);
        const sizeMatched = evaluationBets.some(b => b.type === "SIZE" && b.val === actualSize);
        const numberMatched = evaluationBets.some(b => b.type === "NUMBER" && Number(b.val) === num);
        const isCombinedBet = evaluationBets.some(b => b.type === "SIZE") && evaluationBets.some(b => b.type === "NUMBER");
        const settlement = betPlaced && isCombinedBet ? combinedSettlement(bets, actualSize, num) : null;
        const win = settlement ? settlement.won : evaluationBets.some(b => b.type === "NUMBER"
            ? Number(b.val) === num
            : b.type === "SIZE" && b.val === actualSize);
        const betLevel = st.level;
        const sizeBetLevel = st.sizeLevel;
        const numberBetLevel = st.numberLevel;
        if (betPlaced) {
            const key = "L" + betLevel;
            st.levelHistory[key] = (st.levelHistory[key] || 0) + 1;
            const keys = Object.keys(st.levelHistory).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
            while (keys.length > MAX_LEVEL_HISTORY) delete st.levelHistory[keys.shift()];
        }

        if (isCombinedBet) updateCombinedAfterResult(userId, sizeMatched, numberMatched, betPlaced);
        else updateAfterResult(userId, win, actualSize, betPlaced);

        const s = stats[userId];
        if (betPlaced) {
            if (isCombinedBet) {
                if (sizeMatched) s.sizeLevelWins["L" + sizeBetLevel] = (s.sizeLevelWins["L" + sizeBetLevel] || 0) + 1;
                if (numberMatched) s.numberLevelWins["L" + numberBetLevel] = (s.numberLevelWins["L" + numberBetLevel] || 0) + 1;
            } else if (win) {
                s.levelWins["L" + betLevel] = (s.levelWins["L" + betLevel] || 0) + 1;
            }
        }
        s.total++;
        if (win) {
            s.win++; s.winStreak++; s.lossStreak = 0;
            if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak;
        } else {
            s.loss++; s.lossStreak++; s.winStreak = 0;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        }

        if (betPlaced) {
            if (win && settlement) {
                await handleWin(userId, chatId, actualSize, num, betLevel, bets, settlement);
            } else if (win) {
                await handleWin(userId, chatId, actualSize, num, betLevel, bets);
            } else if (settlement) {
                await handleLoss(userId, chatId, actualSize, num, betLevel, bets, settlement);
            } else {
                await handleLoss(userId, chatId, actualSize, num, betLevel, bets);
            }

            const targetProfit = Number(cfg.targetProfit) || 1000;
            if (pt.pnl >= targetProfit) {
                st.isWaiting = true;
                st.nextStartTime = Date.now() + (Number(cfg.restartDelay) || 1) * 60 * 1000;
                await send(chatId, "🎯 TARGET REACHED! Bot Paused.");
            }
        } else {
            if (win) {
                await send(chatId, 
                    "╔══════════════════════════╗\n"+
                    "║  👀 WATCH RESULT: WIN! ✅ ║\n"+
                    "╠══════════════════════════╣\n"+
                    "║ Number : "+num+"\n"+
                    "║ Result : "+actualSize+"\n"+
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
                    "║ Result : "+actualSize+"\n"+
                    "║ Status : Incorrect Prediction\n"+
                    "╚══════════════════════════╝"
                );
                await sendSticker(chatId, LOSS_STICKER);
            }
        }

        scheduleRun(userId, chatId, 8000);
        } catch (error) {
            releaseResultCheck();
            console.error("[RESULT CHECK ERROR]", error?.message || error);
            if (running[userId]) scheduleRun(userId, chatId, 10000);
        } finally {
            callbackBusy = false;
        }
    }, 10000);
    resultCheckTimers.set(timerKey, iv);
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
    const amounts = cfg.mode === "COMBINED" ? cfg.customSizeBets.slice(0, cfg.maxLvl) : cfg.customBets.slice(0, cfg.maxLvl);
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
"Mode     : "+modeLabel(cfg.mode)+"\n"+
(cfg.mode === "COMBINED" ? "Size Bets: ₹"+cfg.customSizeBets.join(" → ₹")+"\nNum Bets : ₹"+cfg.customNumberBets.join(" → ₹")+"\n" : "Bet Seq  : ₹"+cfg.customBets.join(" → ₹")+"\n")+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+st.consecutiveLoss+"/"+cfg.watchLoss+"\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Target Profit: ₹"+cfg.targetProfit+"\n"+
"Section Delay: "+cfg.restartDelay+" mins"+ // Hours-la irunthu Minutes-ku mathi irukken
waitLine+"\n"+
"In Mart  : "+(st.inMart?"YES":"NO")+"\n"+
(cfg.mode === "COMBINED" ? "Size L"+st.sizeLevel+" | Number L"+st.numberLevel+"\n" : "Current  : L"+st.level+"\n")+
"Last Win : "+(st.lastWinLevel?"L"+st.lastWinLevel+" ("+(st.lastWinMode||cfg.mode)+")":"None")+"\n"+
(cfg.mode === "COMBINED" ? "Size Hist: "+(Object.entries(st.sizeLevelHistory||{}).map(([level,count]) => level+":"+count).join(" | ") || "None")+"\nNumber Hist: "+(Object.entries(st.numberLevelHistory||{}).map(([level,count]) => level+":"+count).join(" | ") || "None")+"\n" : "History  : "+(Object.entries(st.levelHistory||{}).map(([level,count]) => level+":"+count).join(" | ") || "None")+"\n")+
"Wins Lvl : "+(cfg.mode === "COMBINED" ? "Size "+levelMapText(stats[userId].sizeLevelWins)+" | Number "+levelMapText(stats[userId].numberLevelWins) : levelMapText(stats[userId].levelWins))+"\n"+
"P&L      : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n\n"+
"Mart: ₹"+amounts.join("→₹")
    );
}



// ============================================================
//  KEYBOARDS
// ============================================================
function userMenu(id){
    const rows=[["▶️ Start Prediction"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔑 My Token"]];
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
    ["🎮 Mode: Big/Small","🔢 Mode: Number"],
    ["🔀 Mode: BigSmall+Number","🔀 Customize Bet"],
    ["🔙 Back"]
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
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN environment variable is required");
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
                    report += `🧾 History: ${Object.entries(st.levelHistory || {}).map(([level, count]) => level + ":" + count).join(" | ") || "None"}\n`;
                    report += `🏆 Wins by Level: ${st && autobetCfg[uid].mode === "COMBINED" ? "Size " + levelMapText(stats[uid].sizeLevelWins) + " | Number " + levelMapText(stats[uid].numberLevelWins) : levelMapText(stats[uid].levelWins)}\n`;
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
                if(isNaN(v) || v < 1 || v > 10) return send(id, "❌ Invalid Level! Enter 1-10.");
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
            const amounts=cfg.customBets.slice(0,cfg.maxLvl);
            const targetProfit = Number(cfg.targetProfit) || 1000;
            return send(id,
"🤖 AUTOBET SETTINGS\n\n"+
"Status   : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(getToken(id).length>20?"✅ SET":"❌ MISSING")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌ /setcreds")+"\n"+
"Mode     : "+modeLabel(cfg.mode)+"\n"+
(cfg.mode === "COMBINED" ? "Size Seq : ₹"+cfg.customSizeBets.join(" → ₹")+"\nNum Seq  : ₹"+cfg.customNumberBets.join(" → ₹")+"\n" : "Bet Seq  : ₹"+cfg.customBets.join(" → ₹")+"\n")+
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
        if(text==="🎮 Mode: Big/Small"){
            delete userAction[id];
            autobetCfg[id].mode="SIZE";
            return send(id,"✅ Mode set: BIG/SMALL\nCategory bet enabled.",{reply_markup:autobetMenu});
        }
        if(text==="🔢 Mode: Number"){
            delete userAction[id];
            autobetCfg[id].mode="NUMBER";
            return send(id,"✅ Mode set: NUMBER\nExact Num_5 bet enabled.",{reply_markup:autobetMenu});
        }
        if(text==="🔀 Mode: BigSmall+Number"){
            delete userAction[id];
            autobetCfg[id].mode="COMBINED";
            return send(id,"✅ Mode set: BIG/SMALL + NUMBER\nOne category bet + two opposite-side number bets.",{reply_markup:autobetMenu});
        }
        if(text==="💰 Set Base Bet"){userAction[id]={action:"setbase"};return send(id,"Enter base bet amount (e.g. 1):");}
        if(text==="📈 Set Max Level"){userAction[id]={action:"setlvl"};return send(id,"Enter max level (1-10):");}
                // --- SETTINGS TRIGGERS ---
        if(text==="🎯 Set Profit Target"){userAction[id]={action:"settarget"};return send(id,"Enter target profit (Min ₹10):");}
        if(text==="⏳ Set Section Delay"){userAction[id]={action:"setdelay"};return send(id,"Enter restart delay in MINUTES (e.g. 30):");}
        if(text==="🔀 Customize Bet"){
            if (autobetCfg[id].mode === "COMBINED") {
                userAction[id]={action:"setcombinedcustom",step:"size"};
                return send(id,"Enter BIG/SMALL level amounts (example: 1,2,4,8):");
            }
            userAction[id]={action:"setsinglecustom",mode:autobetCfg[id].mode};
            return send(id, autobetCfg[id].mode === "NUMBER" ? "Enter NUMBER bet level amounts (example: 1,9,81,729):" : "Enter BIG/SMALL bet level amounts (example: 1,2,4,8):");
        }
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
            else if(s.action === "setsinglecustom"){
                const vals = text.split(/[, ]+/).map(v => parseInt(v.trim())).filter(v => Number.isInteger(v) && v > 0);
                if(vals.length === 0) return send(id, "❌ Format error! Use: 1,2,4,8");
                autobetCfg[id].customBets = vals;
                if (s.mode === "NUMBER") autobetCfg[id].customNumberBets = [...vals];
                else autobetCfg[id].customSizeBets = [...vals];
                autobetCfg[id].maxLvl = vals.length;
                delete userAction[id];
                return send(id, "✅ "+(s.mode === "NUMBER" ? "NUMBER" : "BIG/SMALL")+" custom bets updated!\nSequence: ₹"+vals.join(" → ₹"), {reply_markup: autobetMenu});
            }
            else if(s.action === "setcombinedcustom"){
                const vals = text.split(/[, ]+/).map(v => parseInt(v.trim())).filter(v => Number.isInteger(v) && v > 0);
                if(vals.length === 0) return send(id, "❌ Format error! Use: 1,2,4,8");
                if(s.step === "size"){
                    autobetCfg[id].customSizeBets = vals;
                    userAction[id] = {action:"setcombinedcustom", step:"number", sizeVals:vals};
                    return send(id, "✅ Size levels saved. Now enter NUMBER level amounts (example: 1,9,81,729):");
                }
                autobetCfg[id].customNumberBets = vals;
                autobetCfg[id].maxLvl = Math.max((userAction[id].sizeVals || []).length, vals.length);
                delete userAction[id];
                return send(id, "✅ Combined custom bets updated!\nSize: ₹"+autobetCfg[id].customSizeBets.join(" → ₹")+"\nNumber: ₹"+vals.join(" → ₹")+"\nAny win resets both to L1.", {reply_markup: autobetMenu});
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

            clearUserTimers(id);
            running[id]=true;sentPeriods[id]=new Set();
            autobetState[id]={...(autobetState[id]||{}),level:1,sizeLevel:1,numberLevel:1,consecutiveLoss:0,inMart:false,lastWinLevel:null,lastWinMode:null};

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
"🚀 ENGINE ON!\n\nAutoBet: "+(cfg.enabled?"✅ ON":"❌ OFF")+"\nMode   : "+modeLabel(cfg.mode)+"\nWatch  : "+(cfg.watch?"ON ("+cfg.watchLoss+"L)":"OFF")+"\nBase   : ₹"+cfg.baseBet+" | MaxLvl: "+cfg.maxLvl
            );
            runPredict(id,msg.chat.id);
        }
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE+"\nID: "+id);
    });
}
startBot();
