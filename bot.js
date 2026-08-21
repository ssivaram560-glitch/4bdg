const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');

// ============================================================
//  CONFIG
// ============================================================
// WARNING: These credentials were shared in chat and should be rotated after deployment.
const BOT_TOKEN    = "8801907570:AAGfHiS5fg9joWuxHCPXew-IsfPIJhEtwQE";
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
const LUCIFER_API = "https://luciferapi.com/";

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
    }, 14 * 60 * 1000).unref?.();
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
let userStates     = {};
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
const MAX_SENT_PERIODS = 6;

function initState(userId) {
    const id = String(userId);
    if (!userStates[id]) {
        userStates[id] = {
            mode: "NORMAL", pendingPrediction: true, forcedModeQueue: [],
            historyModes: [], periodCounter: 0, normalWinsIn20: 0,
            recoveryWinsIn20: 0, lastPredictionWasLoss: false,
            consecutivePatternLoss: 0, skipCooldown: 0,
            resultHistory: [], lastLuciferPrediction: null
        };
    } else {
        const state = userStates[id];
        if (!Array.isArray(state.historyModes)) state.historyModes = [];
        if (!Array.isArray(state.forcedModeQueue)) state.forcedModeQueue = [];
        if (!Number.isInteger(state.periodCounter)) state.periodCounter = 0;
        if (!Number.isInteger(state.normalWinsIn20)) state.normalWinsIn20 = 0;
        if (!Number.isInteger(state.recoveryWinsIn20)) state.recoveryWinsIn20 = 0;
        if (typeof state.lastPredictionWasLoss !== "boolean") state.lastPredictionWasLoss = false;
        if (!Number.isInteger(state.consecutivePatternLoss)) state.consecutivePatternLoss = 0;
        if (!Number.isInteger(state.skipCooldown)) state.skipCooldown = 0;
        if (!Array.isArray(state.resultHistory)) state.resultHistory = [];
    }
    return userStates[id];
}

function initUser(id) {
    const key = String(id);
    if (!stats[key]) stats[key] = { total:0, win:0, loss:0, lossStreak:0, winStreak:0, maxWinStreak:0, maxLossStreak:0, levelWins:{}, sizeLevelWins:{}, numberLevelWins:{} };
    initState(key);
    if (!sentPeriods[key]) sentPeriods[key] = new Set();
    if (!autobetCfg[key]) autobetCfg[key] = { watch:false, watchLoss:2, baseBet:1, maxLvl:5, enabled:false, mode:"SIZE", customBets:[1,3,9,27,81], customSizeBets:[1,2,4,8,16], customNumberBets:[1,9,81,729,6561], targetProfit:1000, restartDelay:1 };
    if (!["SIZE","NUMBER","COMBINED"].includes(autobetCfg[key].mode)) autobetCfg[key].mode = "SIZE";
    if (!Array.isArray(autobetCfg[key].customBets) || !autobetCfg[key].customBets.length) autobetCfg[key].customBets = [1,3,9,27,81];
    if (!Array.isArray(autobetCfg[key].customSizeBets) || !autobetCfg[key].customSizeBets.length) autobetCfg[key].customSizeBets = [1,2,4,8,16];
    if (!Array.isArray(autobetCfg[key].customNumberBets) || !autobetCfg[key].customNumberBets.length) autobetCfg[key].customNumberBets = [1,9,81,729,6561];
    if (!autobetState[key]) autobetState[key] = { level:1, sizeLevel:1, numberLevel:1, consecutiveLoss:0, inMart:false, lastWinLevel:null, lastWinMode:null, isWaiting:false, nextStartTime:null, levelHistory:{}, sizeLevelHistory:{}, numberLevelHistory:{} };
    if (!profitTrack[key]) profitTrack[key] = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount:0 };
}

function clearUserTimers(userId) {
    const key = String(userId);
    const nextTimer = nextRunTimers.get(key);
    if (nextTimer) clearTimeout(nextTimer);
    nextRunTimers.delete(key);

    const resultTimer = resultCheckTimers.get(key);
    if (resultTimer) clearTimeout(resultTimer);
    resultCheckTimers.delete(key);
    resultCheckInFlight.delete(key);
    runInFlight.delete(key);
}

function scheduleRun(userId, chatId, delayMs) {
    const key = String(userId);
    if (!running[userId]) return;
    const oldTimer = nextRunTimers.get(key);
    if (oldTimer) clearTimeout(oldTimer);
    const safeDelay = Math.max(1000, Number(delayMs) || 10000);
    const timer = setTimeout(() => {
        nextRunTimers.delete(key);
        if (running[userId]) {
            runPredict(userId, chatId).catch(error => {
                console.error("[RUN PREDICT ERROR]", error?.message || error);
                if (running[userId]) scheduleRun(userId, chatId, 10000);
            });
        }
    }, safeDelay);
    if (typeof timer.unref === "function") timer.unref();
    nextRunTimers.set(key, timer);
}
const MAX_LEVEL_HISTORY = 10;

async function closeHiddenSite() {
    if (hiddenSiteCloseTimer) {
        clearTimeout(hiddenSiteCloseTimer);
        hiddenSiteCloseTimer = null;
    }
    const page = hiddenPage;
    const browser = hiddenBrowser;
    hiddenPage = null;
    hiddenBrowser = null;
    hiddenPagePromise = null;
    hiddenSiteLastUsed = 0;
    try { if (page && !page.isClosed()) await page.close(); } catch (e) { console.warn("[SITE PAGE CLOSE]", e.message); }
    try { if (browser) await browser.close(); } catch (e) { console.warn("[SITE BROWSER CLOSE]", e.message); }
}

function armHiddenSiteCleanup() {
    if (hiddenSiteCloseTimer) clearTimeout(hiddenSiteCloseTimer);
    hiddenSiteCloseTimer = setTimeout(() => {
        closeHiddenSite().catch(() => {});
    }, 2 * 60 * 1000);
    if (typeof hiddenSiteCloseTimer.unref === "function") hiddenSiteCloseTimer.unref();
}


async function getHiddenSitePage() {
    if (hiddenPage && !hiddenPage.isClosed()) {
        hiddenSiteLastUsed = Date.now();
        armHiddenSiteCleanup();
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
            await hiddenPage.setRequestInterception(false);
            await hiddenPage.setViewport({ width: 420, height: 900 });
            await hiddenPage.goto(SITE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
            hiddenSiteLastUsed = Date.now();
            armHiddenSiteCleanup();
            return hiddenPage;
        })().catch(async error => {
            await closeHiddenSite();
            throw error;
        });
    }
    return hiddenPagePromise;
}

function updateAfterResult(userId, wasWin, actual, betPlaced) {
    initUser(userId);
    if (typeof autobetState !== 'undefined' && autobetState[userId]) {
        const st = autobetState[userId];
        const cfg = autobetCfg[userId] || {};
        if (betPlaced) {
            if (wasWin) { st.lastWinLevel = st.level; st.lastWinMode = cfg.mode || "SIZE"; st.level = 1; st.consecutiveLoss = 0; }
            else { st.consecutiveLoss++; st.level = st.level >= cfg.maxLvl ? 1 : st.level + 1; }
        } else if (cfg.watch) {
            st.consecutiveLoss = wasWin ? 0 : st.consecutiveLoss + 1;
        }
    }
}

function getStatus(userId) { initState(userId); return "SITE_ONLY"; }

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

    const luciferPrediction = await fetchLuciferPrediction();
    if (!luciferPrediction) {
        scheduleRun(userId, chatId, 10000);
        runInFlight.delete(runKey);
        return;
    }
    const next = luciferPrediction.issueNumber;
    if (!/^\d{8,}$/.test(String(next))) { scheduleRun(userId, chatId, 10000); runInFlight.delete(runKey); return; }
    if (sentPeriods[userId].has(next)) { scheduleRun(userId, chatId, 3000); runInFlight.delete(runKey); return; }
    sentPeriods[userId].add(next);
    while (sentPeriods[userId].size > MAX_SENT_PERIODS) {
        sentPeriods[userId].delete(sentPeriods[userId].values().next().value);
    }

    initState(userId);
    userStates[userId].lastLuciferPrediction = luciferPrediction;
    const signal = luciferPrediction;
    if(!signal) { scheduleRun(userId, chatId, 5000); runInFlight.delete(runKey); return; }
    if (signal.skip) {
        await send(chatId, "⏭ SKIP: Lucifer API did not provide a usable signal\nNo bet for period " + next.slice(-6));
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
"║ Signal  : "+(signal.type==="NUMBER"?"🔢 NUMBER "+signal.val:(signal.type==="COMBINED"?"🔀 "+signal.val:""+(signal.val==="BIG"?"🔵 BIG":"🟠 SMALL")))+"\n"+
    (cfg.mode==="COMBINED" ? "║ Number  : "+signal.bets.find(b=>b.type==="NUMBER")?.val+"\n" : "")+
"║ Source  : Lucifer API | "+signal.pat+"\n"+
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
    if (previousTimer) clearTimeout(previousTimer);
    let tries = 0;
    let callbackBusy = false;
    const cfg = autobetCfg[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    
    const releaseResultCheck = () => {
        if (iv) clearTimeout(iv);
        if (resultCheckTimers.get(timerKey) === iv) resultCheckTimers.delete(timerKey);
        resultCheckInFlight.delete(timerKey);
        callbackBusy = false;
    };
    let iv;
    const tick = async () => {
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
            iv = setTimeout(tick, 10000);
            resultCheckTimers.set(timerKey, iv);
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
    };
    iv = setTimeout(tick, 10000);
    resultCheckTimers.set(timerKey, iv);
}


// Lucifer API prediction analyzer.
function normalizeLuciferItem(item) {
    const issueNumber = String(item?.issueNumber ?? item?.issue ?? item?.period ?? '').trim();
    const rawSize = String(item?.size ?? item?.bigSmall ?? item?.result ?? '').trim().toUpperCase();
    const n = Number(item?.number ?? item?.winNumber ?? item?.digit);
    const size = rawSize === 'BIG' || rawSize === 'SMALL'
        ? rawSize
        : Number.isInteger(n) && n >= 0 && n <= 9 ? (n >= 5 ? 'BIG' : 'SMALL') : null;
    if (!/^\d{8,}$/.test(issueNumber) || !size) return null;
    return { issueNumber, size, number: Number.isInteger(n) ? n : null, raw: item };
}

function oppositeSize(size) {
    return size === 'BIG' ? 'SMALL' : size === 'SMALL' ? 'BIG' : null;
}

function analyzeLuciferHistory(items) {
    const history = (Array.isArray(items) ? items : [])
        .map(normalizeLuciferItem).filter(Boolean)
        .sort((a,b) => BigInt(b.issueNumber) > BigInt(a.issueNumber) ? 1 : -1);
    if (history.length < 3) return null;

    const latest = history[0];
    const target = (BigInt(latest.issueNumber) + 1n).toString().padStart(latest.issueNumber.length, '0');
    let same = 0, opposite = 0;
    const pairs = [];

    // For current 03, history[0]=02 and history[1]=01 are completed.
    // Analyze the two-period pairs requested by the user: 01/03 is not
    // allowed because 03 is the target; therefore use completed pairs at
    // the same two-step distance: 01/03 is excluded and 02/01 is the first
    // valid adjacent completed pair. The target itself is never included.
    for (let i=0; i < history.length - 1; i++) {
        const newer = history[i];
        const older = history[i + 1];
        const relation = newer.size === older.size ? 'SAME' : 'OPPOSITE';
        if (relation === 'SAME') same++; else opposite++;
        pairs.push({ newer: newer.issueNumber, older: older.issueNumber, relation });
    }

    if (same === opposite) return null;
    const mode = same > opposite ? 'SAME' : 'OPPOSITE';
    const anchor = history[1];
    const prediction = mode === 'SAME' ? anchor.size : oppositeSize(anchor.size);
    if (!prediction) return null;
    return {
        issueNumber: target, val: prediction, type: 'SIZE', size: prediction,
        latestCompleted: latest, anchorResult: anchor,
        analysis: { same, opposite, mode, analyzedRecords: history.length, pairs },
        conf: Math.round(Math.max(same, opposite) * 100 / (same + opposite)),
        pat: `LUCIFER_${mode}`, source: LUCIFER_API,
        bets: [{ type: 'SIZE', val: prediction, kind: 'size' }]
    };
}

let luciferApiInFlight = null;
async function fetchLuciferPrediction() {
    if (luciferApiInFlight) return luciferApiInFlight;
    luciferApiInFlight = (async () => {
        try {
            const response = await axios.get(LUCIFER_API, {
                headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
                timeout: 10000,
                validateStatus: status => status >= 200 && status < 300
            });
            const body = response?.data;
            const records = Array.isArray(body) ? body : body?.data;
            const signal = analyzeLuciferHistory(records);
            if (!signal) {
                console.warn('[LUCIFER] No usable signal; skipping current period.');
                return null;
            }
            return signal;
        } catch (error) {
            console.warn('[LUCIFER] API read failed; skipping:', error?.message || error);
            return null;
        } finally {
            luciferApiInFlight = null;
        }
    })();
    return luciferApiInFlight;
}

function buildBSFromList(list, count = 15) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, count).map(item => {
        const size = String(item?.size ?? item?.bigSmall ?? '').toUpperCase();
        if (size === 'BIG' || size === 'SMALL') return size;
        const n = Number(item?.number ?? item?.winNumber ?? item?.digit);
        return Number.isInteger(n) && n >= 0 && n <= 9 ? (n >= 5 ? 'BIG' : 'SMALL') : null;
    }).filter(Boolean);
}

module.exports = { fetchLuciferPrediction, analyzeLuciferHistory, updateAfterResult, getStatus, initState, buildBSFromList, runPredict, checkResult };

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
    (cfg.mode === "COMBINED" ? "Size Bets: ₹"+cfg.customSizeBets.join(" → ₹")+"\nNum Bets : ₹"+cfg.customNumberBets.join(" → ₹")+"\nRule     : 1 site size + 1 site number\n" : "Bet Seq  : ₹"+cfg.customBets.join(" → ₹")+"\n")+
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
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(Number(t)===Number(OWNER_ID))return send(OWNER_ID,"❌ Owner access cannot be removed.",{reply_markup:ownerMenu});const was=hasAccess(t);delete usersAccess[t];clearUserTimers(t); running[t]=false;ownerState=null;send(OWNER_ID,was?"🚫 Removed":"⚠️ Not active",{reply_markup:ownerMenu});if(was)send(t,"🔴 Access removed.");return;}
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
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(Number(t)===Number(OWNER_ID))return send(id,"❌ Owner access cannot be removed.",{reply_markup:adminMenu});const was=hasAccess(t);delete usersAccess[t];clearUserTimers(t); running[t]=false;delete adminState[id];send(id,was?"🚫 Removed":"⚠️ Not active",{reply_markup:adminMenu});if(was)send(t,"🔴 Removed.");return;}
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
    (cfg.mode === "COMBINED" ? "Size Seq : ₹"+cfg.customSizeBets.join(" → ₹")+"\nNum Seq  : ₹"+cfg.customNumberBets.join(" → ₹")+"\nRule     : 1 site size + 1 site number\n" : "Bet Seq  : ₹"+cfg.customBets.join(" → ₹")+"\n")+
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
            return send(id,"✅ Mode set: BIG/SMALL + NUMBER\nOne site size bet + one site number bet.",{reply_markup:autobetMenu});
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
