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
        await browser.defaultBrowserContext().overridePermissions(SITE_URL, ['notifications']);
        await page.setDefaultNavigationTimeout(90000);
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        let capturedToken = null;
        let resolveGetBalanceToken;
        const getBalanceTokenPromise = new Promise((resolve) => {
            resolveGetBalanceToken = resolve;
        });

        const captureToken = (rawToken, source) => {
            const token = normalizeToken(rawToken);
            if (token.length < 20 || capturedToken) return false;
            capturedToken = token;
            resolveGetBalanceToken(token);
            console.log(`[LOGIN] ✅ Token captured from ${source}! length=${token.length}`);
            return true;
        };

        // Capture the token wherever the current site places it: authenticated API
        // request headers, response headers, or login response JSON.
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            try {
                const headers = req.headers();
                const authHeader = headers['authorization'] || headers['Authorization'];
                if (authHeader && /api|GetBalance|Login/i.test(req.url())) captureToken(authHeader, 'API request');
            } catch (err) {
                console.error('[LOGIN] Request interception error:', err.message);
            }
            req.continue().catch(() => {});
        });
        page.on('response', async (response) => {
            if (capturedToken || !/Login|GetBalance|api/i.test(response.url())) return;
            try {
                const headers = response.headers();
                if (captureToken(headers.authorization || headers['x-auth-token'], 'API response header')) return;
                const contentType = String(headers['content-type'] || '').toLowerCase();
                if (contentType.includes('application/json')) {
                    const body = await response.json().catch(() => null);
                    captureToken(body, 'API response JSON');
                }
            } catch (err) {
                console.warn('[LOGIN] API response token inspection failed:', err.message);
            }
        });
        
        // Navigate to login page
        // The site keeps long-running resources open, so navigation may time out
        // even after the login form is usable. The visible form is the readiness check.
        try {
            await page.goto(LOGIN_PAGE_URL, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } catch (navigationError) {
            console.warn(`[LOGIN] Navigation still loading; checking form: ${navigationError.message}`);
        }

        try {
            await page.waitForSelector('input', { timeout: 10000, visible: true });
        } catch (_) {
            // /login currently opens the home shell first; activate its navigation login panel.
            const opened = await page.evaluate(() => {
                const control = [...document.querySelectorAll('.nav-btn,button,[role="button"]')]
                    .find(element => /^log\s*in$/i.test((element.innerText || '').trim()));
                if (!control) return false;
                control.click();
                return true;
            });
            if (!opened) throw new Error('Login control not found on site');
            await page.waitForSelector('input', { timeout: 30000, visible: true });
        }
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
        try {
            await page.goto(SITE_URL + '/WinGo/WinGo_1M', {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } catch (navigationError) {
            console.warn(`[LOGIN] WinGo page still loading; checking captured token: ${navigationError.message}`);
        }
        await sleep(3000);

        const displayedBalance = await page.evaluate(() => {
            const amountPattern = /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)/i;
            const labels = [...document.querySelectorAll('*')]
                .filter(element => element.children.length === 0 && /wallet\s*balance/i.test(element.textContent || ''));

            for (const label of labels) {
                let parent = label;
                for (let depth = 0; depth < 4 && parent; depth++, parent = parent.parentElement) {
                    const match = (parent.innerText || '').match(amountPattern);
                    if (match) return Number(match[1].replace(/,/g, ''));
                }
            }

            const match = (document.body.innerText || '').match(amountPattern);
            return match ? Number(match[1].replace(/,/g, '')) : null;
        }).catch(() => null);

        if (Number.isFinite(displayedBalance)) {
            balanceFallbacks[String(userId)] = { balance: displayedBalance, capturedAt: Date.now() };
            console.log(`[BALANCE FALLBACK] Wallet page balance captured for user ${userId}: ${displayedBalance}`);
        }

        const cookies = await page.cookies().catch(() => []);
        userSessions[String(userId)] = {
            cookieHeader: cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; '),
            capturedAt: Date.now()
        };
        
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
const BOT_TOKEN    = process.env.BOT_TOKEN || "8670635800:AAEeDoWmav3IL5Pj19shmaSfTHNuLjaT9Lw";
const OWNER_ID     = 8869874751;
const OWNER_PASS   = process.env.OWNER_PASS || "2004";
const ADMIN_HANDLE = "@Sivakutty1";
const REG_LINK     = process.env.REG_LINK || "https://13llottery.com";
const WIN_STICKER  = "CAACAgUAAxkBAAFHUGNp4JX1-ohP4uBEWpfNptaz-HmwVgAC4hgAAhboKVbObuGuTcMs2zsE";
const LOSS_STICKER = "CAACAgUAAxkBAAFHUGVp4JX-BE2TRkhIKTwcjkwW-gzdPAACthoAAoG8YVYiydObSa0O8zsE";

const BET_URL     = "https://api.ar-lottery01.com/api/Lottery/WinGoBet";
const LOGIN_URL   = "https://api.tashanrfv.com/api/webapi/Login";
const CAPTCHA_URL = "https://13llottery.com/api/Home/Captcha";
const API_URL     = process.env.API_URL || "https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json";
const DRAW_URL    = API_URL;
const SITE_URL    = process.env.SITE_URL || "https://13llottery.com";
const LOGIN_PAGE_URL = process.env.LOGIN_PAGE_URL || `${SITE_URL}/login`;
const CHROME_ARGS = [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu',
    '--disable-dev-shm-usage', '--disable-extensions', '--disable-background-networking',
    '--disable-component-update', '--disable-default-apps', '--no-first-run',
    '--no-zygote', '--single-process'
];

// Martingale multipliers — user can customize base bet
const MULT = [1, 3, 9, 27, 81, 243, 729, 2187, 6561, 19683]; // Standard 3x Martingale multipliers
const SIZE_WIN_MULTIPLIER = 1.8;    // User rule: BIG/SMALL gross return multiplier
const NUMBER_WIN_MULTIPLIER = 8.9;  // User rule: exact-number gross return multiplier

// ============================================================
//  RENDER KEEP-ALIVE
// ============================================================
const http = require('http');
const requestedPort = Number(process.env.PORT) || 5000;
const keepAliveServer = http.createServer((req, res) => {
    res.writeHead(200);
    res.end('SIVA BOT OK');
});
function listenKeepAlive(port) {
    keepAliveServer.once('error', error => {
        if (error.code === 'EADDRINUSE') {
            console.warn(`[HTTP] Port ${port} is busy; trying ${port + 1}`);
            listenKeepAlive(port + 1);
            return;
        }
        console.error('[HTTP] Keep-alive server error:', error.message);
    });
    keepAliveServer.listen(port, () => console.log(`✅ Keep-alive server on port ${port}`));
}
listenKeepAlive(requestedPort);

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
    delete balanceFallbacks[key];
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
let balanceFallbacks = {}; // Short-lived wallet values read from the authenticated page.
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
                "Origin": SITE_URL,
                "Referer": SITE_URL,
                "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/139.0.0.0 Safari/537.36"
            },
            timeout: 10000,
            validateStatus: status => status >= 200 && status < 300
        });
        const json = response.data;
        const rawList = Array.isArray(json) ? json :
            Array.isArray(json?.data) ? json.data :
            Array.isArray(json?.data?.list) ? json.data.list :
            Array.isArray(json?.results) ? json.results :
            Array.isArray(json?.records) ? json.records :
            Array.isArray(json?.result?.list) ? json.result.list : [];

        if (!rawList.length) {
            console.error("[FETCH LIST ERROR] Lucifer API response was not a list");
            return null;
        }

        return rawList.map((item, index) => {
            if (typeof item === "string" || typeof item === "number") {
                return { number: String(item).replace(/\D/g, "").slice(-1), issueNumber: String(index) };
            }

            const number = item?.number ?? item?.result ?? item?.resultNumber ??
                item?.num ?? item?.value ?? item?.openNumber ?? item?.winNumber ?? item?.openNum;
            const issueNumber = item?.issue ?? item?.issueNumber ?? item?.period ??
                item?.periodNumber ?? item?.expect ?? item?.id ?? index;

            return {
                ...item,
                number: String(number ?? "").replace(/\D/g, "").slice(-1),
                issueNumber: String(issueNumber)
            };
        }).filter(item => /^[0-9]$/.test(item.number)).sort((a, b) => {
            const ai = String(a.issueNumber);
            const bi = String(b.issueNumber);
            if (/^\d+$/.test(ai) && /^\d+$/.test(bi)) {
                if (ai.length !== bi.length) return bi.length - ai.length;
                return bi.localeCompare(ai);
            }
            return 0;
        });
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
    const session = userSessions[String(userId)] || {};
    const headers = {
        "Authorization": "Bearer " + token,
        "authorization": "Bearer " + token,
        "Accept": "application/json, text/plain, */*",
        "Origin": SITE_URL,
        "Referer": SITE_URL,
        "Ar-Origin": SITE_URL,
        ...(session.cookieHeader ? { "Cookie": session.cookieHeader } : {}),
        "Sec-Ch-Ua": '"Chromium";v="139"',
        "Sec-Ch-Ua-Mobile": "?1",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "cross-site",
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
    };

    try {
        const r = await axios.get(url, { headers, timeout: 10000 });
        const parsed = await parseBalanceResponse(r);
        if (parsed.success) {
            if (!profitTrack[userId]) profitTrack[userId] = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0 };
            profitTrack[userId].walletBalance = Number(parsed.balance) || 0;
        }
        return parsed;
    } catch (e) {
        const responseData = e.response?.data;
        const responseMessage = responseData?.msg || responseData?.message || responseData?.error;
        const errMsg = responseMessage || (e.response?.status ? `HTTP ${e.response.status}` : e.message) || "API Error";
        console.error(`[BALANCE ERROR] status=${e.response?.status || "none"} response=${JSON.stringify(responseData || {})}`);

        const fallback = balanceFallbacks[String(userId)];
        const fallbackAge = fallback ? Date.now() - fallback.capturedAt : Infinity;
        if (e.response?.status === 403 && Number.isFinite(fallback?.balance) && fallbackAge < 10 * 60 * 1000) {
            console.warn(`[BALANCE FALLBACK] Using wallet page value for user ${userId}; age=${Math.round(fallbackAge / 1000)}s`);
            if (!profitTrack[userId]) profitTrack[userId] = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0 };
            profitTrack[userId].walletBalance = fallback.balance;
            return { success: true, balance: fallback.balance, source: "wallet-page" };
        }
        return { success: false, message: errMsg };
    }
}

function initUser(id) {
    userLastSeen[id] = Date.now();
    if (!stats[id])        stats[id]        = { total:0,win:0,loss:0,lossStreak:0,winStreak:0,maxWinStreak:0,maxLossStreak:0,levelWins:{},sizeLevelWins:{},numberLevelWins:{} };
    for (const field of ["total", "win", "loss", "lossStreak", "winStreak", "maxWinStreak", "maxLossStreak"]) {
        if (!Number.isFinite(Number(stats[id][field])) || stats[id][field] < 0) stats[id][field] = 0;
    }
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
        restartDelay: 1,       // NEW: Restart time (hours) set panna
        profitPlan: {
            enabled: false,
            startLevel: 1,
            currentLevel: 1,
            profitSwitchStep: 0,
            nextProfitSwitch: 0,
            balanceSwitches: []
        }
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
    if (!profitTrack[id])  profitTrack[id]  = { totalBets:0, wins:0, losses:0, pnl:0, winStreak:0, lossStreak:0, maxW:0, maxL:0, totalBetAmount: 0, lossStreakHits: 0, lossCarry: 0 };
    if (!Number.isFinite(Number(profitTrack[id].lossCarry)) || profitTrack[id].lossCarry < 0) profitTrack[id].lossCarry = 0;
    if (!Number.isFinite(Number(profitTrack[id].maxW)) || profitTrack[id].maxW < 0) profitTrack[id].maxW = 0;
    if (!Number.isFinite(Number(profitTrack[id].maxL)) || profitTrack[id].maxL < 0) profitTrack[id].maxL = 0;
    if (!Number.isFinite(Number(profitTrack[id].winStreak)) || profitTrack[id].winStreak < 0) profitTrack[id].winStreak = 0;
    if (!Number.isFinite(Number(profitTrack[id].lossStreak)) || profitTrack[id].lossStreak < 0) profitTrack[id].lossStreak = 0;
    if (!Number.isInteger(profitTrack[id].lossStreakHits) || profitTrack[id].lossStreakHits < 0) profitTrack[id].lossStreakHits = 0;
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
                "Origin": SITE_URL,
                "Referer": SITE_URL,
                "Ar-Origin": SITE_URL,
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
async function placeBet(userId, chatId, period, prediction, predType, level, amountOverride) {
    // Missing token is not a relogin trigger. The user must press Login first.
    let token = normalizeToken(getToken(userId));
    if (!token || token.length < 20) {
        await send(chatId, "❌ Token இல்லை. முதலில் 🔐 Login press பண்ணு.");
        return false;
    }

    // Always re-read the repaired canonical token immediately before the request.
    token = getToken(String(userId));
    if (!token || token.length < 20) {
        await send(chatId, '❌ Token missing before bet request.');
        return false;
    }

    const cfg        = autobetCfg[userId];
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

            const session = userSessions[String(userId)] || {};
            const r = await axios.post(BET_URL, payload, {
                headers: {
                    "Authorization":    "Bearer " + normalizeToken(token),
                    "authorization":    "Bearer " + normalizeToken(token),
                    "content-type":     "application/json",
                    "Accept":           "application/json, text/plain, */*",
                    "Origin":           SITE_URL,
                    "Referer":          SITE_URL,
                    "Ar-Origin":        SITE_URL,
                    ...(session.cookieHeader ? { "Cookie": session.cookieHeader } : {}),
                    "Sec-Ch-Ua":        '"Chromium";v="139"',
                    "Sec-Ch-Ua-Mobile": "?1",
                    "Sec-Fetch-Dest":   "empty",
                    "Sec-Fetch-Mode":   "cors",
                    "Sec-Fetch-Site":   "cross-site",
                    "User-Agent":       "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36"
                },
                timeout: 10000
            });
            const d = r.data || {};
            const apiMessage = String(d.msg ?? d.message ?? d.msgCode ?? "");
            console.log(`[BET RESP] code:${d.code} msg:${apiMessage}`);

            // A bet response may rotate the token. Accept it only after bet success.
            // If no valid token is returned, keep the current token unchanged.
            const responseToken = normalizeToken(
                r.headers['authorization'] ||
                r.headers['x-auth-token'] ||
                d.data?.token ||
                d.token
            );

            // Success case
            if (d.code === 0 || d.msg === "Succeed" || d.msgCode === 0) {
                if (responseToken && responseToken.length >= 20) {
                    const updated = saveUserToken(userId, responseToken);
                    if (updated) {
                        token = responseToken;
                        console.log("[TOKEN UPDATE] Valid token saved after successful bet.");
                    } else {
                        console.warn("[TOKEN UPDATE] Token cache failed; existing token kept.");
                    }
                }
                return { ok: true, amt: betMult, bc };
            }
            if (d.code === 0 || d.msg === "Succeed" || d.msgCode === 0) {
                return { ok: true, amt: betMult, bc };
            }

            // Token Expiry Handling -> AUTOMATIC RELOGIN
            if (d.code === 401 || d.code === 40100 || d.status === 401 || isTokenExpiredMessage(apiMessage)) {
                console.log("[AUTO RELOGIN] Token expired during bet. Keeping old token until relogin succeeds...");
                const oldToken = getToken(userId);
                const freshToken = await autoLogin(userId, chatId, true);
                if (freshToken) {
                    const verifiedFreshToken = getToken(userId);
                    if (verifiedFreshToken) {
                        token = verifiedFreshToken;
                        console.log("[AUTO RELOGIN] Success! Verified new token; retrying the bet...");
                        continue;
                    }
                    token = oldToken;
                    await send(chatId, "❌ Relogin completed but no new verified token was received.");
                    return false;
                } else {
                    token = oldToken;
                    await send(chatId, "❌ Auto-login failed. Existing token was kept.");
                    return false;
                }
            }

            // Retryable errors like Param is Invalid, issue number, etc.
            const retryableErrors = ["param is invalid", "the issue number does not exist", "period current settled"];
            const lowerMsg = String(apiMessage).toLowerCase();
            
            if (retryableErrors.some(errStr => lowerMsg.includes(errStr))) {
                console.log(`[BET RETRY] Retryable error: ${d.msg}. Retrying in ${retryDelayMs / 1000}s... (Attempt ${i + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                continue; 
            }

            // Other unhandled API errors
            await send(chatId, "❌ Bet fail: " + (apiMessage || JSON.stringify(d).substr(0, 120)));
            return false;

        } catch (err) {
            console.error("[BET ERR]", err.message);

            // Handle Axios 401 / Token errors inside catch block
            const responseMessage = err.response?.data?.msg || err.response?.data?.message || '';
            if (err.response && (err.response.status === 401 || isTokenExpiredMessage(responseMessage))) {
                console.log("[AUTO RELOGIN] Token error caught via exception. Keeping old token until relogin succeeds...");
                const oldToken = token;
                const loginSuccess = await autoLogin(userId, chatId, true);
                if (loginSuccess) {
                    const verifiedFreshToken = getToken(userId);
                    if (verifiedFreshToken) {
                        token = verifiedFreshToken;
                        continue; // Retry after verified relogin
                    }
                    token = oldToken;
                    await send(chatId, "❌ Relogin completed but no new verified token was received.");
                    return false;
                } else {
                    token = oldToken;
                    await send(chatId, "❌ Auto-login failed. Existing token was kept.");
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

function generateLevelTotals(amount, levels) {
    const safeAmount = Math.floor(Number(amount));
    const safeLevels = Number(levels);
    if (!Number.isFinite(safeAmount) || safeAmount <= 0 || !Number.isInteger(safeLevels) || safeLevels <= 0 || safeAmount < safeLevels) return null;
    if (safeLevels === 1) return [safeAmount];

    const reference = [47, 127, 322, 804];
    if (safeLevels === 4) {
        const totalWeight = reference.reduce((sum, value) => sum + value, 0);
        const totals = reference.map(value => Math.floor(safeAmount * value / totalWeight));
        totals[totals.length - 1] += safeAmount - totals.reduce((sum, value) => sum + value, 0);
        return totals;
    }

    const weights = Array.from({ length: safeLevels }, (_, index) => 2.5 ** index);
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const totals = weights.map(weight => Math.floor(safeAmount * weight / totalWeight));
    totals[totals.length - 1] += safeAmount - totals.reduce((sum, value) => sum + value, 0);
    return totals;
}

function createWalletPlan(walletBalance, levels) {
    const totals = generateLevelTotals(walletBalance, levels);
    if (!totals) return [];
    return totals.map((total, index) => {
        const bs = Math.round(total * 0.82);
        return { level: index + 1, bs, number: total - bs, total };
    });
}

function getBalanceSwitchLevel(plan, walletBalance) {
    const fallback = Math.max(1, Math.min(10, Number(plan.startLevel) || 1));
    const switches = Array.isArray(plan.balanceSwitches) ? plan.balanceSwitches : [];
    return switches.reduce((level, rule) => {
        return walletBalance >= Number(rule.balance) ? Number(rule.level) : level;
    }, fallback);
}

function syncProfitPlan(userId, reason = "balance", planBalance = null, maxLevel = null) {
    const cfg = autobetCfg[userId];
    if (!cfg || !cfg.profitPlan || !cfg.profitPlan.enabled) return false;

    const plan = cfg.profitPlan;
    const walletBalance = Number(profitTrack[userId]?.walletBalance || 0);
    const configuredBalance = Math.floor(Number(planBalance ?? plan.planBalance ?? walletBalance));
    const configuredMaxLevel = Number(maxLevel ?? plan.maxLevel ?? cfg.maxLvl);
    const levels = Math.floor(configuredMaxLevel);
    if (configuredBalance <= 0 || !Number.isInteger(levels) || levels <= 0 || levels > 10 || configuredBalance < levels) return false;
    const startLevel = Math.min(levels, getBalanceSwitchLevel(plan, configuredBalance));
    const walletPlan = createWalletPlan(Math.max(0, configuredBalance), levels);
    const totals = walletPlan.map(row => row.total);
    const sizeBets = walletPlan.map(row => row.bs);
    const numberBets = walletPlan.map(row => row.number);

    plan.currentLevel = startLevel;
    plan.lastReason = reason;
    plan.walletBalance = walletBalance;
    plan.planBalance = configuredBalance;
    plan.maxLevel = levels;
    plan.levels = walletPlan;
    cfg.customBets = cfg.mode === "NUMBER" ? [...numberBets] : cfg.mode === "COMBINED" ? [...totals] : [...sizeBets];
    cfg.customSizeBets = sizeBets;
    cfg.customNumberBets = numberBets;
    cfg.maxLvl = walletPlan.length;

    // Losses keep martingale progression; wins restart at the balance-selected level.
    if (autobetState[userId] && reason !== "loss") {
        autobetState[userId].level = startLevel;
        autobetState[userId].sizeLevel = startLevel;
        autobetState[userId].numberLevel = startLevel;
    }

    return true;
}

async function refreshWalletPlan(userId, reason, planBalance = null, maxLevel = null) {
    const cfg = autobetCfg[userId];
    if (!cfg?.profitPlan?.enabled) return false;
    const balance = await getLiveBalance(userId);
    if (!balance.success) {
        console.warn(`[PLAN] Wallet refresh failed for user ${userId}: ${balance.message}`);
        return false;
    }
    return syncProfitPlan(userId, reason, balance.balance, maxLevel);
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

function calculateSettlement(bets, actualSize, actualNumber) {
    // Gross returns include the original stake; subtract every placed stake for net P&L.
    const normalized = Array.isArray(bets) ? bets : [];
    const totalStake = normalized.reduce((sum, bet) => sum + Math.max(0, Number(bet.amt) || 0), 0);
    let payout = 0;
    const reasons = [];

    for (const bet of normalized) {
        const amount = Math.max(0, Number(bet.amt) || 0);
        const won = bet.type === "SIZE"
            ? String(bet.val).toUpperCase() === String(actualSize).toUpperCase()
            : bet.type === "NUMBER" && Number(bet.val) === Number(actualNumber);
        if (!won) continue;

        if (bet.type === "SIZE") {
            payout += amount * SIZE_WIN_MULTIPLIER;
            reasons.push("SIZE");
        } else if (bet.type === "NUMBER") {
            payout += amount * NUMBER_WIN_MULTIPLIER;
            reasons.push("NUMBER");
        }
    }

    return {
        won: reasons.length > 0,
        pnl: payout - totalStake,
        reason: reasons.join("+") || "NONE",
        totalStake,
        payout
    };
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
    const anyPredictionWon = Boolean(sizeWon || numberWon);
    if (anyPredictionWon) {
        st.lastWinLevel = st.level;
        st.lastWinMode = "COMBINED";
        st.sizeLevel = 1;
        st.numberLevel = 1;
        st.level = 1;
        st.inMart = false;
        st.consecutiveLoss = 0;
        st.lossStreakHitRecorded = false;
    } else {
        st.consecutiveLoss++;
        recordLossStreakHit(userId);
        const maxLevel = Math.max(1, Number(cfg.maxLvl) || 1);
        const currentSizeLevel = Math.min(maxLevel, Math.max(1, Number(st.sizeLevel) || 1));
        const currentNumberLevel = Math.min(maxLevel, Math.max(1, Number(st.numberLevel) || 1));
        st.sizeLevel = currentSizeLevel >= maxLevel ? 1 : currentSizeLevel + 1;
        st.numberLevel = currentNumberLevel >= maxLevel ? 1 : currentNumberLevel + 1;
        st.level = Math.max(st.sizeLevel, st.numberLevel);
        st.inMart = st.level > 1;
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

function getSide(n) {
    return Number(n) >= 5 ? 'BIG' : 'SMALL';
}

function getPredictionSelection(lastResult, historyResults) {
    const n = Number(lastResult);
    if (!Number.isInteger(n) || n < 0 || n > 9 || !Array.isArray(historyResults) || historyResults.length < 2) return null;

    const predictionSize = getSide(n);
    const oppositeSize = predictionSize === 'BIG' ? 'SMALL' : 'BIG';
    let selectedNumber = null;
    let selectedIndex = -1;

    for (let index = 1; index < historyResults.length; index++) {
        const candidate = latestResultNumber(historyResults[index]);
        if (candidate !== null && getSide(candidate) === oppositeSize) {
            selectedNumber = candidate;
            selectedIndex = index;
            break;
        }
    }

    if (selectedNumber === null) return null;

    return {
        mapping: [predictionSize, selectedNumber],
        mode: 'OPPOSITE_SIZE_MOST_RECENT',
        candidates: [selectedNumber],
        matchedApiIndex: selectedIndex,
        decisionReason: `Selected most-recent ${oppositeSize} number`
    };
}

function numberPrediction(lastResult, historyResults = []) {
    const selected = getPredictionSelection(lastResult, historyResults);
    if (!selected) return null;
    return {
        size: selected.mapping[0],
        number: selected.mapping[1],
        mode: selected.mode,
        decisionReason: selected.decisionReason
    };
}

function latestResultNumber(item) {
    const raw = item?.number ?? item?.result ?? item?.resultNumber ?? item?.num ?? item?.value ?? item?.winNumber;
    const n = Number.parseInt(String(raw ?? '').trim(), 10);
    return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}

function shouldSkipByThreeMatches(lastResult, historyResults) {
    const target = Number(lastResult);
    if (!Number.isInteger(target) || !Array.isArray(historyResults) || historyResults.length < 4) {
        return { skip: false, matches: [], reason: 'Not enough API history for 3-match check' };
    }

    const matches = [];
    for (let index = 1; index < historyResults.length; index++) {
        const matchNumber = latestResultNumber(historyResults[index]);
        const nextNumber = latestResultNumber(historyResults[index - 1]);
        if (matchNumber !== target || nextNumber === null) continue;

        matches.push({
            matchNumber,
            nextNumber,
            nextSize: getSide(nextNumber)
        });

        if (matches.length === 3) break;
    }

    if (matches.length < 3) {
        return {
            skip: false,
            matches,
            reason: `Only ${matches.length} historical match(es) found; 3 required`
        };
    }

    const sizes = matches.map(match => match.nextSize);
    const allBig = sizes.every(size => size === 'BIG');
    const allSmall = sizes.every(size => size === 'SMALL');
    return {
        skip: allBig || allSmall,
        matches,
        reason: allBig
            ? 'Latest 3 matches all have BIG as the next result'
            : allSmall
                ? 'Latest 3 matches all have SMALL as the next result'
                : 'Latest 3 next-result sizes are mixed; prediction allowed'
    };
}

async function decidePrediction(list, currentPeriod, userId) {
    initState(userId);
    const history = Array.isArray(list) ? list.slice().sort((a, b) => {
        const ai = String(a?.issueNumber ?? a?.issue ?? '');
        const bi = String(b?.issueNumber ?? b?.issue ?? '');
        if (/^\d+$/.test(ai) && /^\d+$/.test(bi)) {
            if (ai.length !== bi.length) return bi.length - ai.length;
            return bi.localeCompare(ai);
        }
        return 0;
    }) : [];

    const latest = history.length ? latestResultNumber(history[0]) : null;
    const skipCheck = latest !== null ? shouldSkipByThreeMatches(latest, history) : null;
    if (skipCheck?.skip) {
        return { skip: true, reason: skipCheck.reason, skipMatches: skipCheck.matches };
    }

    let selected = latest !== null ? getPredictionSelection(latest, history) : null;
    if (!selected) return { skip: true, reason: 'API returned no valid latest result' };


    const [size, number] = selected.mapping;
    userStates[userId].lastPrediction = size;
    userStates[userId].lastNumberPrediction = number;
    userStates[userId].lastPredictionNumber = latest;
    userStates[userId].lastSelectionMode = selected.mode;
    console.log(`[SAME-NUMBER SWAP] last=${latest} mode=${selected.mode} -> ${size} ${number} | ${selected.decisionReason}`);
    return {
        type: 'COMBINED',
        val: size,
        number,
        pat: 'MATCHED SAME-LAST-RESULT HISTORY',
        mode: selected.mode,
        decisionReason: selected.decisionReason,
        bets: [
            { type: 'SIZE', val: size, kind: 'size' },
            { type: 'NUMBER', val: number, kind: 'number' }
        ]
    };
}

function recordLossStreakHit(userId) {
    const st = autobetState[userId];
    const cfg = autobetCfg[userId] || {};
    const pt = profitTrack[userId];
    const threshold = Math.max(1, Number(cfg.watchLoss) || 1);
    if (st.consecutiveLoss >= threshold && !st.lossStreakHitRecorded) {
        pt.lossStreakHits = (pt.lossStreakHits || 0) + 1;
        st.lossStreakHitRecorded = true;
    }
}

function updateAfterResult(userId, wasWin, actual, betPlaced) {
    initUser(userId);
    if (typeof autobetState !== 'undefined' && autobetState[userId]) {
        const st = autobetState[userId];
        const cfg = autobetCfg[userId] || {};
        if (betPlaced) {
            if (wasWin) {
                st.lastWinLevel = st.level;
                st.lastWinMode = cfg.mode || "SIZE";
                st.level = 1;
                st.sizeLevel = 1;
                st.numberLevel = 1;
                st.inMart = false;
                st.consecutiveLoss = 0;
                st.lossStreakHitRecorded = false;
            }
            else {
                st.consecutiveLoss++;
                const maxLevel = Math.max(1, Number(cfg.maxLvl) || 1);
                const currentLevel = Math.min(maxLevel, Math.max(1, Number(st.level) || 1));
                st.level = currentLevel >= maxLevel ? 1 : currentLevel + 1;
                st.sizeLevel = st.level;
                st.numberLevel = st.level;
                st.inMart = st.level > 1;
                recordLossStreakHit(userId);
            }
        } else if (cfg.watch) {
            if (wasWin) {
                st.consecutiveLoss = 0;
                st.lossStreakHitRecorded = false;
            } else {
                st.consecutiveLoss++;
                recordLossStreakHit(userId);
            }
        }
    }
}

function getStatus(userId) { initState(userId); return "SITE_ONLY"; }

function levelMapText(map) {
    const entries = Object.entries(map || {}).filter(([,v]) => Number(v) > 0).sort((a,b) => Number(a[0].slice(1)) - Number(b[0].slice(1)));
    return entries.length ? entries.map(([level,count]) => level + ":" + count).join(" | ") : "None";
}

function formatMartingale(cfg) {
    if (cfg.mode === "COMBINED") {
        return "Size: ₹" + cfg.customSizeBets.slice(0, cfg.maxLvl).join(" → ₹") +
            "\nNumber: ₹" + cfg.customNumberBets.slice(0, cfg.maxLvl).join(" → ₹");
    }
    const sequence = cfg.mode === "NUMBER" ? cfg.customNumberBets : cfg.customBets;
    return "Bet: ₹" + sequence.slice(0, cfg.maxLvl).join(" → ₹");
}

function getStatus(userId) {
    initState(userId);
    const state = userStates[userId];
    return state.mode;
}

async function sendResultAmountLine(chatId, userId, label, amount) {
    const balance = await getLiveBalance(userId);
    const pnl = Number(profitTrack[userId]?.pnl || 0);
    const balanceText = balance.success
        ? "₹" + Math.floor(Number(balance.balance) || 0)
        : "Unavailable";
    const sign = label === "Profit" ? "+" : "-";
    await send(chatId, label + ": " + sign + "₹" + Math.floor(Math.abs(Number(amount) || 0)) + " | P&L: " + (pnl >= 0 ? "+" : "-") + "₹" + Math.floor(Math.abs(pnl)) + " | Balance: " + balanceText);
}

// ============================================================
// 2. handleWin - UI & Stats
// ============================================================
async function handleWin(userId, chatId, actual, num, betLevel, bets = [], settlement = null) {
    const pt = profitTrack[userId];
    const amt = bets.length ? bets.reduce((sum, b) => sum + Number(b.amt || 0), 0) : getSequenceAmount(userId, betLevel);
    const roundNet = settlement
        ? Number(settlement.pnl) || 0
        : amt * (autobetCfg[userId].mode === "NUMBER" ? NUMBER_WIN_MULTIPLIER - 1 : SIZE_WIN_MULTIPLIER - 1);
    const previousLoss = Math.max(0, Number(pt.lossCarry) || 0);
    const recoveredLoss = Math.min(previousLoss, Math.max(0, roundNet));
    const profit = roundNet - recoveredLoss;
    pt.lossCarry = Math.max(0, previousLoss - recoveredLoss);
    
    pt.totalBets++; pt.wins++; pt.pnl += profit; 
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.winStreak++; pt.lossStreak = 0;
    if(pt.winStreak > pt.maxW) pt.maxW = pt.winStreak;
    const plan = autobetCfg[userId].profitPlan;
    const switchStep = Math.floor(Number(plan?.profitSwitchStep) || 0);
    const hasBalanceSwitches = plan?.enabled && Array.isArray(plan.balanceSwitches) && plan.balanceSwitches.length > 0;
    const shouldSwitchPlan = !plan?.enabled || switchStep <= 0 || pt.pnl >= Number(plan.nextProfitSwitch || switchStep) || hasBalanceSwitches;
    if (shouldSwitchPlan) {
        const previousLevel = Number(plan?.currentLevel) || 1;
        await refreshWalletPlan(userId, "win");
        if (plan?.enabled && switchStep > 0) {
            plan.nextProfitSwitch = (Math.floor(pt.pnl / switchStep) + 1) * switchStep;
        }
        if (plan?.enabled) {
            const currentLevel = Number(plan.currentLevel) || 1;
            const sizePlan = (autobetCfg[userId].customSizeBets || []).slice(0, autobetCfg[userId].maxLvl).join(" → ₹");
            const numberPlan = (autobetCfg[userId].customNumberBets || []).slice(0, autobetCfg[userId].maxLvl).join(" → ₹");
            const switchLabel = currentLevel !== previousLevel ? "💰 Balance switch" : "🔄 Plan switched";
            await send(chatId,
                switchLabel + ": L" + previousLevel + " → L" + currentLevel +
                "\nSize: ₹" + sizePlan +
                "\nNumber: ₹" + numberPlan
            );
        }
    }

    await sendResultAmountLine(chatId, userId, "Profit", profit);
    await sendSticker(chatId, WIN_STICKER);
}

// ============================================================
// 3. handleLoss - UI & Stats
// ============================================================
async function handleLoss(userId, chatId, actual, num, betLevel, bets = [], settlement = null) {
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const amt = bets.length ? bets.reduce((sum, b) => sum + Number(b.amt || 0), 0) : getSequenceAmount(userId, betLevel);
    
    const roundLoss = settlement
        ? Math.max(0, -(Number(settlement.pnl) || 0))
        : amt;
    pt.lossCarry = (Number(pt.lossCarry) || 0) + roundLoss;
    pt.totalBets++; pt.losses++; pt.pnl -= roundLoss;
    pt.totalBetAmount = (pt.totalBetAmount || 0) + amt;
    pt.lossStreak++; pt.winStreak = 0;
    if(pt.lossStreak > pt.maxL) pt.maxL = pt.lossStreak;

    const plan = autobetCfg[userId].profitPlan;
    if (plan?.enabled && Array.isArray(plan.balanceSwitches) && plan.balanceSwitches.length > 0) {
        await refreshWalletPlan(userId, "loss");
    }

    await sendResultAmountLine(chatId, userId, "Loss", amt);
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
    if (signal.skip === true) {
        console.log(`[PREDICTION] Skipping period ${next}: ${signal.reason || "skip result"}`);
        scheduleRun(userId, chatId, 8000);
        runInFlight.delete(runKey);
        return;
    }
    let abLine = "🤖 AutoBet: OFF";
    let canBet = false;

    if (!cfg || !cfg.enabled) {
        abLine = "🤖 AutoBet: OFF";
        canBet = false;
    } else {
        canBet = true;
        const sequence = cfg.mode === "NUMBER" ? cfg.customNumberBets : cfg.customBets;
        const curBet = sequence[st.level - 1] ?? (cfg.baseBet * (MULT[st.level - 1] || 1));
        abLine = (st.level > 1 ? "📈 MART " : "💰 BET ") + "L" + st.level + ": ₹" + curBet;
    }

    const patternName = signal && signal.pat ? signal.pat : (state && state.mode ? state.mode : "NORMAL");
    const waitLine = "";

    await send(chatId,
"╔══════════════════════════╗\n"+
"║    👑 EARN WITH ME AI    ║\n"+
"╠══════════════════════════╣\n"+
"║ Period  : "+next.slice(-6)+"\n"+
"║ Mode    : "+modeLabel(cfg.mode)+"\n"+
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
            : cfg.mode === "NUMBER"
                ? [numberSpec].filter(Boolean)
                : [sizeSpec].filter(Boolean);
        const combinedAmounts = getCombinedBetAmounts(userId, st.sizeLevel, st.numberLevel);
        for (const spec of specs) {
            const isNumber = spec.type === "NUMBER";
            const levelForBet = cfg.mode === "COMBINED"
                ? (isNumber ? combinedAmounts.numberLevel : combinedAmounts.sizeLevel)
                : st.level;
            const sequence = isNumber ? cfg.customNumberBets : cfg.customBets;
            const amount = cfg.mode === "COMBINED"
                ? (isNumber ? combinedAmounts.number : combinedAmounts.size)
                : (sequence[levelForBet - 1] ?? (cfg.baseBet * (MULT[levelForBet - 1] || 1)));
            const result = await placeBet(userId, chatId, next, spec.val, spec.type, levelForBet, amount);
            if (result && result.ok) placedBets.push({ ...spec, amt: result.amt, level: levelForBet });
            else await send(chatId, "❌ Bet Failed (" + spec.type + "): " + (result?.msg || "Unknown error"));
        }
        if (cfg.mode === "COMBINED" && placedBets.length !== 2) {
            // Never treat a partial combined pair as a valid combined settlement.
            await send(chatId, "⚠️ Combined bet incomplete for period " + next + ". Expected exactly 1 size + 1 number; settlement will use only the confirmed stake.");
        }
        if (placedBets.length) {
            const levelText = cfg.mode === "COMBINED"
                ? "Size L" + combinedAmounts.sizeLevel + " / Number L" + combinedAmounts.numberLevel
                : "L" + st.level;
            await send(chatId, "✅ Bets Success: " + placedBets.length + " | " + levelText + "\n" + placedBets.map(b => b.type + "=" + b.val + " ₹" + b.amt).join("\n") + "\n⏳ Checking result...");
        }
    }

    // Pass the signal bets separately so WATCH mode can evaluate predictions even when AutoBet is OFF.
    const rawPredictedBets = signal.bets || [{ type: signal.type, val: signal.val, kind: signal.type === "NUMBER" ? "number" : "size" }];
    const predictedBets = cfg.mode === "COMBINED"
        ? rawPredictedBets.filter(spec => spec.type === "SIZE" || spec.type === "NUMBER")
        : cfg.mode === "NUMBER"
            ? rawPredictedBets.filter(spec => spec.type === "NUMBER")
            : rawPredictedBets.filter(spec => spec.type === "SIZE");
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
        if (!/^\d+$/.test(String(list[0]?.issueNumber || ""))) {
            releaseResultCheck();
            scheduleRun(userId, chatId, 5000);
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
        const settlement = betPlaced ? calculateSettlement(bets, actualSize, num) : null;
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
                await sendSticker(chatId, WIN_STICKER);
            } else {
                await sendSticker(chatId, LOSS_STICKER);
            }
        }

        const predictionHistory = userStates[userId].resultHistory || [];
        predictionHistory.unshift({
            latestResultNumber: userStates[userId].lastPredictionNumber,
            status: win ? "WIN" : "LOSE",
            mappingMode: userStates[userId].lastSelectionMode
        });
        userStates[userId].resultHistory = predictionHistory.slice(0, 100);

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
    initUser(userId);
    const d = stats[userId];
    const st = autobetState[userId];
    const pt = profitTrack[userId];
    const total = Number(d.total) || 0;
    const rate = total ? ((d.win / total) * 100).toFixed(1) : "0.0";
    const bar = "🟦".repeat(total ? Math.round(d.win / total * 10) : 0) + "⬜".repeat(total ? 10 - Math.round(d.win / total * 10) : 10);
    const history = userStates[userId]?.resultHistory || [];
    const primary = history.filter(item => item.mappingMode === "PRIMARY");
    const alternative = history.filter(item => item.mappingMode === "ALTERNATIVE");
    const mappingLine = modeItems => {
        const wins = modeItems.filter(item => item.status === "WIN").length;
        return modeItems.length ? `${wins}W/${modeItems.length - wins}L (${((wins / modeItems.length) * 100).toFixed(1)}%)` : "None";
    };
    send(chatId,
"📊 DETAILED STATS\n\n"+
"Results     : "+total+"\n"+
"Wins/Losses : "+(d.win||0)+" / "+(d.loss||0)+"\n"+
"Accuracy    : "+rate+"%\n"+bar+"\n\n"+
"Current     : L"+st.level+(autobetCfg[userId].mode === "COMBINED" ? " (S"+st.sizeLevel+"/N"+st.numberLevel+")" : "")+"\n"+
"Win streak  : "+(d.winStreak||0)+" | Best: "+(d.maxWinStreak||0)+"\n"+
"Loss streak : "+(d.lossStreak||0)+" | Worst: "+(d.maxLossStreak||0)+"\n"+
"Streak hits : "+(pt.lossStreakHits||0)+" (threshold L"+(autobetCfg[userId].watchLoss||1)+")\n"+
"P&L         : "+(pt.pnl>=0?"+":"")+Number(pt.pnl||0).toFixed(2)+"\n"+
"Loss carry  : ₹"+Number(pt.lossCarry||0).toFixed(2)+"\n"+
"Staked      : ₹"+Number(pt.totalBetAmount||0).toFixed(2)+"\n\n"+
"Level wins  : "+levelMapText(d.levelWins)+"\n"+
"Level usage : "+levelMapText(st.levelHistory)+"\n"+
"PRIMARY     : "+mappingLine(primary)+"\n"+
"ALTERNATIVE : "+mappingLine(alternative)
    );
}
async function profitReport(chatId,userId){
    initUser(userId);
    const pt=profitTrack[userId],cfg=autobetCfg[userId];
    const rate=pt.totalBets?((pt.wins/pt.totalBets)*100).toFixed(1):"0.0";
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
"Loss carry: ₹"+Number(pt.lossCarry||0).toFixed(2)+"\n"+
"Streak : "+pt.winStreak+"W / "+pt.lossStreak+"L\n"+
"Streak hits: "+(pt.lossStreakHits||0)+" (threshold L"+(cfg.watchLoss||1)+")\n"+
"Best W : "+Number(pt.maxW||0)+" | Max loss streak: "+Number(pt.maxL||0)+"\n"+
"Staked : ₹"+Number(pt.totalBetAmount||0).toFixed(2)+"\n"+
"Level  : L"+autobetState[userId].level+" / "+cfg.maxLvl+"\n"+
(cfg.profitPlan?.enabled ? "Plan   : ON | Balance ₹"+Number(cfg.profitPlan.planBalance||0).toFixed(0)+" | Max L"+cfg.profitPlan.maxLevel+"\n" : "Plan   : OFF\n")+
"Profit switch: "+(cfg.profitPlan?.profitSwitchStep ? "Every ₹"+cfg.profitPlan.profitSwitchStep+" (next ₹"+cfg.profitPlan.nextProfitSwitch+")" : "OFF")+"\n"+
"\n"+
formatMartingale(cfg)
    );
}
async function autobetStatus(chatId, userId) {
    initUser(userId);
    const cfg = autobetCfg[userId], st = autobetState[userId], pt = profitTrack[userId];
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
"Profit switch: "+(cfg.profitPlan?.profitSwitchStep ? "Every ₹"+cfg.profitPlan.profitSwitchStep+" (next ₹"+cfg.profitPlan.nextProfitSwitch+")" : "OFF")+"\n"+
"Section Delay: "+cfg.restartDelay+" mins"+ // Hours-la irunthu Minutes-ku mathi irukken
waitLine+"\n"+
"In Mart  : "+(st.inMart?"YES":"NO")+"\n"+
(cfg.mode === "COMBINED" ? "Size L"+st.sizeLevel+" | Number L"+st.numberLevel+"\n" : "Current  : L"+st.level+"\n")+
"Last Win : "+(st.lastWinLevel?"L"+st.lastWinLevel+" ("+(st.lastWinMode||cfg.mode)+")":"None")+"\n"+
(cfg.mode === "COMBINED" ? "Size Hist: "+(Object.entries(st.sizeLevelHistory||{}).map(([level,count]) => level+":"+count).join(" | ") || "None")+"\nNumber Hist: "+(Object.entries(st.numberLevelHistory||{}).map(([level,count]) => level+":"+count).join(" | ") || "None")+"\n" : "History  : "+(Object.entries(st.levelHistory||{}).map(([level,count]) => level+":"+count).join(" | ") || "None")+"\n")+
"Wins Lvl : "+(cfg.mode === "COMBINED" ? "Size "+levelMapText(stats[userId].sizeLevelWins)+" | Number "+levelMapText(stats[userId].numberLevelWins) : levelMapText(stats[userId].levelWins))+"\n"+
"P&L      : "+(pt.pnl>=0?"+":"")+pt.pnl.toFixed(2)+"\n\n"+
"Loss carry: ₹"+Number(pt.lossCarry||0).toFixed(2)+"\n\n"+
formatMartingale(cfg)
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
    ["📈 Profit Plan ON","📉 Profit Plan OFF"],
    ["💰 Set Base Bet","📈 Set Max Level"],
    ["🧠 Set Plan Level","🎯 Set Profit Target"],
    ["💹 Set Profit Switch"],
    ["🔁 Set Balance Switch","🗑 Clear Balance Switch"],
    ["⏳ Set Section Delay","🔢 Set Watch Losses"],
    ["📊 AutoBet Status","🔀 Customize Bet"],
    ["🎮 Mode: Big/Small","🔢 Mode: Number"],
    ["🔀 Mode: BigSmall+Number","🔙 Back"]
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

     bot.onText(/\/(?:setcreds|setcredts) ?(.*)/,(msg,match)=>{
        const id=String(msg.from.id);
        if(!hasAccess(id))return send(id,"❌ No access.");
        const rest = (match[1] || "").trim();
        if (rest && rest.includes(" ")) {
            const parts = rest.split(/\s+/);
            const phone = parts[0].trim();
            const pass = parts.slice(1).join(" ");
            if (!/^\d{10,15}$/.test(phone)) {
                return send(id, "❌ Invalid mobile number. Use 10-15 digits, for example: 916381605525");
            }
            if (!pass.trim()) {
                return send(id, "❌ Password cannot be empty. Use: /setcreds MOBILE PASSWORD  (or /setcredts)");
            }
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


    bot.onText(/^\/setmytoken(?:\s+)(.+)$/i, async (msg, match) => {
        const id = String(msg.from.id);
        if (!hasAccess(id)) return send(id, "❌ No access.");

        const applied = applyMyToken(id, match[1]);
        if (!applied.ok) return send(id, "❌ " + applied.reason + "!");

        const balResult = await getLiveBalance(id, msg.chat.id);
        let balanceLine = "";
        if (balResult.success) {
            balanceLine = "\n💰 Live Balance: ₹" + balResult.balance;
        } else if (balResult.message) {
            balanceLine = "\n⚠️ Balance: " + balResult.message;
        }

        return send(
            id,
            "✅ Token loaded in bot memory!\n..." + applied.token.slice(-12) + balanceLine +
                "\n🤖 Now press 🔐 Login or ✅ Enable AutoBet"
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

        await send(chatId, "🔄 Starting website login...");
        const loginResult = await autoLogin(id, chatId, false);
        // autoLogin() already applied the token through applyMyToken().
        const cachedToken = getToken(String(id));
        if (cachedToken) {
            console.log(`[TOKEN CACHE VERIFIED] user=${String(id)}; length=${cachedToken.length}`);
            const balResult = await getLiveBalance(id, chatId);
            let balanceLine = "";
            if (balResult.success) {
                balanceLine = "\n💰 Live Balance: ₹" + balResult.balance;
            } else if (balResult.message) {
                balanceLine = "\n⚠️ Balance: " + balResult.message;
            }
            await send(chatId, "✅ Login Success!\n🔑 GetBalance token saved in bot memory: ..." + cachedToken.slice(-12) + balanceLine + "\n🤖 Now press ✅ Enable AutoBet");
        } else if (loginResult) {
            await send(chatId, "❌ Login completed, but no verified GetBalance token was saved. Please try Login again.");
        } else {
            await send(chatId, "❌ Login failed. Check the credentials, website response, or CAPTCHA result and try again.");
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
            const targetProfit = Number(cfg.targetProfit) || 1000;
            return send(id,
"🤖 AUTOBET SETTINGS\n\n"+
"Status   : "+(cfg.enabled?"✅ ON":"❌ OFF")+"\n"+
"Token    : "+(getToken(id).length>20?"✅ SET":"❌ MISSING")+"\n"+
"AutoLogin: "+(creds.phone?"✅ "+creds.phone.slice(0,6)+"***":"❌ /setcreds  (or /setcredts)")+"\n"+
"Mode     : "+modeLabel(cfg.mode)+"\n"+
    (cfg.mode === "COMBINED" ? "Size Seq : ₹"+cfg.customSizeBets.join(" → ₹")+"\nNum Seq  : ₹"+cfg.customNumberBets.join(" → ₹")+"\nRule     : 1 site size + 1 site number\n" : "Bet Seq  : ₹"+cfg.customBets.join(" → ₹")+"\n")+
"Watch    : "+(cfg.watch?"ON":"OFF")+"\n"+
"WatchLoss: "+cfg.watchLoss+" consecutive\n"+
"Base Bet : ₹"+cfg.baseBet+"\n"+
"Max Level: "+cfg.maxLvl+"\n"+
"Target   : ₹"+targetProfit+"\n\n"+
formatMartingale(cfg)+"\n\n"+
"/setcreds 916381605525 PASSWORD  (or /setcredts)\n"+
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
        if(text==="📈 Profit Plan ON") {
            userAction[id] = {action: "setprofitplaninput"};
            return send(id, "Enter max level:\nExample: 5\n\nThe actual wallet balance will be fetched automatically. Max level must be 1-10.");
        }
        if(text==="📉 Profit Plan OFF") {
            autobetCfg[id].profitPlan = autobetCfg[id].profitPlan || { enabled: false, startLevel: 1, currentLevel: 1 };
            autobetCfg[id].profitPlan.enabled = false;
            return send(id, "📉 Profit-based plan OFF", {reply_markup: autobetMenu});
        }
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
        if(text==="🧠 Set Plan Level"){userAction[id]={action:"setprofitplanlevel"};return send(id,"Enter plan start level (1-10):");}
        if(text==="💹 Set Profit Switch"){
            userAction[id]={action:"setprofitswitch"};
            return send(id,"Enter profit switch amount in whole rupees:\nExample: 5 or 10\n\nThe plan switches after each cumulative profit step.");
        }
        if(text==="🔁 Set Balance Switch"){
            userAction[id]={action:"setbalanceswitch"};
            return send(id,"Enter balance switches, for example:\n5000:2,10000:4,25000:6\n\nFormat: balance:level");
        }
        if(text==="🗑 Clear Balance Switch"){
            autobetCfg[id].profitPlan = autobetCfg[id].profitPlan || { enabled:false, startLevel:1, currentLevel:1, balanceSwitches:[] };
            autobetCfg[id].profitPlan.balanceSwitches = [];
            if (autobetCfg[id].profitPlan.enabled) await refreshWalletPlan(id, "switch-clear");
            return send(id,"✅ Balance switches cleared. The configured start level is now used.",{reply_markup:autobetMenu});
        }
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
            
            else if(s.action === "setprofitplaninput"){
                const maxLevel = Number(text.trim().replace(/^\//, ""));
                if (!Number.isInteger(maxLevel) || maxLevel < 1 || maxLevel > 10) {
                    return send(id, "❌ Invalid max level. Enter a whole number from 1 to 10, for example: 5");
                }
                const balance = await getLiveBalance(id);
                if (!balance.success) return send(id, "❌ Could not fetch wallet balance: " + balance.message);
                const planBalance = Math.floor(Number(balance.balance));
                if (!Number.isFinite(planBalance) || planBalance <= 0 || planBalance < maxLevel) {
                    return send(id, "❌ Actual wallet balance ₹" + (Number.isFinite(planBalance) ? planBalance : 0) + " is too low for " + maxLevel + " levels.");
                }
                if (!autobetCfg[id].profitPlan) autobetCfg[id].profitPlan = { enabled: false, startLevel: 1, currentLevel: 1, balanceSwitches: [] };
                autobetCfg[id].profitPlan.enabled = true;
                autobetCfg[id].profitPlan.startLevel = 1;
                autobetCfg[id].profitPlan.currentLevel = 1;
                autobetCfg[id].profitPlan.planBalance = planBalance;
                autobetCfg[id].profitPlan.maxLevel = maxLevel;
                autobetCfg[id].maxLvl = maxLevel;
                syncProfitPlan(id, "enable", planBalance, maxLevel);
                delete userAction[id];
                return send(id, "✅ Profit plan ON\nActual balance: ₹" + planBalance.toFixed(2) + "\nMax level: L" + maxLevel, {reply_markup: autobetMenu});
            }
            else if(s.action === "setprofitswitch"){
                const step = Number(text.trim().replace(/^\//, ""));
                if (!Number.isInteger(step) || step <= 0) {
                    return send(id, "❌ Enter a whole positive amount, for example: 5 or 10");
                }
                if (!autobetCfg[id].profitPlan) autobetCfg[id].profitPlan = { enabled: false, startLevel: 1, currentLevel: 1, balanceSwitches: [] };
                autobetCfg[id].profitPlan.profitSwitchStep = step;
                autobetCfg[id].profitPlan.nextProfitSwitch = step;
                delete userAction[id];
                return send(id, "✅ Profit switch set to every ₹" + step + ".", {reply_markup: autobetMenu});
            }
            else if(s.action === "setprofitplanlevel"){
                const v = Number(text);
                if (!Number.isFinite(v) || v < 1 || v > 10) return send(id, "❌ Invalid plan level! Use 1-10.");
                if (!autobetCfg[id].profitPlan) autobetCfg[id].profitPlan = { enabled: false, startLevel: 1, currentLevel: 1 };
                autobetCfg[id].profitPlan.startLevel = v;
                autobetCfg[id].profitPlan.currentLevel = v;
                if (autobetCfg[id].profitPlan.enabled) await refreshWalletPlan(id, "level");
                delete userAction[id];
                return send(id, "✅ Profit plan started at L" + v + ".\nEach win updates the auto bet plan and syncs custom bets.", {reply_markup: autobetMenu});
            }
            else if(s.action === "setbalanceswitch"){
                const rules = text.split(/[,;]+/).map(item => {
                    const parts = item.trim().split(/[:=]/);
                    return { balance: Number(parts[0]), level: Number(parts[1]) };
                });
                if (!rules.length || rules.some(rule =>
                    !Number.isFinite(rule.balance) || rule.balance <= 0 ||
                    !Number.isInteger(rule.level) || rule.level < 1 || rule.level > 10
                )) {
                    return send(id,"❌ Invalid format. Use: 5000:2,10000:4");
                }
                const uniqueBalances = new Set(rules.map(rule => rule.balance));
                if (uniqueBalances.size !== rules.length) return send(id,"❌ Duplicate balance thresholds are not allowed.");
                if (!autobetCfg[id].profitPlan) autobetCfg[id].profitPlan = { enabled:false, startLevel:1, currentLevel:1, balanceSwitches:[] };
                autobetCfg[id].profitPlan.balanceSwitches = rules.sort((a, b) => a.balance - b.balance);
                delete userAction[id];
                if (autobetCfg[id].profitPlan.enabled) await refreshWalletPlan(id, "switch-set");
                return send(id,"✅ Balance switches saved:\n" + rules.map(rule => "₹" + rule.balance + " → L" + rule.level).join("\n"),{reply_markup:autobetMenu});
            }
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
