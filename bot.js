const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');

// ============================================================
//  CONFIG
// ============================================================
const BOT_TOKEN    = process.env.BOT_TOKEN || "8670635800:AAEeDoWmav3IL5Pj19shmaSfTHNuLjaT9Lw";
const OWNER_ID     = 8869874751;
const OWNER_PASS   = process.env.OWNER_PASS || "2004";
const ADMIN_HANDLE = "@Sivakutty1";
const REG_LINK     = "https://13l.life/register?inviteCode=DDXKKFN&from=web07:33 AM";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://13llottery.com/api/Home/Login";
const CAPTCHA_URL = "https://13llottery.com/api/Home/Captcha";
const DRAW_URL    = "https://luciferapi.com/";

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
let userStates = {};
const predictionTimers = new Map();
const resultIntervals = new Map();

function schedulePrediction(userId, chatId, delayMs) {
    const key = String(userId);
    const old = predictionTimers.get(key);
    if (old) clearTimeout(old);
    const timer = setTimeout(() => {
        predictionTimers.delete(key);
        if (running[userId]) runPredict(userId, chatId).catch(err => console.error("[PREDICTION RETRY]", err?.message || err));
    }, Math.max(1000, Number(delayMs) || 5000));
    predictionTimers.set(key, timer);
    return timer;
}

function clearUserTimers(userId) {
    const key = String(userId);
    const predictionTimer = predictionTimers.get(key);
    if (predictionTimer) clearTimeout(predictionTimer);
    predictionTimers.delete(key);
    const resultInterval = resultIntervals.get(key);
    if (resultInterval) clearInterval(resultInterval);
    resultIntervals.delete(key);
}

function stopResultInterval(userId, interval) {
    const key = String(userId);
    if (resultIntervals.get(key) === interval) resultIntervals.delete(key);
    clearInterval(interval);
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
//  HTML PREVIEW-LEVEL DATA EXTRACTION HELPERS
// ============================================================
function luciferExtractData(json) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json.data)) return json.data;
    if (json && Array.isArray(json.data?.list)) return json.data.list;
    if (json && Array.isArray(json.results)) return json.results;
    if (json && Array.isArray(json.records)) return json.records;
    return null;
}

function luciferSortNewest(a) {
    return a.slice().sort((a, b) => {
        const ai = String(a?.issue ?? a?.issueNumber ?? a?.period ?? "");
        const bi = String(b?.issue ?? b?.issueNumber ?? b?.period ?? "");
        if (/^\d+$/.test(ai) && /^\d+$/.test(bi)) {
            if (ai.length !== bi.length) return bi.length - ai.length;
            return bi.localeCompare(ai);
        }
        return 0;
    });
}

// ============================================================
async function fetchList() {
    try {
        const response = await axios.get(DRAW_URL, {
            headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" },
            timeout: 10000
        });
        const payload = response.data || {};
        const arr = luciferExtractData(payload);
        if (!Array.isArray(arr) || arr.length === 0) {
            console.error("[LUCIFER API] Invalid 1-minute history response");
            return null;
        }

        const normalized = arr.map((x, i) => {
            if (typeof x === "string" || typeof x === "number") {
                return {
                    issueNumber: String(i),
                    number: Number(String(x).replace(/\D/g, "").slice(-1))
                };
            }
            const rawN = x.number ?? x.result ?? x.resultNumber ?? x.num ?? x.value ?? x.openNumber ?? x.winNumber;
            const rawI = x.issue ?? x.issueNumber ?? x.period ?? x.periodNumber ?? x.id ?? i;
            const numStr = String(rawN ?? "").replace(/\D/g, "").slice(-1);
            return {
                issueNumber: String(rawI),
                number: /^[0-9]$/.test(numStr) ? Number(numStr) : NaN,
                size: String(x.size || ((/^[0-9]$/.test(numStr) && Number(numStr) >= 5) ? "BIG" : "SMALL")).toUpperCase(),
                color: String(x.color || "").toUpperCase(),
                openTime: x.openTime,
                timestamp: x.timestamp
            };
        }).filter(row =>
            /^\d+$/.test(row.issueNumber) &&
            Number.isInteger(row.number) && row.number >= 0 && row.number <= 9
        );

        return luciferSortNewest(normalized).map(row => ({
            ...row,
            size: row.size && row.size !== "UNDEFINED" ? row.size : (row.number >= 5 ? "BIG" : "SMALL")
        }));
    } catch (error) {
        console.error("[LUCIFER API ERROR]", error.message);
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

    const baseUrl = "https://api.ar-lottery01.com/api/Lottery/GetBalance";
    const signedParams = buildBalanceSignedParams();
    const queryString = new URLSearchParams(signedParams).toString();
    const url = baseUrl + "?" + queryString;

    const headers = {
        "Authorization": "Bearer " + token,
        "Ar-Origin": "https://13lwin19.com",
        "Origin": "https://13lwin19.com",
        "Referer": "https://13lwin19.com/",
        "Accept": "application/json, text/plain, */*",
        "Sec-Ch-Ua": '"Chromium";v="139"',
        "Sec-Ch-Ua-Mobile": "?1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
    };

    try {
        const r = await axios.get(url, { headers, timeout: 5000 });
        return await parseBalanceResponse(r);
    } catch (e) {
        if (e.response && e.response.status === 405) {
            try {
                const signedParams2 = buildBalanceSignedParams();
                const queryString2 = new URLSearchParams(signedParams2).toString();
                const url2 = baseUrl + "?" + queryString2;
                const r2 = await axios.post(url2, signedParams2, { headers, timeout: 5000 });
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
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0,levelStats:{} };
    if (!stats[id].levelStats || typeof stats[id].levelStats !== "object") stats[id].levelStats = {};
   if (!userStates[id])   userStates[id]   = { resultHistory:[], skipCount:0, currentMode:null, lastPrediction:null };
    if (!sentPeriods[id])  sentPeriods[id]  = new Set();
    if (!autobetCfg[id])   autobetCfg[id]   = { 
        watch:false, 
        watchLoss:2, 
        baseBet:1, 
        maxLvl:5, 
        enabled:false, 
        customBets:[1,3,9,27,81],
        targetProfit: 1000,    // NEW: Profit target set panna
        restartDelay: 1        // NEW: Restart time (hours) set panna
    };
    if (!autobetState[id]) autobetState[id] = { 
        level:1, 
        consecutiveLoss:0, 
        inMart:false,
        isWaiting: false,      // NEW: Bot waiting-la irukka-nu check panna
        nextStartTime: null    // NEW: Thirumba eppo start aakanum-nu store panna
    };
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

function makeBalanceSign(params) {
    const p = {...params};
    delete p.signature; delete p.timestamp;
    const keys = Object.keys(p).filter(k => {
        const v = p[k];
        if (v === null || v === undefined || v === "") return false;
        if (typeof v === 'object') return false;
        return true;
    }).sort();
    const sorted = {};
    keys.forEach(k => { sorted[k] = p[k] === 0 ? 0 : p[k]; });
    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex').toUpperCase().slice(0, 32);
}

function buildBalanceSignedParams() {
    const params = {
        language: "en",
        random:   Math.floor(Math.random() * 1e12)
    };
    const signature = makeBalanceSign(params);
    const timestamp = Math.floor(Date.now() / 1000);
    return {...params, signature, timestamp};
}

// ============================================================
//  FETCH CAPTCHA
// ============================================================
async function fetchCaptcha() {
    try {
        const r = await axios.get(CAPTCHA_URL, {
            headers: {
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://13lwin19.com",
                "Referer": "https://13lwin19.com",
                "Ar-Origin": "https://13lwin19.com",
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

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true, 
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--single-process', '--disable-gpu']
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

        await page.goto('https://13llottery.com/login', { waitUntil: 'domcontentloaded', timeout: 90000 });
        await page.waitForSelector('input', { timeout: 30000 });
        const inputs = await page.$$('input');
        if (inputs.length < 2) throw new Error("Login inputs not found");

        await inputs[0].type(phone, { delay: 50 });
        await inputs[1].type(pass, { delay: 50 });
        
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
            // Success: Update token only when captured
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
        if (browser) await browser.close();

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
    const betMult   = cfg.customBets[level-1] || (cfg.baseBet * MULT[level-1]);
    let bc = "";

    const maxRetries = 3; 
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
                    "Authorization":    "Bearer " + token,
                    "authorization":    "Bearer " + token,
                    "content-type":     "application/json",
                    "Accept":           "application/json, text/plain, */*",
                    "Origin":           "https://13lwin19.com",
                    "Referer":          "https://13lwin19.com/",
                    "Ar-Origin":        "https://13lwin19.com",
                    "Sec-Ch-Ua":        '"Chromium";v="139"',
                    "Sec-Ch-Ua-Mobile": "?1",
                    "Sec-Fetch-Dest":   "empty",
                    "Sec-Fetch-Mode":   "cors",
                    "Sec-Fetch-Site":   "cross-site",
                    "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
                },
                timeout: 15000,
                validateStatus: () => true
            });

            const d = r.data || {};
            console.log(`[BET RESP] http:${r.status} code:${d.code} msg:${d.msg || d.message || ""}`);

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
// ============================================================
//  STATE AND HISTORY HELPERS
// ============================================================
function initState(userId) {
    initUser(userId);
    if (!userStates[userId]) {
        userStates[userId] = { resultHistory: [], skipCount: 0, currentMode: null, mode: "NORMAL", history: [], lastPrediction: null };
    }
    const state = userStates[userId];
    if (!Array.isArray(state.resultHistory)) state.resultHistory = [];
    if (!Array.isArray(state.history)) state.history = [];
    if (state.mode !== "NORMAL" && state.mode !== "RECOVERY") state.mode = "NORMAL";
    if (typeof state.skipCount !== "number") state.skipCount = 0;
    if (state.currentMode === undefined) state.currentMode = null;
    if (state.lastPrediction === undefined) state.lastPrediction = null;
    if (state.currentMode !== "SAME" && state.currentMode !== "OPPOSITE") state.currentMode = null;
}

function sizeOf(row) {
    const raw = String(row?.size ?? row?.bigSmall ?? row?.type ?? "").toUpperCase();
    if (raw === "BIG" || raw === "B") return "B";
    if (raw === "SMALL" || raw === "S") return "S";
    const number = Number.parseInt(row?.number ?? row?.winNumber ?? row?.result ?? "", 10);
    return Number.isInteger(number) && number >= 5 ? "B" : Number.isInteger(number) ? "S" : null;
}

function nextIssueNumber(list) {
    const latest = Array.isArray(list) ? list[0]?.issueNumber : null;
    if (latest === null || latest === undefined || !/^\d+$/.test(String(latest))) return null;
    try { return (BigInt(String(latest)) + 1n).toString(); }
    catch { return null; }
}

function buildBSFromList(list, count = 15) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, count).map(row => sizeOf(row) || (Number(row.number) >= 5 ? "B" : "S")).reverse();
}

function updateAfterResult(userId, wasWin, actualSize, betPlaced, usedMode) {
    initState(userId);
    const state = userStates[userId];
    const st = autobetState[userId];
    const cfg = autobetCfg[userId];
    const bs = actualSize === "BIG" || actualSize === "B" ? "B" : "S";
    state.resultHistory.push(bs);
    if (state.resultHistory.length > 50) state.resultHistory.shift();

    // Exact source NORMAL/RECOVERY pattern history: every resolved
    // prediction is recorded; only Martingale state depends on betPlaced.
    {
        state.history.push(wasWin ? "W" : "L");
        const histStr = state.history.join(",");
        const isRecoveryPattern = histStr.endsWith("W,W,L") ||
            histStr.endsWith("W,W,W,L") || /(L,L,L,L+)/.test(histStr);
        const isNormalPattern = histStr.endsWith("W,L") ||
            /(W,W,W,W+),L$/.test(histStr);

        if (isRecoveryPattern || isNormalPattern) {
            if (state.mode === "RECOVERY" && wasWin) state.mode = "NORMAL";
            else if (isRecoveryPattern) state.mode = "RECOVERY";
            else state.mode = "NORMAL";
            state.history = [];
            console.log(`[PATTERN] ${state.mode} pattern matched; history cleared`);
        }
        if (state.history.length > 10) state.history.shift();
    }

    // Watch/failed-bet results must not alter martingale state.
    if (!betPlaced) return;

    // A placed-bet win resets the martingale sequence to level 1.
    if (wasWin) {
        st.consecutiveLoss = 0;
        st.inMart = false;
        st.level = 1;
        state.skipCount = 0;
        state.currentMode = state.mode === "RECOVERY" ? "OPPOSITE" : "SAME";
        return;
    }

    // A placed-bet loss advances exactly one level.
    st.consecutiveLoss = (Number(st.consecutiveLoss) || 0) + 1;
    st.inMart = true;
    const maxLevel = Math.max(1, Number(cfg.maxLvl) || 1);
    const currentLevel = Math.max(1, Number(st.level) || 1);

    // Do not repeat the last custom-bet amount forever. Once the maximum
    // level loses, close that martingale cycle and start again from L1.
    if (currentLevel >= maxLevel) {
        st.level = 1;
        st.consecutiveLoss = 0;
        st.inMart = false;
    } else {
        st.level = currentLevel + 1;
    }

    // Mirror source mode in the existing target-state field.
    state.currentMode = state.mode === "RECOVERY" ? "OPPOSITE" : "SAME";
}

function getStatus(userId) {
    initState(userId);
    const state = userStates[userId];
    const st = autobetState[userId];
    return `${state.currentMode || "SAME"} MODE | L${st?.level || 1} | History: ${state.resultHistory.join("")}`;
}

// Legacy SAME/OPPOSITE prediction engine removed.

//  RESULT HANDLERS — required by checkResult()
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel) {
    initUser(userId);
    const cfg = autobetCfg[userId] || {};
    const pt = profitTrack[userId];
    const st = autobetState[userId];
    const amount = Number(cfg.customBets?.[Math.max(0, Number(betLevel) - 1)] ?? cfg.baseBet ?? 0) || 0;
    const profit = amount * 0.90;
    pt.totalBets = (pt.totalBets || 0) + 1;
    pt.wins = (pt.wins || 0) + 1;
    pt.pnl = (pt.pnl || 0) + profit;
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amount;
    pt.winStreak = (pt.winStreak || 0) + 1;
    pt.lossStreak = 0;
    pt.maxW = Math.max(pt.maxW || 0, pt.winStreak);
    await send(chatId, "✅ BET RESULT: WIN\nNumber: " + num + "\\nResult: " + actual + "\\nProfit: +₹" + profit.toFixed(2) + "\\nP&L: ₹" + pt.pnl.toFixed(2));
    await sendSticker(chatId, WIN_STICKER);
}

async function handleLoss(userId, chatId, actual, num, betLevel) {
    initUser(userId);
    const cfg = autobetCfg[userId] || {};
    const pt = profitTrack[userId];
    const st = autobetState[userId];
    const amount = Number(cfg.customBets?.[Math.max(0, Number(betLevel) - 1)] ?? cfg.baseBet ?? 0) || 0;
    pt.totalBets = (pt.totalBets || 0) + 1;
    pt.losses = (pt.losses || 0) + 1;
    pt.pnl = (pt.pnl || 0) - amount;
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amount;
    pt.lossStreak = (pt.lossStreak || 0) + 1;
    pt.winStreak = 0;
    pt.maxL = Math.max(pt.maxL || 0, pt.lossStreak);
    await send(chatId, "❌ BET RESULT: LOSS\nNumber: " + num + "\\nResult: " + actual + "\\nLoss: -₹" + amount.toFixed(2) + "\\nP&L: ₹" + pt.pnl.toFixed(2));
    await sendSticker(chatId, LOSS_STICKER);
}

// ============================================================
// EXACT FORMULA PREDICTION LOGIC
// next period last 3 digits × exp(current result)
// 0-4 = SMALL, 5-9 = BIG; OPPOSITE mode reverses the signal.
// ============================================================
function formulaPredict(list, userId) {
    if (!list || list.length < 2) {
        return null;
    }

    initState(userId);
    const state = userStates[userId];
    const sourceMode = state.mode;

    // ═════════════════════════════════════════════════════════════════════
    //  L3+: FORCED WIN
    // ═════════════════════════════════════════════════════════════════════
    


    // ═════════════════════════════════════════════════════════════════════
    //  L1-L2: NORMAL OR RECOVERY MODE
    // ═════════════════════════════════════════════════════════════════════

    const currentPeriod = String(list[0].issueNumber);
    const currentResult = parseInt(list[0].number || list[0].winNumber || 0);


// Previous result 0னா prediction வேண்டாம்
if (currentResult === 0) {
    return null;
}

    // STEP 1: Calculate next period
    const nextPeriodNum = BigInt(currentPeriod) + 1n;
    const nextPeriod = nextPeriodNum.toString();
    const nextLast3Num = parseInt(nextPeriod.slice(-3));

    // STEP 2: Calculate: NEXT_LAST_3 × exp(CURRENT_RESULT)
    const answer = nextLast3Num * Math.exp(currentResult);

    // STEP 3: Get 14 digits (remove decimal, take first 14)
    const answerStr = answer.toString();
    const noDecimal = answerStr.replace('.', '');
    const first14 = noDecimal.substring(0, 14);

    // STEP 4: Get last digit
    const lastDigit = parseInt(first14.charAt(first14.length - 1));

    // STEP 5: Apply logic based on MODE
    let prediction = lastDigit <= 4 ? 'SMALL' : 'BIG';

    // RECOVERY மோட்ல மட்டும் ஆப்போசிட் பண்ணுவோம்
    if (sourceMode === 'RECOVERY') {
        prediction = (prediction === 'SMALL') ? 'BIG' : 'SMALL';
    }

    return { 
        type: 'SIZE', 
        val: prediction, 
        conf: 90, 
        pat: sourceMode,
        mode: sourceMode === "RECOVERY" ? "OPPOSITE" : "SAME",
        calculation: `(${nextLast3Num} × exp(${currentResult})) → ${lastDigit} → ${prediction}` 
    };
}

//  PREDICT LOOP
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
function stk(arr, key) {
    let count = 1;
    let val = arr[0]?.[key];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i][key] === val) count++;
        else break;
    }
    return { val, count };
}

function sourceShouldBet(userId) {
    initState(userId);
    const state = userStates[userId];
    if (!state.history || state.history.length === 0) return false;
    const histStr = state.history.join(",");
    const isRecoveryPattern = histStr.endsWith("W,W,L") ||
        histStr.endsWith("W,W,W,L") || /(L,L,L,L+)/.test(histStr);
    const isNormalPattern = histStr.endsWith("W,L") ||
        /(W,W,W,W+),L$/.test(histStr);
    return state.mode === "RECOVERY" || isRecoveryPattern || isNormalPattern;
}

async function runPredict(userId, chatId) {
    if(!running[userId]) return;
    initUser(userId);
    const state = userStates[userId];
    const st = autobetState[userId];
    const cfg = autobetCfg[userId];

    // Profit Target Check
    if (st.isWaiting) {
        if (Date.now() >= st.nextStartTime) {
            st.isWaiting = false;
            profitTrack[userId].pnl = 0; 
            await send(chatId, "🔄 Timed Restart! Starting new section...");
        } else {
            return schedulePrediction(userId, chatId, 60000);
        }
    }

    const list = await fetchList();
    if(!list) return schedulePrediction(userId, chatId, 15000);

    const next = nextIssueNumber(list);
    if (!next || BigInt(next) <= BigInt(list[0].issueNumber)) return schedulePrediction(userId, chatId, 5000);
    if(sentPeriods[userId].has(next)) return schedulePrediction(userId, chatId, 2000);
    sentPeriods[userId].add(next);

    // Live decision uses the exact source formula and source mode patterns.
    const signal = formulaPredict(list, userId);
    if (!signal) {
        await send(chatId, "⏭️ SKIP — No matching BIG/SMALL pattern with 60% confidence.");
        return schedulePrediction(userId, chatId, 5000);
    }
    signal.calculationMode = signal.mode;
    signal.calculationConfidence = signal.confidence;
    signal.predictionDetails = { liveDecision: "exact-formula", calculation: signal.calculation };
    console.log(`[FORMULA LIVE] ${signal.val} mode=${signal.mode} ${signal.calculation}`);
    state.lastPrediction = signal.val;
    // Snapshot the level used for this prediction before any result update.
    // The martingale state is the single source of truth for the level.
    // Never reset the displayed/bet level based on NORMAL or RECOVERY mode.
    const maxLevel = Math.max(1, Math.min(10, Number(cfg.maxLvl) || 1));
    const predictionLevel = Math.max(1, Math.min(maxLevel, Number(st.level) || 1));

    // Only the explicit AutoBet toggle controls whether a bet is sent.
    // `running[userId]` remains the master emergency stop.
    const canBet = cfg.enabled === true && sourceShouldBet(userId);
    const effectiveLevel = predictionLevel;
    const curBet = Number(cfg.customBets[effectiveLevel - 1] || (cfg.baseBet * MULT[effectiveLevel - 1]) || 0);
    const abLine = (canBet ? "💰 BET " : "👀 WATCH ") + "L" + effectiveLevel + ": ₹" + curBet;

    // User-facing prediction box: expose only the period, signal and active level.
    // All calculation/model details remain server-side in logs and internal state.
    await send(chatId,
"╔══════════════════════════╗\n"+
"║   👑 EARN WITH ME AI    ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Signal  : "+(signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")+"\n"+
"║ Level   : L"+effectiveLevel+"\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
"╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]}}
    );

    let betPlaced = false;
    if (canBet) { 
        const result = await placeBet(userId, chatId, next, signal.val, signal.type, effectiveLevel);
        if (result && result.ok) {
            betPlaced = true;
            await send(chatId, "✅ Bet placed successfully | L" + effectiveLevel + "\n⏳ Checking result...");
        } else if (result && !result.ok) {
            await send(chatId, "❌ Bet Failed: " + (result.msg || "Unknown error"));
        }
    }

    checkResult(userId, chatId, next, signal.val, signal.type, betPlaced, signal.mode, effectiveLevel);
}
// ============================================================
//  RESULT CHECKER
// ============================================================


// 4. checkResult - Robust Update & Full UI
async function checkResult(userId, chatId, target, predicted, predType, betPlaced, usedMode, predictionLevel) {
    const timerKey = String(userId);
    if (resultIntervals.has(timerKey)) return;
    let tries = 0;
    const cfg = autobetCfg[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    
    const iv = setInterval(async () => {
        if (!running[userId]) return stopResultInterval(userId, iv);
        if (++tries > 25) {
            stopResultInterval(userId, iv);
            await logBoth(chatId, "⏱ Timeout — checking next period...");
            schedulePrediction(userId, chatId, 3000);
            return;
        }
        const list = await fetchList(); if (!list) return;
        if (BigInt(list[0].issueNumber) < BigInt(target)) return;
        stopResultInterval(userId, iv);

        const res = list.find(i => i.issueNumber === target) || list[0];
        const num = parseInt(res.number || res.winNumber || 0);
        let actual;
        if (predType === "SIZE") actual = num >= 5 ? "BIG" : "SMALL";
        else actual = num === 0 ? "RED" : num === 5 ? "GREEN" : num % 2 === 0 ? "RED" : "GREEN";
        
        const win = predicted === actual;
        // Use the level shown with this prediction, even when AutoBet is OFF or the bet fails.
        const maxBetLevel = Math.max(1, Math.min(10, Number(cfg.maxLvl) || 1));
        const betLevel = Math.max(1, Math.min(maxBetLevel, Number(predictionLevel) || Number(st.level) || 1));

        // Keep the mode after a win; switch SAME <-> OPPOSITE after a loss.
        updateAfterResult(userId, win, actual, betPlaced, usedMode);

        const s = stats[userId];
        s.total++;
        // Count every resolved prediction by its displayed level. This is
        // intentionally independent of betPlaced, so normal predictions,
        // watch predictions, and failed bets are all included.
        if (!s.levelStats[betLevel]) s.levelStats[betLevel] = { predictions: 0, wins: 0, losses: 0 };
        s.levelStats[betLevel].predictions++;
        if (win) s.levelStats[betLevel].wins++;
        else s.levelStats[betLevel].losses++;
        if (win) {
            s.win++; s.winStreak++; s.lossStreak = 0;
            if (s.winStreak > s.maxWinStreak) s.maxWinStreak = s.winStreak;
        } else {
            s.loss++; s.lossStreak++; s.winStreak = 0;
            if (s.lossStreak > s.maxLossStreak) s.maxLossStreak = s.lossStreak;
        }

        if (betPlaced) {
            // BET RESULT DASHBOARD
            if (win) await handleWin(userId, chatId, actual, num, betLevel);
            else await handleLoss(userId, chatId, actual, num, betLevel);

            // Profit Check
            const targetProfit = Number(cfg.targetProfit) || 1000;
            if (pt.pnl >= targetProfit) {
                st.isWaiting = true;
                st.nextStartTime = Date.now() + (Number(cfg.restartDelay) || 1) * 60 * 1000;
                await send(chatId, "🎯 TARGET REACHED! Bot Paused.");
            }
        } else {
            // WATCH RESULT DASHBOARD (Full details as requested)
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

        schedulePrediction(userId, chatId, 8000);
    }, 10000);
    resultIntervals.set(timerKey, iv);
}


// ============================================================
//  STATS
// ============================================================
function showStats(chatId,userId){
    initUser(userId);
    const d=stats[userId], rate=d.total?((d.win/d.total)*100).toFixed(1):"0.0";
    const bar="🟦".repeat(d.total?Math.round(d.win/d.total*10):0)+"⬜".repeat(d.total?10-Math.round(d.win/d.total*10):10);
    const observedLevels = Object.keys(d.levelStats || {}).map(Number).filter(Number.isFinite);
    const maxLevel = observedLevels.length ? Math.max(...observedLevels) : 1;
    const levelLines = [];
    for (let level = 1; level <= maxLevel; level++) {
        const x = d.levelStats[level] || { predictions: 0, wins: 0, losses: 0 };
        const wins = Number(x.wins) || 0;
        const losses = Number(x.losses) || 0;
        const predictions = Number(x.predictions) || (wins + losses);
        levelLines.push(`L${level}: ${wins}W / ${losses}L (${predictions} predictions)`);
    }
    send(chatId,
        "📊 STATS\n\n"+
        "Total: "+d.total+"\nWins: "+d.win+"\nLosses: "+d.loss+"\nAcc: "+rate+"%\n"+bar+"\n\n"+
        "🏆 LEVEL WINS\n"+levelLines.join("\n")+"\n\n"+
        "Current Mode: "+(userStates[userId]?.currentMode || "L1 START")+"\n"+
        "Best Win: "+d.maxWinStreak+" streak\nWorst Loss: "+d.maxLossStreak+" streak"
    );
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
        if(text==="📈 Set Max Level"){userAction[id]={action:"setlvl"};return send(id,"Enter max level (1-10):");}
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

            clearUserTimers(id);
            running[id]=true;sentPeriods[id]=new Set();
            autobetState[id]={level:1,consecutiveLoss:0,inMart:false,isWaiting:false,nextStartTime:null};
            initState(id);
            userStates[id].currentMode=null;
            userStates[id].lastPrediction=null;

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
        if(text==="🛑 Stop")   {running[id]=false;clearUserTimers(id);send(msg.chat.id,"🛑 Stopped.");}
        if(text==="📊 Stats")  showStats(msg.chat.id,id);
        if(text==="💰 Profit") profitReport(msg.chat.id,id);
        if(text==="📩 Contact") send(msg.chat.id,"📩 "+ADMIN_HANDLE+"\nID: "+id);
    });
}
startBot();
