require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

// ============================================================
// ENV
// ============================================================

const BOT_TOKEN = "8756624614:AAH4we-TE6xwSEJu5FIEzrweamGVIFG0YO8";
const OWNER_ID = String(process.env.OWNER_ID);
const OWNER_IDS = [OWNER_ID, "8321379592", "8868253140"];

if (!BOT_TOKEN) {
    console.error("BOT_TOKEN is missing");
    process.exit(1);
}

if (!OWNER_ID) {
    console.error("OWNER_ID is missing");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

const app = express();
const WEB_PORT = Number(process.env.WEB_PORT) || 3000;
const LOCAL_LOGIN_SECRET = process.env.LOCAL_LOGIN_SECRET || "local-secret";
const localAuthTokens = new Set();

app.use(express.urlencoded({ extended: false }));

function createLocalAuthToken() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isLocalHostRequest(req) {
    const host = req.hostname || req.headers.host || "";
    return host.includes("localhost") || host.includes("127.0.0.1") || req.ip === "::1";
}

app.get("/", (req, res) => {
    res.redirect("/login");
});

app.get("/login", (req, res) => {
    if (!isLocalHostRequest(req)) {
        return res.status(403).send("Access denied. Localhost only.");
    }

    const { secret } = req.query;

    if (secret === LOCAL_LOGIN_SECRET) {
        const token = createLocalAuthToken();
        localAuthTokens.add(token);

        return res.send(`
            <h1>Local Login Successful</h1>
            <p>Use this token for local access:</p>
            <pre>${token}</pre>
            <p><a href="/status?token=${token}">View status</a></p>
        `);
    }

    res.send(`
        <h1>Local Login</h1>
        <p>Open <code>http://localhost:${WEB_PORT}/login?secret=YOUR_SECRET</code></p>
        <p>Set <code>LOCAL_LOGIN_SECRET</code> in your .env if you want to change it.</p>
    `);
});

app.get("/status", (req, res) => {
    if (!isLocalHostRequest(req)) {
        return res.status(403).send("Access denied. Localhost only.");
    }

    const token = req.query.token;

    if (!token || !localAuthTokens.has(token)) {
        return res.status(401).send("Unauthorized. Log in using /login?secret=YOUR_SECRET");
    }

    res.send(`
        <h1>Bot Status</h1>
        <pre>${JSON.stringify({
            level: state.level,
            levelLosses: state.levelLosses,
            skipCount: state.skipCount,
            skipReason: state.skipReason,
            c4Mode: state.c4Mode,
            c4Prediction: state.c4Prediction,
            c5LossStreak: state.c5LossStreak,
            stopped: state.stopped
        }, null, 2)}</pre>
        <p><a href="/logout?token=${token}">Logout</a></p>
    `);
});

app.get("/logout", (req, res) => {
    if (!isLocalHostRequest(req)) {
        return res.status(403).send("Access denied. Localhost only.");
    }

    const token = req.query.token;
    if (token && localAuthTokens.delete(token)) {
        return res.send("Logged out successfully.");
    }

    res.send("No active local session found.");
});

app.listen(WEB_PORT, () => {
    console.log(`Local login server available at http://localhost:${WEB_PORT}`);
});

// ============================================================
// CONFIG
// ============================================================

const MAX_RESULTS = 100;

// 0-4 = SMALL
// 5-9 = BIG

function getBS(number) {
    number = Number(number);

    if (number >= 5) {
        return "BIG";
    }

    return "SMALL";
}

function oppositeBS(value) {
    return value === "BIG" ? "SMALL" : "BIG";
}

// ============================================================
// STATE
// ============================================================

const state = {
    results: [],

    // Current level (L1-L15)
    level: 1,

    // Only ACTUAL BET losses
    levelLosses: 0,

    // Global prediction loss history (for C5 tracking)
    predictionHistory: [],

    // Number of rounds to skip
    skipCount: 0,

    // Why we are skipping
    skipReason: null,

    // C4 mode active
    c4Mode: false,

    // Last C4 prediction (used in continue mode)
    c4Prediction: null,

    // Authenticated users
    authenticatedUsers: new Set(),

    // C5 loss streak (skip + actual losses)
    c5LossStreak: 0,

    // Last prediction that is waiting for a result
    pendingBet: null,

    // Prevent repeated condition triggers for C1/C2/C3/C4
    lastC1Signature: null,
    lastC2Signature: null,
    lastC3Signature: null,
    lastC4Signature: null,

    // Bot stop state
    stopped: false
};

// ============================================================
// LEVEL LOSS REQUIREMENTS (L1-L15)
// ============================================================

const LEVEL_REQUIREMENTS = {
    1: 1,   // L1: 1 loss → L2
    2: 2,   // L2: 2 losses → L3
    3: 2,   // L3: 2 losses → L4
    4: 4,   // L4: 4 losses → L5
    5: 3,   // L5: 3 losses → L6
    6: 4,   // L6: 4 losses → L7
    7: 2,   // L7: 2 losses → L8
    8: 4,   // L8: 4 losses → L9
    9: 2,   // L9: 2 losses → L10
    10: 2,  // L10: 2 losses → L11
    11: 2,  // L11: 2 losses → L12
    12: 2,  // L12: 2 losses → L13
    13: 2,  // L13: 2 losses → L14
    14: 2,  // L14: 2 losses → L15
    15: 2   // L15: 2 losses → L15 (stays at L15)
};

function getCurrentLevelRequirement() {
    return LEVEL_REQUIREMENTS[state.level] || 2;
}

// ============================================================
// RESULT NORMALIZATION
// ============================================================

function normalizeResults(results) {
    return results
        .map(Number)
        .filter(n => Number.isInteger(n) && n >= 0 && n <= 9);
}

// ============================================================
// C1 - VIOLET (0 and 5)
// ============================================================

function checkC1(results) {
    if (results.length < 5) {
        return false;
    }

    const last5 = results.slice(0, 5);

    // Prevent repeated triggering on the same exact 5-result signature
    const signature = last5.join(",");

    if (state.lastC1Signature === signature) {
        return false;
    }

    const violetCount = last5.filter(
        n => n === 0 || n === 5
    ).length;

    return violetCount >= 3;
}

// ============================================================
// C2 - REPEATED EXACT NUMBER
// ============================================================

function checkC2(results) {
    if (results.length < 5) {
        return false;
    }

    const last5 = results.slice(0, 5);

    // Prevent repeated triggering on the same exact 5-result signature
    const signature = last5.join(",");

    if (state.lastC2Signature === signature) {
        return false;
    }

    const counts = {};

    for (const n of last5) {
        counts[n] = (counts[n] || 0) + 1;

        if (counts[n] >= 3) {
            return true;
        }
    }

    return false;
}

// ============================================================
// C3 - BBBSSS / SSSBBB (6 results pattern)
// ============================================================

function checkC3(results) {
    if (results.length < 6) {
        return false;
    }

    const last6nums = results.slice(0, 6);

    // Prevent repeated triggering on the same exact 6-result signature
    const signature = last6nums.join(",");

    if (state.lastC3Signature === signature) {
        return false;
    }

    const last6 = last6nums.map(getBS);

    const pattern = last6.join("");

    return (
        pattern === "BIGBIGBIGSMALLSMALLSMALL" ||
        pattern === "SMALLSMALLSMALLBIGBIGBIG"
    );
}

// ============================================================
// C4 - BSBS / SBSB (4 results pattern)
// ============================================================

function checkC4(results) {
    if (results.length < 4) {
        return false;
    }

        const last4nums = results.slice(0, 4);

        // Prevent repeated triggering on the same exact 4-result signature
        const signature = last4nums.join(",");

        if (state.lastC4Signature === signature) {
            return false;
        }

        const last4 = last4nums.map(getBS);

        const pattern = last4.join("");

        return (
            pattern === "BIGSMALLBIGSMALL" ||
            pattern === "SMALLBIGSMALLBIG"
        );
}

// ============================================================
// NORMAL PREDICTION
// ============================================================

function normalPrediction(results) {
    if (results.length < 5) {
        return null;
    }

    const last5 = results.slice(0, 5);

    const bigCount = last5.filter(
        n => getBS(n) === "BIG"
    ).length;

    const smallCount = 5 - bigCount;

    if (bigCount >= 3) {
        return {
            prediction: "BIG",
            bigCount,
            smallCount
        };
    }

    return {
        prediction: "SMALL",
        bigCount,
        smallCount
    };
}

// ============================================================
// C4 PREDICTION (opposite of latest result)
// ============================================================

function c4Prediction(results) {
    if (results.length === 0) {
        return null;
    }

    const latest = getBS(results[0]);

    return oppositeBS(latest);
}

// ============================================================
// C5 - FIVE CONSECUTIVE LOSSES
// ============================================================

function checkC5() {
    // C5 driven by global C5 loss counter which includes skip/wait periods
    return state.c5LossStreak >= 5;
}

// ============================================================
// RESET SKIPS
// ============================================================

function resetSkips() {
    state.skipCount = 0;
    state.skipReason = null;
}

// ============================================================
// ACTIVATE SKIP
// ============================================================

function activateSkip(count, reason) {
    state.skipCount = count;
    state.skipReason = reason;
}

function consumeSkipRound() {
    if (state.skipCount <= 0) {
        state.skipReason = null;
        return;
    }

    state.skipCount--;

    if (state.skipCount === 0) {
        state.skipReason = null;
    }
}

function applyDecisionState(decision, { preview = false } = {}) {
    if (preview) {
        return;
    }

    if (decision.action === "STOP" || decision.action === "WAIT") {
        return;
    }

    if (decision.action === "BET") {
        if (decision.reason === "C5 - 5 CONSECUTIVE LOSSES") {
            resetSkips();
            state.c5LossStreak = 0;
        }

        if (decision.reason === "C4 TRIGGER") {
            resetSkips();
            state.c4Mode = true;
            state.c4Prediction = c4Prediction(state.results);
            state.lastC4Signature = state.results.slice(0, 4).join(",");
        }

        if (decision.reason === "C4 CONTINUE MODE") {
            resetSkips();
            state.c4Mode = true;
            state.c4Prediction = c4Prediction(state.results);
        }

        return;
    }

    if (decision.action === "SKIP") {
        if (state.skipCount > 0) {
            return;
        }

        if (decision.reason === "C1 - VIOLET >= 3") {
            state.lastC1Signature = state.results.slice(0, 5).join(",");
            activateSkip(3, decision.reason);
            return;
        }

        if (decision.reason === "C2 - REPEATED NUMBER >= 3") {
            state.lastC2Signature = state.results.slice(0, 5).join(",");
            activateSkip(3, decision.reason);
            return;
        }

        if (decision.reason === "C3 - BBBSSS / SSSBBB") {
            state.lastC3Signature = state.results.slice(0, 6).join(",");
            activateSkip(4, decision.reason);
            return;
        }

        return;
    }
}

// ============================================================
// INFORMATIONAL PREDICTION FOR SKIPS
// ============================================================

function getInformationalPrediction(results) {
    if (results.length < 6) {
        return null;
    }

    if (state.c4Mode) {
        return {
            prediction: c4Prediction(results),
            predictionReason: "C4 CONTINUE MODE"
        };
    }

    if (checkC4(results)) {
        return {
            prediction: c4Prediction(results),
            predictionReason: "C4 PATTERN"
        };
    }

    const prediction = normalPrediction(results);

    if (!prediction) {
        return null;
    }

    return {
        prediction: prediction.prediction,
        bigCount: prediction.bigCount,
        smallCount: prediction.smallCount,
        predictionReason: "NORMAL"
    };
}

// ============================================================
// LEVEL WIN (ANY BET WIN → L1)
// ============================================================

function handleWin() {
    state.level = 1;
    state.levelLosses = 0;

    // C4 mode continues if it won
    if (state.c4Mode && state.c4Prediction) {
        // Will continue C4 opposite mode
    }
}

// ============================================================
// LEVEL LOSS (advance level if loss requirement met)
// ============================================================

function handleLoss() {
    // If already at L15, any LOSS should stop the bot per new rule
    if (state.level === 15) {
        state.stopped = true;
        return;
    }

    state.levelLosses++;

    const required = getCurrentLevelRequirement();

    if (state.levelLosses >= required) {
        // Advance to next level
        if (state.level < 15) {
            state.level++;
            state.levelLosses = 0;
        }
    }
}

// ============================================================
// RECORD PREDICTION RESULT
// ============================================================

function recordPredictionResult(prediction, actualNumber, isActual = true) {

    const actual = getBS(actualNumber);

    const result =
        prediction === actual
            ? "WIN"
            : "LOSS";

    state.predictionHistory.push({
        prediction,
        actual,
        result,
        number: Number(actualNumber),
        time: new Date().toISOString()
    });

    // Keep history manageable
    if (state.predictionHistory.length > 500) {
        state.predictionHistory.shift();
    }

    if (result === "WIN") {
        // Any WIN resets C5 loss counter
        state.c5LossStreak = 0;

        if (isActual) {
            handleWin();

            // A C4 win continues C4 mode with opposite prediction
            if (state.c4Mode) {
                state.c4Prediction = oppositeBS(actual);
            }
        }
    } else {
        // LOSS

        // Increment global C5 loss counter (counts skips and actual bets)
        state.c5LossStreak++;

        // If this was an actual bet loss, advance level state
        if (isActual) {
            // C4 mode loss: exit C4 and skip 2
            if (state.c4Mode) {
                state.c4Mode = false;
                state.c4Prediction = null;
                activateSkip(2, "C4 - LOSS SKIP");
            }

            handleLoss();
        }
    }

    return result;
}

// ============================================================
// ADD RESULT
// ============================================================

function addResult(number) {

    number = Number(number);

    if (
        !Number.isInteger(number) ||
        number < 0 ||
        number > 9
    ) {
        throw new Error("Result must be 0-9");
    }

    state.results.unshift(number);

    if (state.results.length > MAX_RESULTS) {
        state.results.length = MAX_RESULTS;
    }
}

// ============================================================
// MAIN PREDICTION ENGINE
// ============================================================

function getPredictionDecision() {

    if (state.stopped) {
        return {
            action: "STOP",
            reason: "BOT STOPPED",
            message: "Bot stopped after L15 loss."
        };
    }

    const results = state.results;

    if (results.length < 6) {
        return {
            action: "WAIT",
            reason: "Need at least 6 results",
            prediction: null
        };
    }

    // --------------------------------------------------------
    // C5 HAS HIGHEST PRIORITY
    // --------------------------------------------------------

    if (checkC5()) {
        const normal = normalPrediction(results) || { prediction: null };

        return {
            action: "BET",
            prediction: normal.prediction,
            reason: "C5 - 5 CONSECUTIVE LOSSES",
            level: state.level
        };
    }

    // --------------------------------------------------------
    // C4 ACTIVE MODE
    // --------------------------------------------------------

    if (state.c4Mode) {
        return {
            action: "BET",
            prediction: c4Prediction(results),
            reason: "C4 CONTINUE MODE",
            level: state.level
        };
    }

    // --------------------------------------------------------
    // NEW C4 TRIGGER
    // --------------------------------------------------------

    if (checkC4(results)) {
        return {
            action: "BET",
            prediction: c4Prediction(results),
            reason: "C4 TRIGGER",
            level: state.level
        };
    }

    // --------------------------------------------------------
    // EXISTING SKIP (C1/C2/C3)
    // --------------------------------------------------------

    if (state.skipCount > 0) {
        const info = getInformationalPrediction(results);

        return {
            action: "SKIP",
            prediction: info?.prediction || null,
            reason: state.skipReason,
            remaining: state.skipCount,
            predictionReason: info?.predictionReason,
            bigCount: info?.bigCount,
            smallCount: info?.smallCount,
            noBet: true
        };
    }

    // --------------------------------------------------------
    // C1 - VIOLET >= 3
    // --------------------------------------------------------

    if (checkC1(results)) {
        const info = getInformationalPrediction(results);

        return {
            action: "SKIP",
            prediction: info?.prediction || null,
            reason: "C1 - VIOLET >= 3",
            remaining: 3,
            predictionReason: info?.predictionReason,
            bigCount: info?.bigCount,
            smallCount: info?.smallCount,
            noBet: true
        };
    }

    // --------------------------------------------------------
    // C2 - REPEATED NUMBER >= 3
    // --------------------------------------------------------

    if (checkC2(results)) {
        const info = getInformationalPrediction(results);

        return {
            action: "SKIP",
            prediction: info?.prediction || null,
            reason: "C2 - REPEATED NUMBER >= 3",
            remaining: 3,
            predictionReason: info?.predictionReason,
            bigCount: info?.bigCount,
            smallCount: info?.smallCount,
            noBet: true
        };
    }

    // --------------------------------------------------------
    // C3 - BBBSSS / SSSBBB
    // --------------------------------------------------------

    if (checkC3(results)) {
        const info = getInformationalPrediction(results);

        return {
            action: "SKIP",
            prediction: info?.prediction || null,
            reason: "C3 - BBBSSS / SSSBBB",
            remaining: 4,
            predictionReason: info?.predictionReason,
            bigCount: info?.bigCount,
            smallCount: info?.smallCount,
            noBet: true
        };
    }

    // --------------------------------------------------------
    // NORMAL PREDICTION
    // --------------------------------------------------------

    const prediction = normalPrediction(results);

    if (!prediction) {
        return {
            action: "WAIT",
            prediction: null,
            reason: "Not enough results"
        };
    }

    return {
        action: "BET",
        prediction: prediction.prediction,
        reason: "NORMAL",
        bigCount: prediction.bigCount,
        smallCount: prediction.smallCount,
        level: state.level
    };
}

// ============================================================
// FORMAT DECISION
// ============================================================

function formatDecision(decision) {

    if (decision.action === "WAIT") {
        return [
            "⏳ WAIT",
            "",
            decision.reason
        ].join("\n");
    }

    if (decision.action === "SKIP") {
        return [
            "⏭️ SKIP",
            "",
            `Reason: ${decision.reason}`,
            `Remaining Skip: ${decision.remaining}`,
            decision.noBet ? "Bet: NO" : "Bet: YES",
            decision.prediction ? `Info prediction: ${decision.prediction}` : null,
            decision.predictionReason ? `Info reason: ${decision.predictionReason}` : null,
            decision.bigCount !== undefined ? `BIG: ${decision.bigCount}` : null,
            decision.smallCount !== undefined ? `SMALL: ${decision.smallCount}` : null
        ].filter(Boolean).join("\n");
    }

    return [
        "🎯 PREDICTION",
        "",
        `Prediction: ${decision.prediction}`,
        `Reason: ${decision.reason}`,
        `Level: L${decision.level || state.level}`,
        "",
        decision.bigCount !== undefined
            ? `BIG: ${decision.bigCount}`
            : "",
        decision.smallCount !== undefined
            ? `SMALL: ${decision.smallCount}`
            : ""
    ].filter(Boolean).join("\n");
}

// ============================================================
// TELEGRAM AUTH
// ============================================================

function isOwner(msg) {
    return OWNER_IDS.includes(String(msg.from.id));
}

function isAuthenticated(msg) {
    return state.authenticatedUsers.has(String(msg.from.id));
}

// ============================================================
// /start
// ============================================================

bot.onText(/\/start/, async msg => {

    const chatId = msg.chat.id;

    if (!isOwner(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Unauthorized."
        );
        return;
    }

    await bot.sendMessage(
        chatId,
        [
            "🤖 Prediction Engine (L1-L15 + C1-C5)",
            "",
            "Use:",
            "/login",
            "/result 7",
            "/results 7,2,8,4,6,1",
            "/predict",
            "/status",
            "/reset"
        ].join("\n")
    );
});

// ============================================================
// /login
// ============================================================

bot.onText(/\/login(?:\s+(.+))?/, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Unauthorized."
        );
        return;
    }

    state.authenticatedUsers.add(String(msg.from.id));

    await bot.sendMessage(
        chatId,
        "✅ Authentication successful."
    );
});

// ============================================================
// /result
// ============================================================

bot.onText(/\/result (\d)/, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(msg) || !isAuthenticated(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Login required."
        );
        return;
    }

    const number = Number(match[1]);

    try {
        // Settle the pending bet (if any) against the new result first
        const pending = state.pendingBet;

        if (pending && pending.prediction) {
            try {
                recordPredictionResult(pending.prediction, number, pending.isActualBet);
            } catch (e) {
                console.error("Failed to record pending bet result:", e.message);
            }

            state.pendingBet = null;
        }

        if (state.skipCount > 0) {
            consumeSkipRound();
        }

        // Add the new result after settling the previous prediction
        addResult(number);

        const decision = getPredictionDecision();

        if (decision.action === "STOP") {
            await bot.sendMessage(chatId, decision.message || "you losed your wallet");
            return;
        }

        applyDecisionState(decision);

        state.pendingBet = {
            action: decision.action,
            prediction: decision.prediction,
            isActualBet: decision.action === "BET"
        };

        await bot.sendMessage(
            chatId,
            [
                `📥 Result: ${number}`,
                `Type: ${getBS(number)}`,
                "",
                formatDecision(decision)
            ].join("\n")
        );

    } catch (error) {
        await bot.sendMessage(
            chatId,
            `❌ ${error.message}`
        );
    }
});

// ============================================================
// /results
// ============================================================

bot.onText(/\/results (.+)/, async (msg, match) => {

    const chatId = msg.chat.id;

    if (!isOwner(msg) || !isAuthenticated(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Login required."
        );
        return;
    }

    const values = match[1]
        .split(",")
        .map(v => Number(v.trim()));

    const normalized = normalizeResults(values);

    if (normalized.length === 0) {
        await bot.sendMessage(
            chatId,
            "❌ Invalid results."
        );
        return;
    }

    // Settle any existing pending bet using the first new result
    const pending = state.pendingBet;

    if (pending && pending.prediction) {
        try {
            recordPredictionResult(pending.prediction, normalized[0], pending.isActualBet);
        } catch (e) {
            console.error("Failed to record pending bet result:", e.message);
        }

        state.pendingBet = null;
    }

    state.results = normalized.slice(0, MAX_RESULTS);

    const decision = getPredictionDecision();

    if (decision.action === "STOP") {
        await bot.sendMessage(chatId, decision.message || "you losed your wallet");
        return;
    }

    applyDecisionState(decision);

    // store this decision as the next pending bet or skip action
    state.pendingBet = {
        action: decision.action,
        prediction: decision.prediction,
        isActualBet: decision.action === "BET"
    };

    await bot.sendMessage(
        chatId,
        [
            `📊 Results loaded: ${state.results.length}`,
            "",
            formatDecision(decision)
        ].join("\n")
    );
});

// ============================================================
// /predict
// ============================================================

bot.onText(/\/predict/, async msg => {

    const chatId = msg.chat.id;

    if (!isOwner(msg) || !isAuthenticated(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Login required."
        );
        return;
    }

    const decision = getPredictionDecision();

    if (decision.action === "STOP") {
        await bot.sendMessage(chatId, decision.message || "you losed your wallet");
        return;
    }

    await bot.sendMessage(
        chatId,
        formatDecision(decision)
    );
});

// ============================================================
// /status
// ============================================================

bot.onText(/\/status/, async msg => {

    const chatId = msg.chat.id;

    if (!isOwner(msg) || !isAuthenticated(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Login required."
        );
        return;
    }

    const recent = state.results
        .slice(0, 10)
        .map(n => `${n}=${getBS(n)}`)
        .join(" | ");

    const losses = state.predictionHistory
        .slice(-5)
        .map(x => x.result)
        .join(" ");

    await bot.sendMessage(
        chatId,
        [
            "📊 STATUS",
            "",
            `Level: L${state.level}`,
            `Level losses: ${state.levelLosses}/${getCurrentLevelRequirement()}`,
            "",
            `Skip: ${state.skipCount}`,
            `Skip reason: ${state.skipReason || "None"}`,
            "",
            `C4 mode: ${state.c4Mode ? "ON" : "OFF"}`,
            `C4 prediction: ${state.c4Prediction || "None"}`,
            "",
            `Last results:`,
            recent || "None",
            "",
            `Last 5 prediction results:`,
            losses || "None",
            "",
            `C5 loss streak: ${state.c5LossStreak}`,
            "",
            `C5 triggered: ${checkC5() ? "YES (5 LOSSES)" : "NO"}`
        ].join("\n")
    );
});

// ============================================================
// /reset
// ============================================================

bot.onText(/\/reset/, async msg => {

    const chatId = msg.chat.id;

    if (!isOwner(msg) || !isAuthenticated(msg)) {
        await bot.sendMessage(
            chatId,
            "❌ Login required."
        );
        return;
    }

    state.results = [];
    state.level = 1;
    state.levelLosses = 0;
    state.predictionHistory = [];
    state.skipCount = 0;
    state.skipReason = null;
    state.c4Mode = false;
    state.c4Prediction = null;
    state.c5LossStreak = 0;
    state.lastC1Signature = null;
    state.lastC2Signature = null;
    state.lastC3Signature = null;
    state.lastC4Signature = null;
    state.pendingBet = null;
    state.stopped = false;

    await bot.sendMessage(
        chatId,
        "♻️ All prediction state reset."
    );
});

// ============================================================
// ERROR HANDLING
// ============================================================

bot.on("polling_error", error => {
    console.error("Telegram polling error:", error.message);
});

process.on("uncaughtException", error => {
    console.error("Uncaught exception:", error);
});

process.on("unhandledRejection", error => {
    console.error("Unhandled rejection:", error);
});

console.log("====================================");
console.log(" Prediction Bot (L1-L15 + C1-C5)");
console.log("====================================");
