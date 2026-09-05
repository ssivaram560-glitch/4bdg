const TelegramBot = require('node-telegram-bot-api');
const axios       = require('axios');
const crypto      = require('crypto');
const zlib        = require('zlib');
const puppeteer   = require('puppeteer');
const fs          = require('fs');
const path        = require('path');
const { PNG }      = require('pngjs');
// ============================================================
//  HELPER FUNCTIONS
// ============================================================

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ============================================================
//  CAPTCHA IMAGE EXTRACTION
// ============================================================

async function extractCaptchaImages(page) {
    const imageData = await page.evaluate(() => {
        const bgImg = document.querySelector('.captcha_background');
        const sliderImg = document.querySelector('.captcha_slider');
        
        if (!bgImg || !sliderImg) return null;
        
        const bgContainer = bgImg.parentElement;
        const bgRect = bgContainer ? bgContainer.getBoundingClientRect() : bgImg.getBoundingClientRect();
        const sliderRect = sliderImg.getBoundingClientRect();
        
        return {
            bgSrc: bgImg.src,
            sliderSrc: sliderImg.src,
            displayWidth: bgRect.width,
            displayHeight: bgRect.height,
            sliderDisplayLeft: sliderRect.left,
            sliderDisplayTop: sliderRect.top,
        };
    });
    
    if (!imageData || !imageData.bgSrc || !imageData.sliderSrc) {
        return null;
    }
    
    let bgData, pieceData;
    
    try {
        const bgResponse = await axios.get(imageData.bgSrc, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': SITE_URL,
                'Origin': SITE_URL
            }
        });
        const bgPng = PNG.sync.read(Buffer.from(bgResponse.data));
        bgData = { width: bgPng.width, height: bgPng.height, data: bgPng.data };
        
        const pieceResponse = await axios.get(imageData.sliderSrc, {
            responseType: 'arraybuffer',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': SITE_URL,
                'Origin': SITE_URL
            }
        });
        const piecePng = PNG.sync.read(Buffer.from(pieceResponse.data));
        pieceData = { width: piecePng.width, height: piecePng.height, data: piecePng.data };
    } catch (err) {
        console.error('[CAPTCHA] Failed to download images via axios:', err.message);
        
        try {
            const bgBase64 = await page.evaluate((src) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/png').split(',')[1]);
                    };
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }, imageData.bgSrc);
            
            const pieceBase64 = await page.evaluate((src) => {
                return new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        canvas.width = img.width;
                        canvas.height = img.height;
                        canvas.getContext('2d').drawImage(img, 0, 0);
                        resolve(canvas.toDataURL('image/png').split(',')[1]);
                    };
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }, imageData.sliderSrc);
            
            if (bgBase64 && pieceBase64) {
                const bgPng = PNG.sync.read(Buffer.from(bgBase64, 'base64'));
                bgData = { width: bgPng.width, height: bgPng.height, data: bgPng.data };
                const piecePng = PNG.sync.read(Buffer.from(pieceBase64, 'base64'));
                pieceData = { width: piecePng.width, height: piecePng.height, data: piecePng.data };
            }
        } catch (err2) {
            console.error('[CAPTCHA] Fallback also failed:', err2.message);
            return null;
        }
    }
    
    return {
        bgData,
        pieceData,
        displayWidth: imageData.displayWidth,
        displayHeight: imageData.displayHeight,
    };
}

// ============================================================
//  GAP DETECTION (Template Matching)
// ============================================================

function solveGapPosition(bgData, pieceData, displayWidth, displayHeight) {
    const { width: bgW, height: bgH, data: bgPixels } = bgData;
    const { width: pieceW, height: pieceH, data: piecePixels } = pieceData;
    
    const scaleX = displayWidth / bgW;
    
    const pieceOpaquePixels = [];
    let contentMinX = pieceW, contentMaxX = 0;
    let contentMinY = pieceH, contentMaxY = 0;
    
    for (let y = 0; y < pieceH; y++) {
        for (let x = 0; x < pieceW; x++) {
            const idx = (y * pieceW + x) * 4;
            const alpha = piecePixels[idx + 3];
            if (alpha > 80) {
                pieceOpaquePixels.push({
                    x, y,
                    r: piecePixels[idx] / 255,
                    g: piecePixels[idx + 1] / 255,
                    b: piecePixels[idx + 2] / 255,
                });
                contentMinX = Math.min(contentMinX, x);
                contentMaxX = Math.max(contentMaxX, x);
                contentMinY = Math.min(contentMinY, y);
                contentMaxY = Math.max(contentMaxY, y);
            }
        }
    }
    
    if (pieceOpaquePixels.length < 50) return -1;
    
    const bgR = new Float32Array(bgW * bgH);
    const bgG = new Float32Array(bgW * bgH);
    const bgB = new Float32Array(bgW * bgH);
    
    for (let i = 0; i < bgW * bgH; i++) {
        bgR[i] = bgPixels[i * 4] / 255;
        bgG[i] = bgPixels[i * 4 + 1] / 255;
        bgB[i] = bgPixels[i * 4 + 2] / 255;
    }
    
    let bestX = 0;
    let bestScore = Infinity;
    
    for (let x = 0; x <= bgW - pieceW; x += 2) {
        let totalDiff = 0;
        let count = 0;
        
        for (const pp of pieceOpaquePixels) {
            const bgX = x + pp.x;
            const bgY = pp.y;
            
            if (bgX >= 0 && bgX < bgW && bgY >= 0 && bgY < bgH) {
                const bgIdx = bgY * bgW + bgX;
                const dr = bgR[bgIdx] - pp.r;
                const dg = bgG[bgIdx] - pp.g;
                const db = bgB[bgIdx] - pp.b;
                totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
                count++;
            }
        }
        
        if (count > 0) {
            const avgDiff = totalDiff / count;
            if (avgDiff < bestScore) {
                bestScore = avgDiff;
                bestX = x;
            }
        }
    }
    
    const refineMin = Math.max(0, bestX - 15);
    const refineMax = Math.min(bgW - pieceW, bestX + 15);
    
    for (let x = refineMin; x <= refineMax; x++) {
        let totalDiff = 0;
        let count = 0;
        
        for (const pp of pieceOpaquePixels) {
            const bgX = x + pp.x;
            const bgY = pp.y;
            
            if (bgX >= 0 && bgX < bgW && bgY >= 0 && bgY < bgH) {
                const bgIdx = bgY * bgW + bgX;
                const dr = bgR[bgIdx] - pp.r;
                const dg = bgG[bgIdx] - pp.g;
                const db = bgB[bgIdx] - pp.b;
                totalDiff += Math.sqrt(dr * dr + dg * dg + db * db);
                count++;
            }
        }
        
        if (count > 0) {
            const avgDiff = totalDiff / count;
            if (avgDiff < bestScore) {
                bestScore = avgDiff;
                bestX = x;
            }
        }
    }
    
    const dragDistance = Math.round(bestX * scaleX);
    return dragDistance;
}

// ============================================================
//  HUMAN-LIKE DRAG SIMULATION
// ============================================================

async function performHumanDrag(page, dragDistance) {
    const handlerPos = await page.evaluate(() => {
        const handler = document.querySelector('.captcha_handler');
        if (!handler) return null;
        const rect = handler.getBoundingClientRect();
        return {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
        };
    });
    
    if (!handlerPos) return false;
    
    const startX = handlerPos.x;
    const startY = handlerPos.y;
    const totalSteps = randomInt(50, 80);
    
    await page.mouse.move(startX, startY);
    await sleep(randomInt(200, 500));
    
    const dragResult = await page.evaluate(({ dragDistance, totalSteps }) => {
        return new Promise((resolve) => {
            const handler = document.querySelector('.captcha_handler');
            if (!handler) {
                resolve({ success: false, error: 'handler not found' });
                return;
            }
            
            const rect = handler.getBoundingClientRect();
            const cx = rect.x + rect.width / 2;
            const cy = rect.y + rect.height / 2;
            const endX = cx + dragDistance;
            
            const points = [];
            const jitter = (min, max) => min + Math.random() * (max - min);
            
            for (let i = 1; i <= totalSteps; i++) {
                const progress = i / totalSteps;
                let eased;
                
                if (progress < 0.05) {
                    eased = Math.pow(progress / 0.05, 2) * 0.05;
                } else if (progress < 0.2) {
                    const p = (progress - 0.05) / 0.15;
                    eased = 0.05 + p * p * 0.2;
                } else if (progress < 0.65) {
                    eased = 0.25 + ((progress - 0.2) / 0.45) * 0.4;
                } else if (progress < 0.85) {
                    const p = (progress - 0.65) / 0.20;
                    eased = 0.65 + (1 - Math.pow(1 - p, 2)) * 0.2;
                } else {
                    const p = (progress - 0.85) / 0.15;
                    eased = 0.85 + Math.pow(p, 2) * 0.15;
                }
                
                const px = cx + dragDistance * eased;
                const py = cy + jitter(-3, 3);
                points.push({ x: px, y: py, progress });
            }
            
            let pointIndex = 0;
            const dispatchNext = () => {
                if (pointIndex >= points.length) {
                    setTimeout(() => {
                        const upEvent = new PointerEvent('pointerup', {
                            bubbles: true, cancelable: true,
                            clientX: endX, clientY: cy, screenX: endX, screenY: cy,
                            pointerId: 1, pointerType: 'mouse'
                        });
                        handler.dispatchEvent(upEvent);
                        
                        const mouseUpEvent = new MouseEvent('mouseup', {
                            bubbles: true, cancelable: true, clientX: endX, clientY: cy
                        });
                        document.dispatchEvent(mouseUpEvent);
                        
                        setTimeout(() => resolve({ success: true }), 500);
                    }, 200);
                    return;
                }
                
                const point = points[pointIndex];
                let delay = 5 + Math.random() * 10;
                
                setTimeout(() => {
                    const moveEvent = new MouseEvent('mousemove', {
                        bubbles: true, cancelable: true,
                        clientX: point.x, clientY: point.y
                    });
                    document.dispatchEvent(moveEvent);
                    
                    pointIndex++;
                    dispatchNext();
                }, delay);
            };
            
            const downEvent = new PointerEvent('pointerdown', {
                bubbles: true, cancelable: true,
                clientX: cx, clientY: cy, screenX: cx, screenY: cy,
                pointerId: 1, pointerType: 'mouse'
            });
            handler.dispatchEvent(downEvent);
            
            const mouseDownEvent = new MouseEvent('mousedown', {
                bubbles: true, cancelable: true, clientX: cx, clientY: cy
            });
            handler.dispatchEvent(mouseDownEvent);
            
            setTimeout(() => dispatchNext(), 100);
        });
    }, { dragDistance, totalSteps });
    
    return dragResult.success;
}

async function isCaptchaVisible(page) {
    return await page.evaluate(() => {
        const bg = document.querySelector('.captcha_background');
        const slider = document.querySelector('.captcha_slider');
        if (!bg || !slider) return false;
        
        const overlay = document.querySelector('.van-overlay');
        if (overlay) {
            const style = window.getComputedStyle(overlay);
            if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        
        return true;
    });
}

async function solveCaptcha(page) {
    const images = await extractCaptchaImages(page);
    if (!images) return -1;
    return solveGapPosition(images.bgData, images.pieceData, images.displayWidth, images.displayHeight);
}

// ============================================================
//  COMPLETE LOGIN WITH DIRECT URL NAVIGATION TO WINGO 30S
// ============================================================

async function captchaLogin(userId, chatId, phone, password, bot, logBoth) {
    console.log(`[LOGIN] Starting captcha login for user ${userId}...`);
  
    let browser;
    let page;
    
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--single-process',
                '--disable-gpu',
                '--disable-blink-features=AutomationControlled',
                '--window-size=1280,800'
            ]
        });

        page = await browser.newPage();
        await page.setDefaultNavigationTimeout(90000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let capturedToken = null;
        let resolveGetBalanceToken;
        const getBalanceTokenPromise = new Promise((resolve) => {
            resolveGetBalanceToken = resolve;
        });

        // === REQUEST INTERCEPTION TO CAPTURE GETBALANCE TOKEN ===
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            try {
                if (req.url().includes('GetBalance')) {
                    const headers = req.headers();
                    const authHeader = headers['authorization'] || headers['Authorization'];
                    
                    if (authHeader && !capturedToken) {
                        const token = authHeader.replace(/^Bearer\s+/i, "").trim();
                        if (token.length >= 20) {
                            capturedToken = token;
                            resolveGetBalanceToken(token);
                            console.log(`[LOGIN] ✅ Token captured from GetBalance request! length=${token.length}`);
                        }
                    }
                }
            } catch (err) {
                console.error('[LOGIN] Request interception error:', err.message);
            }
            req.continue().catch(() => {});
        });
        
        // Navigate to login page
        await page.goto(SITE_URL + 'login', {
            waitUntil: 'domcontentloaded', 
            timeout: 90000 
        });
        
        await page.waitForSelector('input', { timeout: 30000 });
        await sleep(1000);

        const visibleInputs = await page.$$('input');
        const isVisible = async (handle) => {
            try {
                return await handle.evaluate(el => {
                    const s = getComputedStyle(el);
                    const r = el.getBoundingClientRect();
                    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
                });
            } catch (_) {
                return false;
            }
        };

        const candidates = [];
        for (const handle of visibleInputs) {
            if (await isVisible(handle)) candidates.push(handle);
        }

        const candidateMeta = [];
        for (const handle of candidates) {
            const meta = await handle.evaluate(el => ({
                type: String(el.getAttribute('type') || '').toLowerCase(),
                name: String(el.getAttribute('name') || '').toLowerCase(),
                placeholder: String(el.getAttribute('placeholder') || '').toLowerCase()
            }));
            candidateMeta.push({ handle, ...meta });
        }

        const safePhone = candidateMeta.find(item =>
            item.type !== 'password' &&
            /phone|mobile|number|username|account/.test(`${item.name} ${item.placeholder}`)
        ) || candidateMeta.find(item => item.type !== 'password');
        
        const safePhoneInput = safePhone?.handle;
        if (!safePhoneInput) throw new Error('Phone input not found');
        
        await safePhoneInput.click({ clickCount: 3 });
        await safePhoneInput.press('Backspace');
        await safePhoneInput.type(String(phone), { delay: 50 });

        await sleep(500);

        const passwordInput = candidateMeta.find(item => item.type === 'password')?.handle ||
            candidateMeta.find(item => item.handle !== safePhoneInput)?.handle;
            
        if (!passwordInput) throw new Error('Password input not found');
        
        await passwordInput.click({ clickCount: 3 });
        await passwordInput.press('Backspace');
        await passwordInput.type(String(password), { delay: 50 });
        
        // Click Login button
        await page.evaluate(() => {
            const btns = Array.from(document.querySelectorAll('button'));
            const loginBtn = btns.find(b => b.innerText.includes('Log in') || b.innerText.includes('Login'));
            if (loginBtn) loginBtn.click();
            else document.querySelector('form')?.submit();
        });
        
        await sleep(2000);
        
        let captchaDetected = false;
        for (let i = 0; i < 20; i++) {
            captchaDetected = await isCaptchaVisible(page);
            if (captchaDetected) break;
            await sleep(500);
        }
        
        if (captchaDetected) {
            console.log('[LOGIN] Captcha detected! Solving...');
            const dragDistance = await solveCaptcha(page);
            
            if (dragDistance < 10 || dragDistance > 330) {
                if (chatId) await logBoth(chatId, '❌ Captcha solve failed - invalid distance');
                return false;
            }
            
            const dragged = await performHumanDrag(page, dragDistance);
            if (!dragged) {
                if (chatId) await logBoth(chatId, '❌ Captcha solve failed - drag error');
                return false;
            }
            
            await sleep(3000);
            if (await isCaptchaVisible(page)) {
                if (chatId) await logBoth(chatId, '❌ Captcha solve failed - server rejected');
                return false;
            }
            console.log('[LOGIN] ✅ Captcha solved successfully!');
        }
        
        // === REDIRECT TO WINGO PAGE TO TRIGGER GETBALANCE ===
        try {
            await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
        } catch (e) {}
        await sleep(3000);
        
        console.log('[LOGIN] Navigating to WinGo 30S page to trigger GetBalance request...');
        console.log('[LOGIN] Navigating directly to WinGo 30S page via URL...');
        await page.goto(SITE_URL + 'WinGo/WinGo_30S', {
            waitUntil: 'domcontentloaded',
            timeout: 10000
        });
        await sleep(3000);
        
        // Wait specifically for the authenticated GetBalance request if not captured yet.
        if (!capturedToken) {
            console.log('[LOGIN] Waiting for GetBalance token promise...');
            await Promise.race([
                getBalanceTokenPromise,
                new Promise((resolve) => setTimeout(resolve, 15000))
            ]);
        }

        if (capturedToken) {
            console.log(`[LOGIN] ✅ Token captured and returned directly to bot.js (length=${capturedToken.length})`);
            if (chatId) await logBoth(chatId, `✅ [SUCCESS] Token captured for user ${userId}!`);
            return capturedToken;
        } else {
            console.error('[LOGIN] ❌ Token not found');
            if (chatId) await logBoth(chatId, `❌ Login failed - token not captured for user ${userId}`, true);
            return false;
        }
        
    } catch (err) {
        console.error(`[LOGIN] Error: ${err.message}`);
        if (chatId) await logBoth(chatId, `❌ Login Error for user ${userId}: ${err.message}`, true);
        return false;
    } finally {
        if (browser) await browser.close();
    }
}

// ============================================================
//  CONFIG
// ============================================================
// Keep secrets outside the source code.
const BOT_TOKEN    = process.env.BOT_TOKEN || "8687914335:AAFmAN__B884yE1K6a8WnitedGS-IYBAD08";
const OWNER_ID     = 8869874751;
const OWNER_PASS   = process.env.OWNER_PASS || "2004";
const ADMIN_HANDLE = "@Sivakutty1";
const REG_LINK     = "https://www.ts777.co/#/";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://13llottery.com/api/Home/Login";
const CAPTCHA_URL = "https://13llottery.com/api/Home/Captcha";
const DRAW_URL    = "https://draw.ar-lottery01.com/WinGo/WinGo_30S/GetHistoryIssuePage.json";
const SITE_URL    = "https://13lwin19.com/";
const CHROME_ARGS = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--no-first-run',
    '--no-zygote', '--single-process'
];

// Martingale multipliers — user can customize base bet
const MULT = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683]; // Standard 3x Martingale multipliers
const SIZE_WIN_MULTIPLIER = 1.90;   // Requested BIG/SMALL payout multiplier
const NUMBER_WIN_MULTIPLIER = 8.90; // Requested exact-number payout multiplier

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
let running        = {};
let sentPeriods    = {};
let ownerState     = null;
let adminState   = {};
let userAction   = {}; 
let userCreds       = {};
let credsSetupState = {};
let loginRetryTimers = {};
let autobetCfg      = {};
let autobetState   = {};
let profitTrack    = {};
let GLOBAL_TOKEN   = "";
// Tokens are intentionally kept only in bot.js memory. No token file is created.
// A Render restart/redeploy requires login again, which is expected for this design.

function normalizeToken(value, seen = new Set()) {
    if (value == null) return "";
    if (typeof value === "string") {
        const raw = value.replace(/^Bearer\s+/i, '').replace(/^['\"]|['\"]$/g, '').trim();
        if (!raw || /[{}]/.test(raw)) return "";
        return raw;
    }
    if (typeof value !== "object" || seen.has(value)) return "";
    seen.add(value);
    const preferred = ["token", "accessToken", "access_token", "jwt", "id_token", "authorization"];
    for (const key of preferred) {
        const found = normalizeToken(value[key], seen);
        if (found) return found;
    }
    for (const child of Object.values(value)) {
        const found = normalizeToken(child, seen);
        if (found) return found;
    }
    return "";
}

function saveUserToken(userId, value) {
    const key = String(userId);
    const token = normalizeToken(value);
    if (!token || token.length < 20) {
        console.error(`[TOKEN SAVE FAILED] user=${key}; invalid token`);
        return false;
    }

    // Keep one canonical value, while mirroring it to the legacy credential object.
    // This prevents login success followed by a missing token when callers use different stores.
    userTokens[key] = token;
    if (!userCreds[key]) userCreds[key] = {};
    userCreds[key].token = token;

    const cached = normalizeToken(userTokens[key]);
    const mirrored = normalizeToken(userCreds[key].token);
    const ok = cached === token && mirrored === token;
    console.log(`[TOKEN ${ok ? 'SAVED' : 'SAVE FAILED'}] user=${key}; length=${token.length}; cache=${ok ? 'ready' : 'missing'}`);
    return ok;
}

// Shared token setter used by both manual /setmytoken and automatic login.
function applyMyToken(userId, rawToken) {
    const id = String(userId);
    const cleanToken = normalizeToken(rawToken);

    if (!cleanToken || cleanToken.length < 20) {
        console.error(`[SETMYTOKEN FAILED] user=${id}; invalid token`);
        return { ok: false, token: "", reason: "Token too short or invalid" };
    }

    const saved = saveUserToken(id, cleanToken);
    const verified = getToken(id) === cleanToken;

    if (!saved || !verified) {
        console.error(`[SETMYTOKEN FAILED] user=${id}; cache verification failed`);
        return { ok: false, token: cleanToken, reason: "Token cache verification failed" };
    }

    console.log(`[SETMYTOKEN AUTO] user=${id}; token saved automatically`);
    return { ok: true, token: cleanToken };
}

function clearUserToken(userId) {
    const key = String(userId);
    delete userTokens[key];
    delete userSessions[key];
    if (userCreds[key]) delete userCreds[key].token;
    return true;
}

// Relogin only for an explicit authentication/token-expiry response.
// Normal bet errors must never clear a valid token.
function isTokenExpiredMessage(message) {
    const text = String(message || '').toLowerCase().trim();
    return /(?:token|access token|jwt)\s+(?:is\s+)?(?:expired|invalid|illegal|missing|required)|(?:invalid|expired|missing|required)\s+(?:access\s+)?token|no token|unauthori[sz]ed|authentication\s+failed|login\s+required/.test(text);
}

let userTokens = {}; // Runtime-only token cache; deliberately not persisted to a file.
let userSessions = {}; // Runtime-only cookies/device metadata for authenticated API calls.
let userLastSeen = {};
const nextRunTimers = new Map();
const resultCheckTimers = new Map();
const resultCheckInFlight = new Set();
// Prevent duplicate result callbacks from sending a second WIN/LOSS box or sticker.
const settledPeriods = new Map();
// One prediction/bet dispatch per user and period, even if multiple timers fire.
const predictionDispatches = new Map();
const runInFlight = new Set();
const loginInFlight = new Map();
const MAX_SENT_PERIODS = 6;
const MAX_KEYS = 5000;
const USER_IDLE_TTL_MS = 60 * 60 * 1000;

function clearUserTimers(userId) {
    const key = String(userId);
    const nextTimer = nextRunTimers.get(key);
    if (nextTimer) clearTimeout(nextTimer);
    nextRunTimers.delete(key);

    const resultTimer = resultCheckTimers.get(key);
    if (resultTimer) clearTimeout(resultTimer);
    resultCheckTimers.delete(key);
    resultCheckInFlight.delete(key);
    settledPeriods.delete(key);
    predictionDispatches.delete(key);
    runInFlight.delete(key);
}

function cleanupUserResources(userId, removeAccess = false) {
    const key = String(userId);
    clearUserTimers(key);
    resultCheckInFlight.delete(key);
    runInFlight.delete(key);
    delete adminState[key];
    delete userAction[key];
    delete userCreds[key];
    delete credsSetupState[key];
    delete loginRetryTimers[key];
    delete userTokens[key];
    delete userSessions[key];
    delete userLastSeen[key];
    delete stats[key];
    delete userStates[key];
    delete autobetCfg[key];
    delete autobetState[key];
    delete profitTrack[key];
    delete sentPeriods[key];
    delete running[key];
    if (removeAccess) delete usersAccess[key];
}

function pruneExpiredUsers() {
    const now = Date.now();
    const tracked = new Set([
        ...Object.keys(usersAccess),
        ...Object.keys(userLastSeen),
        ...Object.keys(stats),
        ...Object.keys(userStates),
        ...Object.keys(autobetCfg),
        ...Object.keys(autobetState),
        ...Object.keys(profitTrack)
    ]);
    for (const key of tracked) {
        const expired = usersAccess[key] && Number(usersAccess[key]) <= now;
        const idle = !running[key] && !hasAccess(key) &&
            now - Number(userLastSeen[key] || 0) > USER_IDLE_TTL_MS;
        if (!running[key] && (expired || idle)) cleanupUserResources(key, true);
    }
}

// Prevent abandoned user objects and expired access records from accumulating.
const userPruneTimer = setInterval(pruneExpiredUsers, 10 * 60 * 1000);
userPruneTimer.unref?.();

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

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchList() {
    try {
        const response = await axios.get(DRAW_URL + "?_=" + Date.now(), {
            headers: {
                "Accept": "application/json",
                "Origin":           "https://13lwin19.com",
                    "Referer":          "https://13lwin19.com/",
                    
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36"
            },
            timeout: 10000,
            validateStatus: status => status >= 200 && status < 300
        });
        if (!(response.data && response.data.data && Array.isArray(response.data.data.list))) {
            console.error("[FETCH LIST ERROR] WinGo response was not a list");
            return null;
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
    
    // Do not auto-login just because the token is missing.
    // Login must be started explicitly from the Login button/command.
    if (!token) return { success: false, message: "No token - press Login first" };

    const baseParams = {
        language: "en",
        random: Math.floor(Math.random() * 1e12)
    };
    const signature = makeBetSign(baseParams);
    const timestamp = Math.floor(Date.now() / 1000);
    const qs = new URLSearchParams({
        ...baseParams,
        signature,
        timestamp
    }).toString();
    const url = "https://api.ar-lottery01.com/api/Lottery/GetBalance?" + qs;
    const headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://www.ts777.co",
        "User-Agent": "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36"
    };

    try {
        const r = await axios.get(url, { headers, timeout: 10000 });
        return await parseBalanceResponse(r);
    } catch (e) {
        const errMsg = e.response?.data?.msg || e.message || "API Error";
        return { success: false, message: errMsg };
    }
}

function initUser(id) {
    userLastSeen[id] = Date.now();
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
function getToken(id) {
    const key = String(id);
    // Read both stores for compatibility, then repair the canonical cache if needed.
    const token = normalizeToken(userTokens[key]) || normalizeToken(userCreds[key]?.token) || "";
    if (token && normalizeToken(userTokens[key]) !== token) userTokens[key] = token;
    return token;
}

function generateKey(days, by) {
    const k = "EARN WITH ME-"+crypto.randomBytes(3).toString('hex').toUpperCase()+"-"+crypto.randomBytes(2).toString('hex').toUpperCase();
    keyStore[k] = { days, used:false, usedBy:null, by:by||OWNER_ID, createdAt: Date.now() };
    const keys = Object.keys(keyStore);
    if (keys.length > MAX_KEYS) {
        for (const key of keys) {
            if (keyStore[key]?.used) delete keyStore[key];
            if (Object.keys(keyStore).length <= MAX_KEYS) break;
        }
    }
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

function ownerMemberDetails() {
    const now = Date.now();
    const ids = new Set([
        ...Object.keys(usersAccess),
        ...Object.keys(userLastSeen),
        ...Object.keys(autobetCfg),
        ...Object.keys(autobetState),
        ...Object.keys(profitTrack),
        ...Object.keys(running)
    ]);
    ids.delete(String(OWNER_ID));
    if (!ids.size) return "No members found.";

    const money = value => "₹" + (Number(value) || 0).toFixed(2);
    const seq = values => Array.isArray(values) && values.length ? values.join(" → ") : "Default";

    return [...ids].sort((a, b) => Number(a) - Number(b)).map(uid => {
        initUser(uid);
        const cfg = autobetCfg[uid] || {};
        const st = autobetState[uid] || {};
        const pt = profitTrack[uid] || {};
        const expiry = Number(usersAccess[uid] || 0);
        const access = expiry > now ? ((expiry - now) / 86400000).toFixed(1) + " days left" : "No active access";
        const mode = modeLabel(cfg.mode);
        const levelHistory = Object.entries(st.levelHistory || {})
            .sort((a, b) => Number(a[0].slice(1)) - Number(b[0].slice(1)))
            .map(([level, count]) => level + ":" + count).join(" | ") || "None";
        const sizeWins = levelMapText(stats[uid]?.sizeLevelWins);
        const numberWins = levelMapText(stats[uid]?.numberLevelWins);

        let out = "👤 MEMBER " + uid + "\n";
        out += "Access      : " + access + "\n";
        out += "Running     : " + (running[uid] ? "YES" : "NO") + "\n";
        out += "Mode        : " + mode + "\n";
        out += "AutoBet     : " + (cfg.enabled ? "ON" : "OFF") + "\n";
        out += "Watch       : " + (cfg.watch ? "ON" : "OFF") + " | Loss limit " + (cfg.watchLoss ?? "-") + "\n";
        out += "Base fund   : " + money(cfg.baseBet) + "\n";
        out += "Max level   : L" + (cfg.maxLvl || 1) + "\n";
        out += "Current lvl : L" + (st.level || 1) + " | Size L" + (st.sizeLevel || 1) + " | Number L" + (st.numberLevel || 1) + "\n";
        out += "Normal fund : " + seq(cfg.customBets) + "\n";
        out += "Size fund   : " + seq(cfg.customSizeBets) + "\n";
        out += "Number fund : " + seq(cfg.customNumberBets) + "\n";
        out += "Target      : " + money(cfg.targetProfit) + " | Restart " + (cfg.restartDelay || 1) + " min\n";
        out += "Total bet   : " + money(pt.totalBetAmount) + "\n";
        out += "P&L         : " + (Number(pt.pnl) >= 0 ? "+" : "") + money(pt.pnl) + "\n";
        out += "Win/Loss    : " + (pt.wins || 0) + "W / " + (pt.losses || 0) + "L\n";
        out += "Level usage : " + levelHistory + "\n";
        if (cfg.mode === "COMBINED") out += "Wins by L   : Size " + sizeWins + " | Number " + numberWins + "\n";
        else out += "Wins by L   : " + levelMapText(stats[uid]?.levelWins) + "\n";
        out += "------------------------\n";
        return out;
    }).join("\n");
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
                "Origin":           "https://13lwin19.com",
                    "Referer":          "https://13lwin19.com/",
                    "Ar-Origin":        "https://13lwin19.com",
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
let loginLock = {};
let loginLockStartedAt = {};
const LOGIN_LOCK_TIMEOUT_MS = 3 * 60 * 1000;
async function autoLogin(userId, chatId, silent = false) {
    const key = String(userId);
    const now = Date.now();
    // A crashed/closed browser must never permanently block the next Login attempt.
    if (loginLock[key] && now - Number(loginLockStartedAt[key] || 0) < LOGIN_LOCK_TIMEOUT_MS) {
        await logBoth(chatId, `⏳ Login is still running for user ${key}. Please wait a moment and press Login again.`);
        return false;
    }
    if (loginLock[key]) {
        console.warn(`[LOGIN LOCK] Clearing stale lock for user ${key}`);
        loginLock[key] = false;
        delete loginLockStartedAt[key];
    }
    loginLock[key] = true;
    loginLockStartedAt[key] = now;

    const creds = userCreds[userId] || {};
    const { phone, pass } = creds;

    if (!phone || !pass) {
        await logBoth(chatId, `[AUTO LOGIN] User ${userId} has no phone or password set.`);
        loginLock[key] = false;
        delete loginLockStartedAt[key];
        return false;
    }

    try {
        const token = await captchaLogin(userId, chatId, phone, pass, bot, logBoth);
        if (token) {
            const cleanToken = normalizeToken(token);
            if (!cleanToken) {
                throw new Error('captchaLogin returned an empty token');
            }
            // Treat the GetBalance token exactly like /setmytoken <token>.
            const applied = applyMyToken(userId, cleanToken);
            if (!applied.ok) {
                throw new Error(applied.reason || 'Token captured but could not be saved');
            }
            console.log(`[TOKEN SAVED] User ${userId}; token length=${applied.token.length}`);
            if (!silent) {
                await logBoth(chatId, `✅ [SUCCESS] Token captured for user ${userId}!`);
            }
            // Return the actual token so callers can use it immediately.
            return cleanToken;
        } else {
            if (!silent) {
                await logBoth(chatId, `❌ [FAILED] Login failed for user ${userId}`, true);
            }
            return false;
        }
    } catch (err) {
        await logBoth(chatId, `❌ Login Error for user ${userId}: ${err.message}`, true);
        return false;
    } finally {
        loginLock[key] = false;
        delete loginLockStartedAt[key];
    }
}

async function robustLogin(userId, chatId, silent = false) {
    let success = await autoLogin(userId, chatId, silent);
    if (!success && !silent && chatId) {
        await logBoth(chatId, "❌ Login failed. Will retry automatically.");
    }
    return success;
}

async function startLoginWithRetry(userId, chatId) {
    if (loginRetryTimers[userId]) {
        clearTimeout(loginRetryTimers[userId]);
        delete loginRetryTimers[userId];
    }

    await send(chatId, "⏳ We are trying to login. Please hold on 3-5 minutes, we will be back to you.");

    let attempts = 0;

    async function attemptLogin() {
        if (!hasAccess(userId)) {
            delete loginRetryTimers[userId];
            return false;
        }
        attempts++;
        const ok = await autoLogin(userId, chatId, true);
        if (ok) {
            initUser(userId);
            autobetCfg[userId].enabled = true;
            if (loginRetryTimers[userId]) {
                clearTimeout(loginRetryTimers[userId]);
                delete loginRetryTimers[userId];
            }
            await send(chatId, "✅ Login Success!\n🤖 AutoBet is now turned ON automatically!", { reply_markup: userMenu(userId) });
            return true;
        }
        loginRetryTimers[userId] = setTimeout(attemptLogin, 60 * 1000);
        return false;
    }

    return attemptLogin();
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
// COMPLETE BOT LOGIC WITH 4-PREDICTION PATTERN MODE EXTENSION & FIXES
// ============================================================
// ============================================================
// COMPLETE BOT LOGIC WITH STRICT 4-CONSECUTIVE LOSS REQUIREMENT (NO WINS ALLOWED)
// ============================================================
let userStates = {};

function getNextIssue(list) {
    const latest = (Array.isArray(list) ? list : [])
        .map(item => String(item?.issueNumber || ""))
        .find(issue => /^\d{8,}$/.test(issue));
    if (!latest) return null;
    try {
        const next = (BigInt(latest) + 1n).toString();
        return next.length === latest.length ? next : null;
    } catch {
        return null;
    }
}

function buildBSFromList(list, count = 15) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, count).reverse().map(item => {
        const n = Number.parseInt(item?.number ?? item?.winNumber ?? -1, 10);
        return n >= 5 ? "BIG" : "SMALL";
    }).filter(Boolean);
}

function initState(userId) {
    if (!userStates[userId]) userStates[userId] = { lastSitePrediction: null, resultHistory: [] };
    if (!Array.isArray(userStates[userId].resultHistory)) userStates[userId].resultHistory = [];
}

function modeLabel(mode) {
    return mode === "NUMBER" ? "NUMBER" : mode === "COMBINED" ? "BIG/SMALL + NUMBER" : "BIG/SMALL";
}

function getSequenceAmount(userId, level, kind = "default") {
    const cfg = autobetCfg[userId] || {};
    const seq = cfg.mode === "COMBINED" ? (kind === "number" ? cfg.customNumberBets : cfg.customSizeBets) : cfg.customBets;
    return Number(seq?.[level - 1] ?? (cfg.baseBet * (MULT[level - 1] || 1)));
}

function getCombinedBetAmounts(userId, sizeLevel, numberLevel) {
    const cfg = autobetCfg[userId] || {};
    const maxLevel = Math.max(1, Number(cfg.maxLvl) || 1);
    const safeSizeLevel = Math.min(maxLevel, Math.max(1, Number(sizeLevel) || 1));
    const safeNumberLevel = Math.min(maxLevel, Math.max(1, Number(numberLevel) || 1));
    const base = Math.max(1, Number(cfg.baseBet) || 1);
    const sizeAmount = Number(cfg.customSizeBets?.[safeSizeLevel - 1]);
    const numberAmount = Number(cfg.customNumberBets?.[safeNumberLevel - 1]);
    return {
        size: Number.isFinite(sizeAmount) && sizeAmount > 0 ? sizeAmount : base,
        number: Number.isFinite(numberAmount) && numberAmount > 0 ? numberAmount : base,
        sizeLevel: safeSizeLevel,
        numberLevel: safeNumberLevel
    };
}

function combinedSettlement(bets, actualSize, actualNumber) {
    // Combined mode always has at most one SIZE and one NUMBER stake.
    const normalized = Array.isArray(bets) ? bets : [];
    const sizeBet = normalized.find(b => b.type === "SIZE");
    const numberBet = normalized.find(b => b.type === "NUMBER");
    const sizeAmount = sizeBet ? Math.max(0, Number(sizeBet.amt) || 0) : 0;
    const numberAmount = numberBet ? Math.max(0, Number(numberBet.amt) || 0) : 0;
    const totalStake = sizeAmount + numberAmount;
    const sizeWon = !!sizeBet && String(sizeBet.val).toUpperCase() === String(actualSize).toUpperCase();
    const numberWon = !!numberBet && Number(numberBet.val) === Number(actualNumber);

    // The API multipliers are treated as total returned winnings. Net profit
    // must subtract the complete stake, including the NUMBER stake.
    if (sizeWon) {
        return {
            won: true,
            pnl: (sizeAmount * SIZE_WIN_MULTIPLIER) - totalStake,
            reason: "SIZE",
            totalStake,
            payout: sizeAmount * SIZE_WIN_MULTIPLIER
        };
    }
    if (numberWon) {
        return {
            won: true,
            pnl: (numberAmount * NUMBER_WIN_MULTIPLIER) - totalStake,
            reason: "NUMBER",
            totalStake,
            payout: numberAmount * NUMBER_WIN_MULTIPLIER
        };
    }
    return { won: false, pnl: -totalStake, reason: "NONE", totalStake, payout: 0 };
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
        st.sizeLevel = 1; st.numberLevel = 1; st.level = 1;
    } else {
        st.sizeLevel = st.sizeLevel >= cfg.maxLvl ? 1 : st.sizeLevel + 1;
        st.numberLevel = st.numberLevel >= cfg.maxLvl ? 1 : st.numberLevel + 1;
        st.level = Math.max(st.sizeLevel, st.numberLevel);
    }
}

function formatPrediction(signal) {
    if (!signal || signal.skip === true) return "SKIP";
    if (signal.type === "NUMBER") return String(Number(signal.val));
    if (signal.type === "SIZE") return String(signal.val || "").toUpperCase();
    if (signal.type === "COMBINED") {
        const size = String(signal.val || "").toUpperCase();
        const number = signal.number ?? signal.bets?.find(b => b.type === "NUMBER")?.val;
        return number === undefined ? size : `${size} OR ${Number(number)}`;
    }
    return "SKIP";
}

function numberPrediction(lastResult) {
    const n = Number.parseInt(String(lastResult ?? '').trim(), 10);
    if (Number.isNaN(n) || n < 0 || n > 9) return null;
    const mapping = {
        9: ['BIG', 4],
        8: ['SMALL', 6],
        7: ['SMALL', 7],
        6: ['SMALL', 8],
        5: ['BIG', 3],
        4: ['SMALL', 6],
        3: ['SMALL', 9],
        2: ['SMALL', 5],
        1: ['BIG', 0],
        0: ['BIG', 1]
    };
    const [size, number] = mapping[n];
    return { size, number };
}

function latestResultNumber(item) {
    const raw = item?.number ?? item?.result ?? item?.resultNumber ?? item?.num ?? item?.value ?? item?.winNumber;
    const n = Number.parseInt(String(raw ?? '').trim(), 10);
    return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}

async function decidePrediction(list, currentPeriod, userId) {
    initState(userId);
    const latest = Array.isArray(list) ? list.map(latestResultNumber).find(n => n !== null) : null;
    const prediction = numberPrediction(latest);
    if (!prediction) return { skip: true, reason: 'API returned no valid latest result' };

    userStates[userId].lastPrediction = prediction.size;
    userStates[userId].lastNumberPrediction = prediction.number;
    console.log(`[DIRECT MAP] ${prediction.size} (${latest} -> ${prediction.number})`);
    return {
        type: 'COMBINED',
        val: prediction.size,
        number: prediction.number,
        pat: 'DIRECT LATEST-NUMBER MAP',
        bets: [
            { type: 'SIZE', val: prediction.size, kind: 'size' },
            { type: 'NUMBER', val: prediction.number, kind: 'number' }
        ]
    };
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
    let profit;
    if (settlement) {
        profit = Number(settlement.pnl) || 0;
    } else {
        const numberAmount = bets.filter(b => b.type === "NUMBER").reduce((sum, b) => sum + Number(b.amt || 0), 0);
        const sizeAmount = bets.filter(b => b.type === "SIZE").reduce((sum, b) => sum + Number(b.amt || 0), 0);
        profit = numberAmount > 0
            ? numberAmount * NUMBER_WIN_MULTIPLIER - amt
            : sizeAmount * SIZE_WIN_MULTIPLIER - amt;
    }
    
    pt.totalBets++; pt.wins++; pt.pnl += profit; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.winStreak++; pt.lossStreak = 0;
    if(pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;

    const winType = settlement?.reason === "NUMBER"
        ? "NUMBER WIN"
        : settlement?.reason === "SIZE"
            ? "SIZE WIN"
            : bets.some(b => b.type === "NUMBER")
                ? "NUMBER WIN"
                : "SIZE WIN";

    await send(chatId,
"╔══════════════════════════╗\n"+
"║  ✅ WIN! 🎉              ║\n"+
"╠══════════════════════════╣\n"+
"║ Winning : "+winType+"\n"+
"║ Number  : "+num+"\n"+
"║ Result  : "+actual+"\n"+
"║ Profit  : "+(profit>=0?"+":"")+"₹"+profit.toFixed(2)+"\n"+
"║ P&L     : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n"+
"║ Streak  : "+pt.winStreak+" wins\n"+
"║ Total   : "+pt.wins+"W/"+pt.losses+"L\n"+
"║ Reset   : L1 | Watch 0/"+cfg.watchLoss+"\n"+
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
    if (!Array.isArray(list) || list.length === 0) {
        console.warn("[PREDICTION] Draw history unavailable; retrying without emitting a false prediction");
        scheduleRun(userId, chatId, 15000);
        runInFlight.delete(runKey);
        return;
    }

    // The latest draw result is the only input to the fixed local mapping.
    const next = getNextIssue(list);
    if (!next) {
        await send(chatId, "SKIP");
        scheduleRun(userId, chatId, 10000);
        runInFlight.delete(runKey);
        return;
    }
    const dispatched = predictionDispatches.get(runKey) || new Set();
    if (sentPeriods[userId].has(next) || dispatched.has(String(next))) {
        scheduleRun(userId, chatId, 10000);
        runInFlight.delete(runKey);
        return;
    }
    sentPeriods[userId].add(next);
    dispatched.add(String(next));
    predictionDispatches.set(runKey, dispatched);
    while (sentPeriods[userId].size > MAX_SENT_PERIODS) {
        sentPeriods[userId].delete(sentPeriods[userId].values().next().value);
    }

    initState(userId);
    const signal = await decidePrediction(list, next, userId);
    if(!signal) { scheduleRun(userId, chatId, 5000); runInFlight.delete(runKey); return; }
    if (signal.skip) {
        // This should only happen when the API returned no usable numbers.
        console.warn("[PREDICTION] Local engine skipped:", signal.reason);
        await send(chatId, "SKIP — history unavailable");
        scheduleRun(userId, chatId, 10000);
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
"║ Mode    : BIG/SMALL\n"+
"║ Size    : "+signal.val+"\n"+
"║ Result  : "+formatPrediction(signal)+"\n"+
"║ Source  : Live Jade site\n"+
"╠══════════════════════════╣\n"+
"║ "+abLine+"\n"+
waitLine+"\n"+
"╚══════════════════════════╝",
        {reply_markup:{inline_keyboard:[[{text:"💰 CHECK NOW",url:REG_LINK}]]}}
    );

    let placedBets = [];
    if (canBet) {
        const rawSpecs = signal.bets || [{ type: signal.type, val: signal.val, kind: signal.type === "NUMBER" ? "number" : "size" }];
        // Enforce exactly one SIZE and one NUMBER for each period in COMBINED mode.
        const sizeSpec = rawSpecs.find(spec => spec.type === "SIZE");
        const numberSpec = rawSpecs.find(spec => spec.type === "NUMBER");
        const specs = cfg.mode === "COMBINED"
            ? [sizeSpec, numberSpec].filter(Boolean)
            : rawSpecs.filter(spec => spec.type === "SIZE" || spec.type === "NUMBER");
        const combinedAmounts = getCombinedBetAmounts(userId, st.sizeLevel, st.numberLevel);
        for (const spec of specs) {
            const isNumber = spec.type === "NUMBER";
            const amount = isNumber ? combinedAmounts.number : combinedAmounts.size;
            const levelForBet = isNumber ? combinedAmounts.numberLevel : combinedAmounts.sizeLevel;
            const result = await placeBet(userId, chatId, next, spec.val, spec.type, levelForBet, amount);
            if (result && result.ok) placedBets.push({ ...spec, amt: result.amt, level: levelForBet });
            else await send(chatId, "❌ Bet Failed (" + spec.type + "): " + (result?.msg || "Unknown error"));
        }
        if (cfg.mode === "COMBINED" && placedBets.length !== 2) {
            // Never treat a partial combined pair as a valid combined settlement.
            await send(chatId, "⚠️ Combined bet incomplete for period " + next + ". Expected exactly 1 size + 1 number; settlement will use only the confirmed stake.");
        }
        if (placedBets.length) {
            await send(chatId, "✅ Bets Success: " + placedBets.length + " | Size L" + combinedAmounts.sizeLevel + " / Number L" + combinedAmounts.numberLevel + "\n" + placedBets.map(b => b.type + "=" + b.val + " ₹" + b.amt).join("\n") + "\n⏳ Checking result...");
        }
    }

    // Pass the signal bets separately so WATCH mode can evaluate predictions even when AutoBet is OFF.
    const rawPredictedBets = signal.bets || [{ type: signal.type, val: signal.val, kind: signal.type === "NUMBER" ? "number" : "size" }];
    const predictedBets = rawPredictedBets.filter(spec => spec.type === "SIZE" || spec.type === "NUMBER");
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

        // The result endpoint can be read more than once while timers overlap.
        // Mark this period before sending any notification.
        const settled = settledPeriods.get(timerKey) || new Set();
        if (settled.has(String(target))) return;
        settled.add(String(target));
        settledPeriods.set(timerKey, settled);

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
            const settled = settledPeriods.get(timerKey);
            settled?.delete(String(target));
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
    const amounts = cfg.mode === "COMBINED"
        ? cfg.customSizeBets.slice(0, cfg.maxLvl).map((v, i) => `S₹${v}/N₹${cfg.customNumberBets[i] ?? cfg.baseBet}`)
        : cfg.customBets.slice(0, cfg.maxLvl);
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
    const amounts = cfg.mode === "COMBINED"
        ? cfg.customSizeBets.slice(0, cfg.maxLvl).map((v, i) => `S₹${v}/N₹${cfg.customNumberBets[i] ?? cfg.baseBet}`)
        : cfg.customBets.slice(0, cfg.maxLvl);
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
    const rows=[["▶️ Start Prediction"],["⏹ Stop Prediction"],["📊 Stats","💰 Profit","📩 Contact"],["🤖 AutoBet Setup","🔐 Login"]];
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
let handlersAttachedTo = null;
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
    if (bot) {
        console.warn("[BOT] startBot() ignored because polling is already active.");
        return;
    }
    if (!BOT_TOKEN) throw new Error("BOT_TOKEN environment variable is required");
    if(bot){try{bot.stopPolling();}catch(e){}}
    bot=new TelegramBot(BOT_TOKEN,{polling:{interval:1000,autoStart:true,params:{timeout:30}}});
    bot.on("polling_error",err=>{
        const msg = err?.message || String(err);
        if (msg.includes("409") || msg.toLowerCase().includes("terminated by other getupdates request")) {
            console.error("[POLL] 409 Conflict: another bot instance is using this token. Polling stopped; keep only one deployed instance running.");
            pollingRecovery = true;
            bot.stopPolling().catch(() => {});
            return;
        }
        if (msg.includes("ECONNRESET") || msg.includes("EFATAL") || msg.includes("socket hang up")) {
            recoverPolling(err);
            return;
        }
        console.error("Poll:", msg);
    });
    bot.on("error",err=>{
        const msg = err?.message || String(err);
        if (msg.includes("409") || msg.toLowerCase().includes("terminated by other getupdates request")) {
            console.error("[POLL] 409 Conflict: stop the duplicate bot instance, then redeploy this one.");
            bot.stopPolling().catch(() => {});
            return;
        }
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

// Telegram messages have a size limit; preserve every member's details by
// sending a long owner report in readable chunks.
async function sendLongText(chatId, text, opts = {}) {
    const limit = 3900;
    const value = String(text || "");
    if (value.length <= limit) return send(chatId, value, opts);
    let rest = value;
    while (rest.length > limit) {
        let cut = rest.lastIndexOf("\n------------------------\n", limit);
        if (cut < 500) cut = rest.lastIndexOf("\n", limit);
        if (cut < 1) cut = limit;
        await send(chatId, rest.slice(0, cut), opts);
        rest = rest.slice(cut).trimStart();
    }
    if (rest) await send(chatId, rest, opts);
}

// Shared logger used by autoLogin() and captcha-solver-free.js.
// Signature: logBoth(chatId, message, isError)
async function logBoth(chatId, message, isError = false) {
    const text = String(message || "");
    if (isError) console.error(text);
    else console.log(text);
    if (chatId !== undefined && chatId !== null) {
        await send(chatId, text);
    }
}

async function sendSticker(chatId,sid){try{await bot.sendSticker(chatId,sid);}catch(e){}}

// ============================================================
//  AUTO LOGIN TASK
// ============================================================


// ============================================================
//  HANDLERS
// ============================================================
function addHandlers(){
    if (handlersAttachedTo === bot) return;
    handlersAttachedTo = bot;
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

     bot.onText(/\/setcreds ?(.*)/,(msg,match)=>{
        const id=msg.from.id;
        if(!hasAccess(id))return send(id,"❌ No access.");
        const rest = (match[1] || "").trim();
        if (rest && rest.includes(" ")) {
            const parts = rest.split(/\s+/);
            const phone = parts[0];
            const pass = parts.slice(1).join(" ");
            credsSetupState[id] = { step: 3, phone, pass };
            const summary =
                "📋 Confirm your credentials:\n\n" +
                "📱 Mobile: " + phone + "\n" +
                "🔑 Password: " + "*".repeat(Math.min(pass.length, 8)) + "\n\n" +
                "Is this correct?";
            return send(id, summary, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Yes", callback_data: "creds_confirm_yes" }, { text: "❌ No", callback_data: "creds_confirm_no" }]
                    ]
                }
            });
        }
        credsSetupState[id] = { step: 1 };
        send(id, "📱 Please enter your Mobile Number (e.g. 916381605525):");
    });


    bot.onText(/^\/setmytoken(?:\s+)(.+)$/i, (msg, match) => {
        const id = String(msg.from.id);
        if (!hasAccess(id)) return send(id, "❌ No access.");

        const applied = applyMyToken(id, match[1]);
        if (!applied.ok) return send(id, "❌ " + applied.reason + "!");

        return send(
            id,
            "✅ Token loaded in bot memory!\n..." + applied.token.slice(-12) +
            "\n\n🤖 AutoBet Setup → ✅ Enable"
        );
    });

    async function beginUserLogin(id, chatId) {
        id = String(id);
        initUser(id);
        if (!hasAccess(id)) return send(chatId, "❌ No access.");

        const creds = userCreds[id] || {};
        if (!creds.phone || !creds.pass) {
            credsSetupState[id] = { step: 1 };
            return send(chatId, "📱 First-time login setup. Enter your mobile number (e.g. 916381605525):");
        }

        await send(chatId, "🔄 Calling CAPTCHA login...");
        const loginResult = await autoLogin(id, chatId, false);
        // autoLogin() already applied the token through applyMyToken().
        const cachedToken = getToken(String(id));
        if (cachedToken) {
            console.log(`[TOKEN CACHE VERIFIED] user=${String(id)}; length=${cachedToken.length}`);
            await send(chatId, "✅ Login Success!\n🔑 GetBalance token saved in bot memory: ..." + cachedToken.slice(-12) + "\n🤖 Now press ✅ Enable AutoBet");
        } else {
            await send(chatId, "❌ GetBalance token கிடைத்தது, ஆனால் bot memory cache-ல் save ஆகவில்லை. Render service restart/redeploy செய்து மீண்டும் Login செய்.");
        }
    }

    bot.onText(/^\/login(?:@\w+)?$/, async (msg) => {
        await beginUserLogin(String(msg.from.id), msg.chat.id);
    });

    bot.onText(/\/owner/,(msg)=>{
        if(msg.from.id!==OWNER_ID)return;
        if(ownerLoggedIn)return send(OWNER_ID,"Already in!",{reply_markup:ownerMenu});
        ownerState={action:"login"};send(OWNER_ID,"� Owner password:");
    });

    bot.onText(/\/adminlogin (.+)/,(msg,match)=>{
        const id=msg.from.id,pass=match[1].trim();
        if(!isAdmin(id))return send(id,"Not admin.");
        if(pass===adminPasswords[id]){adminLoggedIn[id]=true;send(id,"✅ Admin Login!",{reply_markup:adminMenu});}
        else send(id,"❌ Wrong!");
    });

    bot.on("callback_query", async (cb) => {
        const id = cb.from.id;
        const data = cb.data || "";
        const chatId = cb.message && cb.message.chat ? cb.message.chat.id : id;
        try { await bot.answerCallbackQuery(cb.id); } catch (e) {}

        if (data === "login_menu_login") {
            return beginUserLogin(String(id), chatId);
        }

        if (data === "login_menu_settoken") {
            return send(chatId,
                "🔑 To save or replace your token, send this command:\n\n" +
                "/setmytoken YOUR_TOKEN\n\n" +
                "After saving, press 🔐 Login again.");
        }

        if (data === "creds_confirm_yes") {
            const s = credsSetupState[id];
            if (!s || !s.phone || !s.pass) {
                credsSetupState[id] = { step: 1 };
                return send(chatId, "⚠️ Session expired. Let's start over.\n\n📱 Please enter your Mobile Number (e.g. 916381605525):");
            }
            if (!userCreds[id]) userCreds[id] = {};
            userCreds[id].phone = s.phone;
            userCreds[id].pass = s.pass;
            delete credsSetupState[id];
            // Run one explicit login attempt only. Automatic relogin is reserved for token expiry/401.
            await beginUserLogin(id, chatId);
        } else if (data === "creds_confirm_no") {
            credsSetupState[id] = { step: 1 };
            send(chatId, "🔁 Let's try again.\n\n📱 Please enter your Mobile Number (e.g. 916381605525):");
        }
    });
    bot.on("message",async msg=>{
        const id=msg.from.id,text=msg.text;
        if(!text||text.startsWith("/"))return;
                initUser(id);

        // Interactive credential setup started by the My Token button.
        if (hasAccess(id) && credsSetupState[id]) {
            const setup = credsSetupState[id];

            if (setup.step === 1) {
                const phone = text.trim();
                if (!/^\d{10,15}$/.test(phone)) {
                    return send(id, "❌ Invalid mobile number. Example: 916381605525");
                }
                credsSetupState[id] = { step: 2, phone };
                return send(id, "🔑 Please enter your password:");
            }

            if (setup.step === 2) {
                const pass = text.trim();
                if (!pass) return send(id, "❌ Password cannot be empty.");

                credsSetupState[id] = { step: 3, phone: setup.phone, pass };
                return send(id, "📋 Confirm your credentials:\n\n" +
                    "📱 Mobile: " + setup.phone + "\n" +
                    "🔑 Password: " + "*".repeat(Math.min(pass.length, 8)) + "\n\n" +
                    "Is this correct?", {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "✅ Yes", callback_data: "creds_confirm_yes" },
                            { text: "❌ No", callback_data: "creds_confirm_no" }
                        ]]
                    }
                });
            }
        }

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
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(Number(t)===Number(OWNER_ID))return send(OWNER_ID,"❌ Owner access cannot be removed.",{reply_markup:ownerMenu});const was=hasAccess(t);cleanupUserResources(t, true);ownerState=null;send(OWNER_ID,was?"🚫 Removed":"⚠️ Not active",{reply_markup:ownerMenu});if(was)send(t,"🔴 Access removed.");return;}
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
            if(text==="📊 All Status") {
                return sendLongText(OWNER_ID, "📊 TEAM MEMBERS — COMPLETE FUND & LEVEL DETAILS 📊\n\n" + ownerMemberDetails());
            }
            if(text==="🚪 Owner Logout") {ownerLoggedIn=false;return send(OWNER_ID,"🔒 Out.",{reply_markup:userMenu(id)});}
        }

        if(isAdmin(id) && isAdminIn(id) && adminState[id]){
            const s = adminState[id];
            if(AB.includes(text)){ delete adminState[id]; }
            else if(s.action==="genkey"){const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌ Days?");const k=generateKey(d,id);delete adminState[id];return send(id,"🔑 Key:\n\n"+k+"\n\n"+d+"d",{reply_markup:adminMenu});}
            else if(s.action==="adduser"){if(!s.step2){const t=parseInt(text);if(isNaN(t))return send(id,"❌");adminState[id]={action:"adduser",step2:true,tid:t};return send(id,"ID:"+t+"\nDays?");}else{const d=parseInt(text);if(isNaN(d)||d<1)return send(id,"❌");usersAccess[s.tid]=Date.now()+d*86400000;delete adminState[id];send(id,"✅ "+s.tid+" "+d+"d",{reply_markup:adminMenu});send(s.tid,"🎊 ACCESS! "+d+"d");return;}}
            else if(s.action==="removeuser"){const t=parseInt(text);if(isNaN(t))return;if(Number(t)===Number(OWNER_ID))return send(id,"❌ Owner access cannot be removed.",{reply_markup:adminMenu});const was=hasAccess(t);cleanupUserResources(t, true);delete adminState[id];send(id,was?"🚫 Removed":"⚠️ Not active",{reply_markup:adminMenu});if(was)send(t,"🔴 Removed.");return;}
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
            if(!getToken(id))return send(id,"❌ Token இல்லை. முதலில் 🔐 Login press பண்ணி login complete பண்ணு.",{reply_markup:autobetMenu});
            autobetCfg[id].enabled=true;
            {
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

        if (text === "🔐 Login") {
            if (!hasAccess(id)) return send(id, "❌ No access.");

            const tok = getToken(id);
            const creds = userCreds[id] || {};
            const tokenStatus = tok && tok.length > 20 ? "✅ Saved (..." + tok.slice(-12) + ")" : "❌ Not saved";
            const credentialStatus = creds.phone ? "✅ Credentials saved" : "❌ First-time setup required";

            return send(id,
                "🔐 LOGIN\n\n" +
                "Token: " + tokenStatus + "\n" +
                "Credentials: " + credentialStatus + "\n\n" +
                "Choose an option:",
                {
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "/setmytoken", callback_data: "login_menu_settoken" },
                            { text: "/login", callback_data: "login_menu_login" }
                        ]]
                    }
                }
            );
        }

        if(text==="⏹ Stop Prediction"){
            if(!running[id]) return send(msg.chat.id,"⚠️ Bot is not running.",{reply_markup:userMenu(id)});
            running[id]=false;
            clearUserTimers(id);
            return send(msg.chat.id,"⏹ Prediction stopped. No new bets or result checks will be scheduled.",{reply_markup:userMenu(id)});
        }

      if(text==="▶️ Start Prediction"){
            if(!hasAccess(id))return send(msg.chat.id,"❌ No access!\n📩 "+ADMIN_HANDLE+"\nID: "+id);
            if(running[id])return send(msg.chat.id,"⚠️ Already running!");

            clearUserTimers(id);
            running[id]=true;sentPeriods[id]=new Set();
            predictionDispatches.set(String(id), new Set());
            settledPeriods.delete(String(id));
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
const shutdown = async (signal) => {
    console.log(`[SHUTDOWN] ${signal}`);
    for (const id of Object.keys(running)) { running[id] = false; clearUserTimers(id); }
    try { if (bot) await bot.stopPolling(); } catch {}
    process.exit(0);
};
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
startBot();
