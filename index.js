const sqlite3 = require('sqlite3').verbose();
const TelegramBot = require('node-telegram-bot-api');
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios'); // Added for potential future use or missing async operations

// --- Configurações ---
const TELEGRAM_BOT_TOKEN = "7440228891:AAHY4XzbZUGQH0hQuvLSBE20JAtYt64GFfk";
const TELEGRAM_ADMIN_ID = 7132354672;
const TELEGRAM_GROUP_ID = -1003181014690;

const DISCORD_BOT_TOKEN = "MTQyOTM0MzQ0MzcwMzk1OTYzNA.GP6Ulx.ZfrvnVf6C5nzzMqTdU0E-UKuHQdCgtf9Ro1JRc";
const DISCORD_CLIENT_ID = "1429343443703959634";

const DATABASE_NAME = "bot.db";

let botDisabled = false;
let doubleBalance = false;
let awaitingLoginCategory = {};

const LOGIN_CATEGORIES = [
    "roblox", "bloxfruit", "youtube", "xvideos", "magalu", "mercadopago",
    "familiasacana", "netflix", "casasbahia", "disney", "keystream",
    "crunchyroll", "nubank", "gov", "tidal", "brasilparalelo", "copilotpro",
    "geminiai", "capcutpro", "grupos18", "hentaihq", "tufos", "clarotv",
    "premiere", "paramount", "globo", "spotify", "playplus", "hbomax",
    "amazon", "aliexpress", "casaevideo",
];

// --- Banco de Dados ---
const db = new sqlite3.Database(DATABASE_NAME);

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            balance REAL DEFAULT 0,
            points INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            number TEXT NOT NULL,
            month TEXT NOT NULL,
            year TEXT NOT NULL,
            cvv TEXT NOT NULL,
            bin TEXT NOT NULL,
            brand TEXT NOT NULL,
            type TEXT NOT NULL,
            price REAL DEFAULT 5.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(number, month, year, cvv)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            card_id INTEGER,
            price REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS bin_prices (
            bin TEXT PRIMARY KEY,
            price REAL DEFAULT 5.0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS banned_users (
            user_id INTEGER PRIMARY KEY
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS logins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            login_data TEXT NOT NULL,
            category TEXT NOT NULL,
            price REAL DEFAULT 5.0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS login_prices (
            category TEXT PRIMARY KEY,
            price REAL DEFAULT 5.0
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS login_sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            login_id INTEGER,
            price REAL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS gift_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            amount REAL NOT NULL,
            used_by INTEGER DEFAULT NULL,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            used_at DATETIME DEFAULT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS user_purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            card_number TEXT NOT NULL,
            card_month TEXT NOT NULL,
            card_year TEXT NOT NULL,
            card_cvv TEXT NOT NULL,
            bin TEXT NOT NULL,
            brand TEXT NOT NULL,
            price REAL NOT NULL,
            status TEXT DEFAULT 'UNKNOWN',
            verification_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
}

// Funções auxiliares do banco
function getUser(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM users WHERE id = ?", [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function registerUser(userId) {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR IGNORE INTO users (id) VALUES (?)", [userId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function updateUserBalance(userId, amount) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE users SET balance = balance + ? WHERE id = ?", [amount, userId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function isUserBanned(userId) {
    return new Promise((resolve, reject) => {
        db.get("SELECT user_id FROM banned_users WHERE user_id = ?", [userId], (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

function getCardBrand(number) {
    const num = String(number);
    if (/^4/.test(num)) return "visa";
    if (/^5[1-5]/.test(num)) return "mastercard";
    if (/^3[47]/.test(num)) return "amex";
    if (/^6(?:011|5)/.test(num)) return "discover";
    if (/^(?:2131|1800|35\d{3})/.test(num)) return "jcb";
    if (/^3(?:0[0-5]|[68])/.test(num)) return "diners";
    return "unknown";
}

function getCardType(number) {
    const num = String(number);
    if (num.startsWith("4111") || num.startsWith("5555")) return "platinum";
    if (num.startsWith("4000") || num.startsWith("5200")) return "gold";
    return "classic";
}

function generateGiftCodeStr(length = 8) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

async function addCard(number, month, year, cvv, bin, brand, type, price = 5.0) {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO cards (number, month, year, cvv, bin, brand, type, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [number, month, year, cvv, bin, brand, type, price], function(err) { // Use function to access 'this'
                if (err) {
                    if (err.IntegrityError) {
                        resolve(false); // Duplicate entry
                    } else {
                        reject(err);
                    }
                } else {
                    resolve(true);
                }
            });
    });
}

function getCardCount() {
    return new Promise((resolve, reject) => {
        db.get("SELECT COUNT(*) as count FROM cards", (err, row) => {
            if (err) reject(err);
            else resolve(row.count);
        });
    });
}

function getBinCounts() {
    return new Promise((resolve, reject) => {
        db.all("SELECT bin, brand, COUNT(*) as count FROM cards GROUP BY bin, brand LIMIT 10", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getBinPrice(bin) {
    return new Promise((resolve, reject) => {
        db.get("SELECT price FROM bin_prices WHERE bin = ?", [bin], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.price : 5.0);
        });
    });
}

function updateBinPrice(bin, price) {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR REPLACE INTO bin_prices (bin, price) VALUES (?, ?)", [bin, price], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getRandomCardByBin(bin) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM cards WHERE bin = ? ORDER BY RANDOM() LIMIT 1", [bin], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function deleteCard(cardId) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM cards WHERE id = ?", [cardId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function recordSale(userId, cardId, price) {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO sales (user_id, card_id, price) VALUES (?, ?, ?)", [userId, cardId, price], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function addLogin(loginData, category, price = 5.0) {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO logins (login_data, category, price) VALUES (?, ?, ?)", [loginData, category, price], (err) => {
            if (err) reject(err);
            else resolve(true);
        });
    });
}

function getLoginCategories() {
    return new Promise((resolve, reject) => {
        db.all("SELECT category, COUNT(*) as count FROM logins GROUP BY category ORDER BY category", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

function getLoginPrice(category) {
    return new Promise((resolve, reject) => {
        db.get("SELECT price FROM login_prices WHERE category = ?", [category], (err, row) => {
            if (err) reject(err);
            else resolve(row ? row.price : 5.0);
        });
    });
}

function updateLoginPrice(category, newPrice) {
    return new Promise((resolve, reject) => {
        db.run("INSERT OR REPLACE INTO login_prices (category, price) VALUES (?, ?)", [category, newPrice], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getRandomLoginByCategory(category) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM logins WHERE category = ? ORDER BY RANDOM() LIMIT 1", [category], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function deleteLogin(loginId) {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM logins WHERE id = ?", [loginId], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function recordLoginSale(userId, loginId, price) {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO login_sales (user_id, login_id, price) VALUES (?, ?, ?)", [userId, loginId, price], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function generateGiftCode(code, amount, createdBy) {
    return new Promise((resolve, reject) => {
        db.run("INSERT INTO gift_codes (code, amount, created_by) VALUES (?, ?, ?)", [code, amount, createdBy], (err) => {
            if (err) {
                if (err.IntegrityError) resolve(false); // Code already exists
                else reject(err);
            } else {
                resolve(true);
            }
        });
    });
}

function getGiftCode(code) {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM gift_codes WHERE code = ? AND used_by IS NULL", [code], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function useGiftCode(code, userId) {
    return new Promise((resolve, reject) => {
        db.run("UPDATE gift_codes SET used_by = ?, used_at = CURRENT_TIMESTAMP WHERE code = ?", [userId, code], (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getAllUsers() {
    return new Promise((resolve, reject) => {
        db.all("SELECT id FROM users", (err, rows) => {
            if (err) reject(err);
            else resolve(rows.map(row => row.id));
        });
    });
}

// Inicializar DB
initDB();

// --- Bot do Telegram ---
const telegramBot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

telegramBot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (botDisabled && userId !== TELEGRAM_ADMIN_ID) {
        return telegramBot.sendMessage(chatId, "🔧 Bot está em manutenção, volte mais tarde!");
    }

    const banned = await isUserBanned(userId);
    if (banned) {
        return telegramBot.sendMessage(chatId, "🚫 Você foi banido do bot!");
    }

    await registerUser(userId);
    const user = await getUser(userId);

    const welcomeText = `🎯 **Bem-vindo ao Bot de GGs!**\n\n💰 **Seu Saldo:** R$ ${user.balance.toFixed(2)}\n🆔 **Seu ID:** \`${userId}\`\n⭐ **Seus Pontos:** ${user.points}\n\n🛒 **Comandos Disponíveis:**\n/gg - Ver cartões disponíveis\n/perfil - Ver seu perfil\n\n💳 **Cartões de alta qualidade disponíveis!**`;

    const keyboard = {
        inline_keyboard: [
            [{ text: "💳 Ver Cartões", callback_data: "view_cards" }, { text: "🔑 Ver Logins", callback_data: "view_logins" }],
            [{ text: "🔍 Checker", callback_data: "view_checker" }],
            [{ text: "📊 Meu Perfil", callback_data: "profile" }],
            [{ text: "🛠️ Suporte", url: "https://t.me/savefullblack" }]
        ]
    };

    if (userId === TELEGRAM_ADMIN_ID) {
        keyboard.inline_keyboard.splice(2, 0, [{ text: "⚙️ Admin", callback_data: "admin_menu" }]);
    }

    telegramBot.sendMessage(chatId, welcomeText, { parse_mode: "Markdown", reply_markup: keyboard });
});

telegramBot.onText(/\/adc (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (userId !== TELEGRAM_ADMIN_ID) {
        return telegramBot.sendMessage(chatId, "❌ Apenas administradores podem adicionar cartões!");
    }

    const cardsData = match[1].split("\n");
    let added = 0;
    let duplicates = [];

    for (const cardDataStr of cardsData) {
        const parts = cardDataStr.trim().split("|");
        if (parts.length !== 4) continue;

        const [number, month, year, cvv] = parts;
        const bin = number.substring(0, 6);
        const brand = getCardBrand(number);
        const type = getCardType(number);

        const result = await addCard(number, month, year, cvv, bin, brand, type);
        if (result) {
            added++;
        } else {
            duplicates.push(cardDataStr);
        }
    }

    let response = `✅ **${added} cartões adicionados com sucesso!**`;
    if (duplicates.length > 0) {
        response += `\n\n❌ **${duplicates.length} cartões duplicados removidos!**`;
    }

    telegramBot.sendMessage(chatId, response, { parse_mode: "Markdown" });
});

telegramBot.onText(/\/gift (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (botDisabled && userId !== TELEGRAM_ADMIN_ID) {
        return telegramBot.sendMessage(chatId, "🔧 Bot está em manutenção, volte mais tarde!");
    }

    if (await isUserBanned(userId)) {
        return telegramBot.sendMessage(chatId, "🚫 Você foi banido do bot!");
    }

    if (userId !== TELEGRAM_ADMIN_ID) {
        return telegramBot.sendMessage(chatId, "❌ Apenas administradores podem gerar gift codes! Use /resgatar <código> para resgatar um gift.");
    }

    const amountStr = match[1].replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(amountStr)) {
        return telegramBot.sendMessage(chatId, "Uso: /gift <valor>");
    }

    const amount = parseFloat(amountStr);
    if (amount <= 0) {
        return telegramBot.sendMessage(chatId, "❌ Valor do gift deve ser maior que zero!");
    }

    const code = generateGiftCodeStr();
    const success = await generateGiftCode(code, amount, userId);

    if (success) {
        const giftText = `🎁 **GIFT CODE GERADO!**\n\n💰 **Valor:** R$ ${amount.toFixed(2)}\n🔑 **Código:** \`${code}\`\n\n📋 **Como usar:** Os usuários devem usar /resgatar ${code}\n⏰ **Válido até:** Sem expiração`;
        await telegramBot.sendMessage(chatId, giftText, { parse_mode: "Markdown" });
    } else {
        await telegramBot.sendMessage(chatId, "❌ Erro ao gerar gift code! Tente novamente.");
    }
});

telegramBot.onText(/\/resgatar (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (botDisabled && userId !== TELEGRAM_ADMIN_ID) {
        return telegramBot.sendMessage(chatId, "🔧 Bot está em manutenção, volte mais tarde!");
    }

    if (await isUserBanned(userId)) {
        return telegramBot.sendMessage(chatId, "🚫 Você foi banido do bot!");
    }

    const code = match[1].toUpperCase();
    if (code.length !== 8) {
        return telegramBot.sendMessage(chatId, "Uso: /resgatar <código> (código de 8 caracteres)");
    }

    const giftData = await getGiftCode(code);

    if (!giftData) {
        return telegramBot.sendMessage(chatId, "❌ Código de gift inválido ou já utilizado!");
    }

    await useGiftCode(code, userId);
    await updateUserBalance(userId, giftData.amount);
    const user = await getUser(userId);

    await telegramBot.sendMessage(chatId, `✅ Gift code \`${code}\` resgatado com sucesso! Seu novo saldo é R$ ${user.balance.toFixed(2)}.`, { parse_mode: "Markdown" });

    // Notification to group
    const userInfo = msg.from;
    const groupNotification = `🎁 **GIFT CODE RESGATADO!**\n\n👤 **Cliente:** ${userInfo.first_name} (@${userInfo.username || "sem_username"})\n🆔 **ID:** \`${userId}\`\n🔑 **Código:** \`${code}\`\n💰 **Valor:** R$ ${giftData.amount.toFixed(2)}`;
    try {
        await telegramBot.sendMessage(TELEGRAM_GROUP_ID, groupNotification, { parse_mode: "Markdown" });
    } catch (e) {
        console.error("Erro ao enviar notificação para o grupo:", e.message);
    }
});


telegramBot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;

    if (await isUserBanned(userId)) {
        return telegramBot.answerCallbackQuery(query.id, { text: "🚫 Você foi banido do bot!", show_alert: true });
    }

    if (data === "start_menu") {
        const user = await getUser(userId);
        const welcomeText = `🎯 **Bem-vindo ao Bot de GGs!**\n\n💰 **Seu Saldo:** R$ ${user.balance.toFixed(2)}\n🆔 **Seu ID:** \`${userId}\`\n⭐ **Seus Pontos:** ${user.points}\n\n🛒 **Comandos Disponíveis:**\n/gg - Ver cartões disponíveis\n/perfil - Ver seu perfil\n\n💳 **Cartões de alta qualidade disponíveis!**`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 Ver Cartões", callback_data: "view_cards" }, { text: "🔑 Ver Logins", callback_data: "view_logins" }],
                [{ text: "🔍 Checker", callback_data: "view_checker" }],
                [{ text: "📊 Meu Perfil", callback_data: "profile" }],
                [{ text: "🛠️ Suporte", url: "https://t.me/savefullblack" }]
            ]
        };
        if (userId === TELEGRAM_ADMIN_ID) {
            keyboard.inline_keyboard.splice(2, 0, [{ text: "⚙️ Admin", callback_data: "admin_menu" }]);
        }
        return telegramBot.editMessageText(welcomeText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    }

    if (data === "view_cards") {
        const bins = await getBinCounts();

        if (bins.length === 0) {
            return telegramBot.editMessageText("❌ Nenhum cartão disponível no momento.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }

        const keyboard = { inline_keyboard: [] };

        for (const binInfo of bins) {
            const price = await getBinPrice(binInfo.bin);
            keyboard.inline_keyboard.push([{
                text: `${binInfo.brand.toUpperCase()} ${binInfo.bin} (${binInfo.count}) - R$ ${price.toFixed(2)}`,
                callback_data: `buy_${binInfo.bin}`
            }]);
        }

        keyboard.inline_keyboard.push([{ text: "🔙 Voltar", callback_data: "start_menu" }]);

        telegramBot.editMessageText("💳 **CARTÕES DISPONÍVEIS**\n\nSelecione uma BIN para comprar:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data.startsWith("buy_")) {
        const bin = data.replace("buy_", "");
        const user = await getUser(userId);
        const price = await getBinPrice(bin);

        if (user.balance < price) {
            return telegramBot.answerCallbackQuery(query.id, {
                text: `❌ Saldo insuficiente! Você precisa de R$ ${price.toFixed(2)}`,
                show_alert: true
            });
        }

        const card = await getRandomCardByBin(bin);

        if (!card) {
            return telegramBot.answerCallbackQuery(query.id, {
                text: "❌ Nenhum cartão disponível para esta BIN",
                show_alert: true
            });
        }

        await updateUserBalance(userId, -price);
        await deleteCard(card.id);
        await recordSale(userId, card.id, price);

        const updatedUser = await getUser(userId);

        const responseText = `✅ **COMPRA REALIZADA COM SUCESSO!**\n\n💳 **Cartão:** \`${card.number}|${card.month}|${card.year}|${card.cvv}\`\n🏷️ **BIN:** ${card.bin}\n🌟 **Bandeira:** ${card.brand.toUpperCase()}\n💰 **Preço:** R$ ${price.toFixed(2)}\n💳 **Saldo Restante:** R$ ${updatedUser.balance.toFixed(2)}\n\n⚠️ **ATENÇÃO:** Use o cartão imediatamente!`;

        telegramBot.answerCallbackQuery(query.id);
        telegramBot.editMessageText(responseText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });

        // Notification to group
        const userInfo = query.message.chat; // Assuming query.message.chat contains user info
        const groupNotification = `💳 **CARTÃO COMPRADO!**\n\n👤 **Cliente:** ${userInfo.first_name} (@${userInfo.username || "sem_username"})\n🆔 **ID:** \`${userId}\`\n🛒 **Item:** Cartão BIN ${bin}\n💰 **Valor:** R$ ${price.toFixed(2)}`;
        try {
            await telegramBot.sendMessage(TELEGRAM_GROUP_ID, groupNotification, { parse_mode: "Markdown" });
        } catch (e) {
            console.error("Erro ao enviar notificação para o grupo:", e.message);
        }

    } else if (data === "profile") {
        const user = await getUser(userId);
        const profileText = `📊 **SEU PERFIL**\n\n🆔 **Seu ID:** \`${userId}\`\n💰 **Saldo:** R$ ${user.balance.toFixed(2)}\n⭐ **Pontos:** ${user.points}`;

        const keyboard = {
            inline_keyboard: [[{ text: "🔙 Voltar", callback_data: "start_menu" }]]
        };

        telegramBot.editMessageText(profileText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data === "view_logins") {
        const loginCategoriesData = await getLoginCategories();

        if (loginCategoriesData.length === 0) {
            return telegramBot.editMessageText("❌ Nenhuma categoria de login disponível no momento.", {
                chat_id: chatId,
                message_id: query.message.message_id
            });
        }

        const keyboard = { inline_keyboard: [] };
        for (const catInfo of loginCategoriesData) {
            const price = await getLoginPrice(catInfo.category);
            keyboard.inline_keyboard.push([{
                text: `${catInfo.category.toUpperCase()} (${catInfo.count}) - R$ ${price.toFixed(2)}`,
                callback_data: `buy_login_${catInfo.category}`
            }]);
        }
        keyboard.inline_keyboard.push([{ text: "🔙 Voltar", callback_data: "start_menu" }]);

        telegramBot.editMessageText("🔑 **LOGINS DISPONÍVEIS**\n\nSelecione uma categoria para comprar:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data.startsWith("buy_login_")) {
        const category = data.replace("buy_login_", "");
        const user = await getUser(userId);
        const loginPrice = await getLoginPrice(category);

        if (user.balance < loginPrice) {
            return telegramBot.answerCallbackQuery(query.id, { text: `❌ Saldo insuficiente! Você precisa de R$ ${loginPrice.toFixed(2)} para comprar um login ${category.toUpperCase()}.`, show_alert: true });
        }

        const loginData = await getRandomLoginByCategory(category);

        if (!loginData) {
            return telegramBot.answerCallbackQuery(query.id, { text: `❌ Nenhum login ${category.toUpperCase()} disponível no momento.`, show_alert: true });
        }

        await updateUserBalance(userId, -loginPrice);
        await deleteLogin(loginData.id);
        await recordLoginSale(userId, loginData.id, loginPrice);
        const updatedUser = await getUser(userId);

        const responseText = `✅ **COMPRA REALIZADA COM SUCESSO!**\n\n🔑 **Login ${category.toUpperCase()}:** \`${loginData.login_data}\`\n💰 **Preço:** R$ ${loginPrice.toFixed(2)}\n💳 **Saldo Restante:** R$ ${updatedUser.balance.toFixed(2)}\n\n⚠️ **ATENÇÃO:** Use o login imediatamente!`;

        telegramBot.answerCallbackQuery(query.id);
        telegramBot.editMessageText(responseText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });

        // Notification to group
        const userInfo = query.message.chat;
        const groupNotification = `🔑 **LOGIN COMPRADO!**\n\n👤 **Cliente:** ${userInfo.first_name} (@${userInfo.username || "sem_username"})\n🆔 **ID:** \`${userId}\`\n🛒 **Item:** Login ${category.toUpperCase()}\n💰 **Valor:** R$ ${loginPrice.toFixed(2)}`;
        try {
            await telegramBot.sendMessage(TELEGRAM_GROUP_ID, groupNotification, { parse_mode: "Markdown" });
        } catch (e) {
            console.error("Erro ao enviar notificação para o grupo:", e.message);
        }
    } else if (data === "admin_menu") {
        if (userId !== TELEGRAM_ADMIN_ID) {
            return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem acessar este menu!", show_alert: true });
        }

        const statusBot = botDisabled ? "Desativado" : "Ativado";
        const statusDoubleBalance = doubleBalance ? "Ativado" : "Desativado";

        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 Gerenciar BINs", callback_data: "manage_bins" }],
                [{ text: "👥 Gerenciar Usuários", callback_data: "manage_users" }],
                [{ text: "🔑 Gerenciar Logins", callback_data: "manage_logins" }],
                [{ text: "✉️ Broadcast", callback_data: "broadcast_message" }],
                [{ text: `⚙️ Bot: ${statusBot}`, callback_data: "toggle_bot_status" }],
                [{ text: `💰 Saldo em Dobro: ${statusDoubleBalance}`, callback_data: "toggle_double_balance" }],
                [{ text: "🔙 Voltar", callback_data: "start_menu" }]
            ]
        };

        telegramBot.editMessageText("⚙️ **PAINEL DE ADMINISTRAÇÃO**\n\nSelecione uma opção:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data === "manage_bins") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem gerenciar BINs!", show_alert: true });

        const binsData = await getBinCounts();
        if (binsData.length === 0) return telegramBot.editMessageText("❌ Nenhuma BIN encontrada.", { chat_id: chatId, message_id: query.message.message_id });

        const keyboard = { inline_keyboard: [] };
        for (const binInfo of binsData) {
            const price = await getBinPrice(binInfo.bin);
            keyboard.inline_keyboard.push([{ text: `${binInfo.brand.toUpperCase()} ${binInfo.bin} (${binInfo.count}) - R$ ${price.toFixed(2)}`, callback_data: `edit_bin_price_${binInfo.bin}` }]);
        }
        keyboard.inline_keyboard.push([{ text: "🔙 Voltar", callback_data: "admin_menu" }]);

        telegramBot.editMessageText("💳 **GERENCIAR BINs**\n\nSelecione uma BIN para editar o preço:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data.startsWith("edit_bin_price_")) {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem editar preços de BINs!", show_alert: true });

        const binNum = data.replace("edit_bin_price_", "");
        awaitingLoginCategory[userId] = { type: "bin_price", value: binNum }; // Store context for price editing
        telegramBot.editMessageText(`💰 **EDITAR PREÇO DA BIN ${binNum}**\n\nEnvie o novo preço para esta BIN (ex: 7.50):`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    } else if (data === "manage_users") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem gerenciar usuários!", show_alert: true });

        const keyboard = {
            inline_keyboard: [
                [{ text: "➕ Adicionar Saldo", callback_data: "add_balance_user" }],
                [{ text: "➖ Remover Saldo", callback_data: "remove_balance_user" }],
                [{ text: "🚫 Banir Usuário", callback_data: "ban_user" }],
                [{ text: "✅ Desbanir Usuário", callback_data: "unban_user" }],
                [{ text: "🔙 Voltar", callback_data: "admin_menu" }]
            ]
        };
        telegramBot.editMessageText("👥 **GERENCIAR USUÁRIOS**\n\nSelecione uma opção:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data === "add_balance_user") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem adicionar saldo!", show_alert: true });
        awaitingLoginCategory[userId] = { type: "add_balance" };
        telegramBot.editMessageText("➕ **ADICIONAR SALDO**\n\nEnvie o ID do usuário para adicionar saldo:", { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
    } else if (data === "remove_balance_user") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem remover saldo!", show_alert: true });
        awaitingLoginCategory[userId] = { type: "remove_balance" };
        telegramBot.editMessageText("➖ **REMOVER SALDO**\n\nEnvie o ID do usuário para remover saldo:", { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
    } else if (data === "ban_user") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem banir usuários!", show_alert: true });
        awaitingLoginCategory[userId] = { type: "ban_user" };
        telegramBot.editMessageText("🚫 **BANIR USUÁRIO**\n\nEnvie o ID do usuário para banir:", { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
    } else if (data === "unban_user") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem desbanir usuários!", show_alert: true });
        awaitingLoginCategory[userId] = { type: "unban_user" };
        telegramBot.editMessageText("✅ **DESBANIR USUÁRIO**\n\nEnvie o ID do usuário para desbanir:", { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
    } else if (data === "broadcast_message") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem enviar broadcast!", show_alert: true });
        awaitingLoginCategory[userId] = { type: "broadcast_message" };
        telegramBot.editMessageText("✉️ **BROADCAST**\n\nEnvie a mensagem que deseja enviar para todos os usuários:", { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
    } else if (data === "manage_logins") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem gerenciar logins!", show_alert: true });

        const keyboard = {
            inline_keyboard: [
                [{ text: "➕ Adicionar Login", callback_data: "add_login_admin" }],
                [{ text: "💰 Gerenciar Preços de Login", callback_data: "manage_login_prices" }],
                [{ text: "🔙 Voltar", callback_data: "admin_menu" }]
            ]
        };
        telegramBot.editMessageText("🔑 **GERENCIAR LOGINS**\n\nSelecione uma opção:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data === "add_login_admin") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem adicionar logins!", show_alert: true });

        const keyboard = { inline_keyboard: [] };
        LOGIN_CATEGORIES.forEach(cat => {
            keyboard.inline_keyboard.push([{ text: cat.toUpperCase(), callback_data: `select_login_category_${cat}` }]);
        });
        keyboard.inline_keyboard.push([{ text: "🔙 Voltar", callback_data: "manage_logins" }]);

        telegramBot.editMessageText("➕ **ADICIONAR LOGIN**\n\nSelecione a categoria do login:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data.startsWith("select_login_category_")) {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem adicionar logins!", show_alert: true });

        const category = data.replace("select_login_category_", "");
        awaitingLoginCategory[userId] = { type: "add_login", category: category };
        telegramBot.editMessageText(`➕ **ADICIONAR LOGIN - ${category.toUpperCase()}**\n\nEnvie os dados do login (ex: \`usuario:senha\` ou \`email:senha\`):`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    } else if (data === "manage_login_prices") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem gerenciar preços de logins!", show_alert: true });

        const loginCategoriesData = await getLoginCategories();
        if (loginCategoriesData.length === 0) return telegramBot.editMessageText("❌ Nenhuma categoria de login encontrada.", { chat_id: chatId, message_id: query.message.message_id });

        const keyboard = { inline_keyboard: [] };
        for (const catInfo of loginCategoriesData) {
            const price = await getLoginPrice(catInfo.category);
            keyboard.inline_keyboard.push([{ text: `${catInfo.category.toUpperCase()} (${catInfo.count}) - R$ ${price.toFixed(2)}`, callback_data: `edit_login_price_${catInfo.category}` }]);
        }
        keyboard.inline_keyboard.push([{ text: "🔙 Voltar", callback_data: "manage_logins" }]);

        telegramBot.editMessageText("💰 **GERENCIAR PREÇOS DE LOGIN**\n\nSelecione uma categoria para editar o preço:", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data.startsWith("edit_login_price_")) {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem editar preços de logins!", show_alert: true });

        const category = data.replace("edit_login_price_", "");
        awaitingLoginCategory[userId] = { type: "login_price", value: category };
        telegramBot.editMessageText(`💰 **EDITAR PREÇO DA CATEGORIA ${category.toUpperCase()}**\n\nEnvie o novo preço para esta categoria (ex: 15.00):`, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    } else if (data === "view_checker") {
        const user = await getUser(userId);
        const chkText = `🔍 **VERIFICADOR DE CARTÕES**\n\n💰 **Seu Saldo:** R$ ${user.balance.toFixed(2)}\n\n💳 **Preços por verificação:**\n• PayPal: R$ 1,00 (DIE) / R$ 2,50 (LIVE)\n• 0Auth: R$ 1,00 (DIE) / R$ 2,50 (LIVE)\n\n📋 **Como usar:**\nEscolha o gate e envie os cartões no formato:\n\`4921199582016802|12|2025|566\`\n\nPode enviar vários cartões por vez (máx. 10)!`;

        const keyboard = {
            inline_keyboard: [
                [{ text: "💳 PayPal Checker", callback_data: "chk_paypal" }, { text: "🔐 0Auth Checker", callback_data: "chk_0auth" }],
                [{ text: "🔙 Voltar", callback_data: "start_menu" }]
            ]
        };
        telegramBot.editMessageText(chkText, {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown",
            reply_markup: keyboard
        });
    } else if (data === "chk_paypal") {
        awaitingLoginCategory[userId] = { type: "checker", value: "paypal" };
        telegramBot.editMessageText("💳 **PAYPAL CHECKER**\n\nEnvie os cartões no formato `numero|mes|ano|cvv` (um por linha).", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    } else if (data === "chk_0auth") {
        awaitingLoginCategory[userId] = { type: "checker", value: "0auth" };
        telegramBot.editMessageText("🔐 **0AUTH CHECKER**\n\nEnvie os cartões no formato `numero|mes|ano|cvv` (um por linha).", {
            chat_id: chatId,
            message_id: query.message.message_id,
            parse_mode: "Markdown"
        });
    } else if (data === "toggle_bot_status") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem alterar o status do bot!", show_alert: true });
        botDisabled = !botDisabled;
        const status = botDisabled ? "Desativado" : "Ativado";
        await telegramBot.editMessageText(`✅ Status do bot alterado para: **${status}**`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for message to be seen
        await admin_menu(query, { bot: telegramBot }); // Re-render admin menu
    } else if (data === "toggle_double_balance") {
        if (userId !== TELEGRAM_ADMIN_ID) return telegramBot.answerCallbackQuery(query.id, { text: "❌ Apenas administradores podem alterar o saldo em dobro!", show_alert: true });
        doubleBalance = !doubleBalance;
        const status = doubleBalance ? "Ativado" : "Desativado";
        await telegramBot.editMessageText(`✅ Saldo em dobro alterado para: **${status}**`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: "Markdown" });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for message to be seen
        await admin_menu(query, { bot: telegramBot }); // Re-render admin menu
    }


    telegramBot.answerCallbackQuery(query.id);
});


async function admin_menu(query, context) {
    const userId = query.from.id;
    const telegramBot = context.bot; // Use the bot instance passed from the callback

    const statusBot = botDisabled ? "Desativado" : "Ativado";
    const statusDoubleBalance = doubleBalance ? "Ativado" : "Desativado";

    const keyboard = {
        inline_keyboard: [
            [{ text: "💳 Gerenciar BINs", callback_data: "manage_bins" }],
            [{ text: "👥 Gerenciar Usuários", callback_data: "manage_users" }],
            [{ text: "🔑 Gerenciar Logins", callback_data: "manage_logins" }],
            [{ text: "✉️ Broadcast", callback_data: "broadcast_message" }],
            [{ text: `⚙️ Bot: ${statusBot}`, callback_data: "toggle_bot_status" }],
            [{ text: `💰 Saldo em Dobro: ${statusDoubleBalance}`, callback_data: "toggle_double_balance" }],
            [{ text: "🔙 Voltar", callback_data: "start_menu" }]
        ]
    };

    await telegramBot.editMessageText("⚙️ **PAINEL DE ADMINISTRAÇÃO**\n\nSelecione uma opção:", {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        parse_mode: "Markdown",
        reply_markup: keyboard
    });
}

async function process_checker_request(msg, context) {
    const userId = msg.from.id;
    const checkerType = awaitingLoginCategory[userId]?.type === "checker" ? awaitingLoginCategory[userId].value : null;

    if (!checkerType) return; // Not in checker context

    const cardsText = msg.text;
    const cards = cardsText.split("\n").filter(line => line.includes("|"));

    if (!cards || cards.length === 0) {
        return telegramBot.sendMessage(msg.chat.id, "❌ Formato inválido! Use: `numero|mes|ano|cvv` (um por linha).");
    }

    if (cards.length > 10) {
        return telegramBot.sendMessage(msg.chat.id, "❌ Máximo 10 cartões por vez!");
    }

    const user = await getUser(userId);
    let initialCost = 0;
    if (checkerType === "paypal") {
        initialCost = cards.length * 1.00;
    } else if (checkerType === "0auth") {
        initialCost = cards.length * 1.00;
    }

    if (user.balance < initialCost) {
        return telegramBot.sendMessage(msg.chat.id,
            `❌ Saldo insuficiente! Você precisa de pelo menos R$ ${initialCost.toFixed(2)} mas tem apenas R$ ${user.balance.toFixed(2)}`
        );
    }

    const statusMsg = await telegramBot.sendMessage(msg.chat.id,
        `🔍 **VERIFICANDO ${cards.length} CARTÃO(ES)...**\n\n⏳ Aguarde, isso pode levar alguns segundos...`,
        { parse_mode: "Markdown" }
    );

    let results = [];
    let totalCost = 0;
    let liveCount = 0;
    let dieCount = 0;

    for (let i = 0; i < cards.length; i++) {
        await telegramBot.editMessageText(
            `🔍 **VERIFICANDO ${cards.length} CARTÃO(ES)...**\n\n⏳ Processando cartão ${i + 1}/${cards.length}...`,
            {
                chat_id: statusMsg.chat.id,
                message_id: statusMsg.message_id,
                parse_mode: "Markdown"
            }
        );

        // Simulate check result
        const status = Math.random() > 0.5 ? "LIVE" : "DIE";
        const message = status === "LIVE" ? "AUTHORIZED" : "GENERIC_DECLINE";
        const cost = status === "LIVE" ? (checkerType === "paypal" || checkerType === "0auth" ? 2.50 : 1.00) : 1.00;

        if (status === "LIVE") liveCount++; else dieCount++;
        totalCost += cost;

        const parts = cards[i].split("|");
        const bin = parts[0].substring(0, 6);
        const brand = getCardBrand(parts[0]);

        results.push({
            card: cards[i],
            status: status,
            message: message,
            cost: cost,
            bin: bin,
            brand: brand
        });
        await new Promise(resolve => setTimeout(resolve, 1000)); // Simulate processing time
    }

    // Re-check balance after all cards are processed
    const finalUser = await getUser(userId);
    if (finalUser.balance < totalCost) {
        return telegramBot.editMessageText(
            `❌ **SALDO INSUFICIENTE!**\n\nCusto total: R$ ${totalCost.toFixed(2)}\nSeu saldo: R$ ${finalUser.balance.toFixed(2)}`,
            { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id, parse_mode: "Markdown" }
        );
    }

    await updateUserBalance(userId, -totalCost);
    const updatedUser = await getUser(userId);

    let resultText = `🔍 **RESULTADO DO ${checkerType.toUpperCase()} CHECKER**\n\n`;
    for (const res of results) {
        const statusEmoji = res.status === "LIVE" ? "✅" : "❌";
        resultText += `${statusEmoji} \`${res.card}\`\n`;
        resultText += `   └ **${res.status}** - ${res.message} - R$ ${res.cost.toFixed(2)}\n\n`;
    }

    resultText += `📊 **RESUMO:**\n`;
    resultText += `✅ **LIVE:** ${liveCount}\n`;
    resultText += `❌ **DIE:** ${dieCount}\n`;
    resultText += `💰 **Custo Total:** R$ ${totalCost.toFixed(2)}\n`;
    resultText += `💳 **Saldo Restante:** R$ ${updatedUser.balance.toFixed(2)}`;

    if (resultText.length > 4096) {
        // Split message if too long
        const chunks = [];
        let currentChunk = "";
        const lines = resultText.split('\n');
        for (const line of lines) {
            if (currentChunk.length + line.length + 1 > 4000) {
                chunks.push(currentChunk);
                currentChunk = line + '\n';
            } else {
                currentChunk += line + '\n';
            }
        }
        if (currentChunk) chunks.push(currentChunk);

        await telegramBot.editMessageText(chunks[0], { chat_id: statusMsg.chat.id, message_id: statusMsg.message_id, parse_mode: "Markdown" });
        for (let i = 1; i < chunks.length; i++) {
            await telegramBot.sendMessage(statusMsg.chat.id, chunks[i], { parse_mode: "Markdown" });
        }
    } else {
        await telegramBot.editMessageText(resultText, {
            chat_id: statusMsg.chat.id,
            message_id: statusMsg.message_id,
            parse_mode: "Markdown"
        });
    }

    // Notification to group
    const userInfo = msg.from;
    const groupNotification = `🔍 **CHECKER USADO!**\n\n👤 **Cliente:** ${userInfo.first_name} (@${userInfo.username || "sem_username"})\n🆔 **ID:** \`${userId}\`\n🔧 **Checker:** ${checkerType.toUpperCase()}\n📊 **Resultados:** ${liveCount} LIVE / ${dieCount} DIE\n💰 **Valor:** R$ ${totalCost.toFixed(2)}`;
    try {
        await telegramBot.sendMessage(TELEGRAM_GROUP_ID, groupNotification, { parse_mode: "Markdown" });
    } catch (e) {
        console.error("Erro ao enviar notificação para o grupo:", e.message);
    }

    delete awaitingLoginCategory[userId]; // Clear checker context
}


telegramBot.on('message', async (msg) => {
    const userId = msg.from.id;
    const chatId = msg.chat.id;

    // Handle text messages that are not commands or callback queries
    if (msg.text && !msg.text.startsWith('/') && !msg.text.startsWith('.')) { // Basic check to avoid processing commands again
        if (awaitingLoginCategory[userId]) {
            const context = awaitingLoginCategory[userId];

            if (context.type === "bin_price") {
                const binNum = context.value;
                const newPriceStr = msg.text.replace(",", ".");
                try {
                    const newPrice = parseFloat(newPriceStr);
                    if (newPrice <= 0) {
                        await telegramBot.sendMessage(chatId, "❌ O preço deve ser um valor positivo.");
                        return;
                    }
                    await updateBinPrice(binNum, newPrice);
                    await telegramBot.sendMessage(chatId, `✅ Preço da BIN ${binNum} atualizado para R$ ${newPrice.toFixed(2)}!`, { parse_mode: "Markdown" });
                } catch (e) {
                    await telegramBot.sendMessage(chatId, "❌ Formato de preço inválido. Use um número (ex: 7.50).");
                } finally {
                    delete awaitingLoginCategory[userId];
                }
            } else if (context.type === "login_price") {
                const category = context.value;
                const newPriceStr = msg.text.replace(",", ".");
                try {
                    const newPrice = parseFloat(newPriceStr);
                    if (newPrice <= 0) {
                        await telegramBot.sendMessage(chatId, "❌ O preço deve ser um valor positivo.");
                        return;
                    }
                    await updateLoginPrice(category, newPrice);
                    await telegramBot.sendMessage(chatId, `✅ Preço da categoria ${category.toUpperCase()} atualizado para R$ ${newPrice.toFixed(2)}!`, { parse_mode: "Markdown" });
                } catch (e) {
                    await telegramBot.sendMessage(chatId, "❌ Formato de preço inválido. Use um número (ex: 15.00).");
                } finally {
                    delete awaitingLoginCategory[userId];
                }
            } else if (context.type === "add_balance" || context.type === "remove_balance") {
                const targetUserIdStr = msg.text.trim();
                try {
                    const targetUserId = parseInt(targetUserIdStr);
                    if (isNaN(targetUserId)) throw new Error("Invalid user ID");

                    awaitingLoginCategory[userId].targetUserId = targetUserId; // Store for next step
                    awaitingLoginCategory[userId].action = context.type;
                    await telegramBot.sendMessage(chatId, `Envie o valor para ${context.type === "add_balance" ? "adicionar" : "remover"} (ex: 10.00):`, { parse_mode: "Markdown" });

                } catch (e) {
                    await telegramBot.sendMessage(chatId, "❌ ID de usuário inválido. Por favor, envie um número.");
                }
            } else if (context.type === "ban_user" || context.type === "unban_user") {
                const targetUserIdStr = msg.text.trim();
                try {
                    const targetUserId = parseInt(targetUserIdStr);
                    if (isNaN(targetUserId)) throw new Error("Invalid user ID");

                    const bannedUsersDb = new sqlite3.Database(DATABASE_NAME);
                    if (context.type === "ban_user") {
                        bannedUsersDb.run("INSERT OR IGNORE INTO banned_users (user_id) VALUES (?)", [targetUserId], function(err) {
                            if (err) {
                                console.error("DB Error banning user:", err.message);
                                telegramBot.sendMessage(chatId, "❌ Erro ao tentar banir usuário.");
                            } else if (this.changes > 0) {
                                telegramBot.sendMessage(chatId, `🚫 Usuário \`${targetUserId}\` banido com sucesso!`, { parse_mode: "Markdown" });
                            } else {
                                telegramBot.sendMessage(chatId, `❌ Usuário \`${targetUserId}\` já está banido.`, { parse_mode: "Markdown" });
                            }
                            delete awaitingLoginCategory[userId];
                        });
                    } else { // unban_user
                        bannedUsersDb.run("DELETE FROM banned_users WHERE user_id = ?", [targetUserId], function(err) {
                            if (err) {
                                console.error("DB Error unbanning user:", err.message);
                                telegramBot.sendMessage(chatId, "❌ Erro ao tentar desbanir usuário.");
                            } else if (this.changes > 0) {
                                telegramBot.sendMessage(chatId, `✅ Usuário \`${targetUserId}\` desbanido com sucesso!`, { parse_mode: "Markdown" });
                            } else {
                                telegramBot.sendMessage(chatId, `❌ Usuário \`${targetUserId}\` não encontrado na lista de banidos.`, { parse_mode: "Markdown" });
                            }
                            delete awaitingLoginCategory[userId];
                        });
                    }
                    bannedUsersDb.close();
                } catch (e) {
                    await telegramBot.sendMessage(chatId, "❌ ID de usuário inválido. Por favor, envie um número.");
                }
            } else if (context.type === "broadcast_message") {
                const messageToSend = msg.text;
                const allUsers = await getAllUsers();
                let sentCount = 0;
                let failedCount = 0;
                for (const user of allUsers) {
                    try {
                        await telegramBot.sendMessage(user, messageToSend, { parse_mode: "Markdown" });
                        sentCount++;
                    } catch (e) {
                        console.error(`Falha ao enviar broadcast para ${user}: ${e.message}`);
                        failedCount++;
                    }
                }
                await telegramBot.sendMessage(chatId, `✅ Broadcast enviado! ${sentCount} usuários receberam, ${failedCount} falharam.`, { parse_mode: "Markdown" });
                delete awaitingLoginCategory[userId];
            } else if (context.type === "add_login") {
                 const loginDataStr = msg.text.trim();
                if (!loginDataStr) {
                    await telegramBot.sendMessage(chatId, "❌ Dados de login inválidos.");
                    return;
                }
                try {
                    await addLogin(loginDataStr, context.category);
                    await telegramBot.sendMessage(chatId, `✅ Login adicionado com sucesso na categoria **${context.category.toUpperCase()}**!`, { parse_mode: "Markdown" });
                } catch (e) {
                    console.error("Error adding login:", e);
                    await telegramBot.sendMessage(chatId, "❌ Erro ao adicionar login. Tente novamente.");
                } finally {
                    delete awaitingLoginCategory[userId];
                }
            } else if (awaitingLoginCategory[userId]?.targetUserId && awaitingLoginCategory[userId]?.action) { // Handle amount for balance change
                const context = awaitingLoginCategory[userId];
                const amountStr = msg.text.replace(",", ".");
                try {
                    let amount = parseFloat(amountStr);
                    if (isNaN(amount) || amount <= 0) {
                        await telegramBot.sendMessage(chatId, "❌ O valor deve ser positivo.");
                        return;
                    }
                    if (context.action === "remove_balance") {
                        amount = -amount;
                    }
                    await updateUserBalance(context.targetUserId, amount);
                    const user = await getUser(context.targetUserId);
                    await telegramBot.sendMessage(chatId, `✅ Saldo do usuário \`${context.targetUserId}\` ${context.action === "add_balance" ? 'adicionado' : 'removido'} com sucesso! Novo saldo: R$ ${user.balance.toFixed(2)}`, { parse_mode: "Markdown" });
                } catch (e) {
                    console.error("Error updating balance:", e);
                    await telegramBot.sendMessage(chatId, "❌ Valor inválido. Use um número (ex: 10.00).");
                } finally {
                    delete awaitingLoginCategory[userId];
                }
            } else if (awaitingLoginCategory[userId]?.type === "checker") {
                // If it's a checker request that came through message instead of callback
                await process_checker_request(msg, {});
            }
        }
    }
});


// --- Bot do Discord ---
const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// Store pending PIX payments
const pendingPixPayments = new Map();

// Function to generate fake PIX QR Code and copy-paste code
function generatePixPayment(amount) {
    const pixCode = `00020126${String(Math.random()).substring(2, 50)}${amount.toFixed(2).replace('.', '')}5802BR5925STORAGEBLACK6009SAO PAULO`;
    const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(pixCode)}`;
    return { pixCode, qrCodeUrl };
}

// Auto-announce message every 50 minutes
setInterval(async () => {
    const guilds = discordClient.guilds.cache;
    for (const [guildId, guild] of guilds) {
        try {
            const channels = guild.channels.cache.filter(ch => ch.type === 0); // Text channels
            const firstChannel = channels.first();
            if (firstChannel) {
                await firstChannel.send("**SEJA BEMVINDO A STORAGEBLACK - A MELHOR STORAGE DE GGs DO MUNDO**\n\n🔗 ENTRE NO NOSSO CANAL DO TELEGRAM: https://t.me/centralsavefullblack");
            }
        } catch (e) {
            console.error(`Erro ao enviar mensagem automática no servidor ${guild.name}:`, e.message);
        }
    }
}, 50 * 60 * 1000); // 50 minutes

// Function to check if user is admin
function isAdmin(member) {
    return member.permissions.has('Administrator');
}

// Function to check time restriction (20:00 to 05:00)
function isRestrictedTime() {
    const now = new Date();
    const hour = now.getHours();
    return hour >= 20 || hour < 5;
}

// Function to get user purchases
function getUserPurchases(userId) {
    return new Promise((resolve, reject) => {
        db.all(`
            SELECT * FROM user_purchases WHERE user_id = ?
            UNION ALL
            SELECT login_sales.user_id, login_data as card_number, '' as card_month, '' as card_year, '' as card_cvv, 
                   category as bin, category as brand, login_sales.price, 'LOGIN' as status, '' as verification_message, login_sales.created_at 
            FROM login_sales 
            JOIN logins ON login_sales.login_id = logins.id 
            WHERE login_sales.user_id = ?
            ORDER BY created_at DESC LIMIT 20
        `, [userId, userId], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

discordClient.once('ready', () => {
    console.log(`✅ Bot do Discord logado como ${discordClient.user.tag}`);
    console.log(`ID do cliente: ${DISCORD_CLIENT_ID}`);
});

// Register new members
discordClient.on('guildMemberAdd', async (member) => {
    const userId = parseInt(member.id);
    await registerUser(userId);
    
    console.log(`📝 Novo membro registrado: ${member.user.tag} (ID: ${userId}) em ${new Date().toISOString()}`);
    
    // Store member info in database
    db.run(`CREATE TABLE IF NOT EXISTS discord_members (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        joined_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    
    db.run("INSERT OR REPLACE INTO discord_members (user_id, username) VALUES (?, ?)", 
        [userId, member.user.tag]);
});

discordClient.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // Time restriction check (except for admins)
    if (isRestrictedTime() && !isAdmin(message.member)) {
        await message.delete().catch(() => {});
        const reply = await message.channel.send(`${message.author}, o chat está restrito entre 20:00 e 05:00. Apenas administradores podem enviar mensagens.`);
        setTimeout(() => reply.delete().catch(() => {}), 5000);
        return;
    }

    if (message.content.startsWith('/')) {
        const command = message.content.slice(1).split(' ')[0].toLowerCase();
        const args = message.content.slice(command.length + 2);
        const userId = parseInt(message.author.id);

        // Register user if not exists
        await registerUser(userId);

        if (command === 'start') {
            const embed = new EmbedBuilder()
                .setTitle("🤖 COMANDOS DISPONÍVEIS - STORAGEBLACK")
                .setDescription("Aqui estão todos os comandos disponíveis:")
                .setColor(0x00ff00)
                .addFields(
                    { name: '💳 /gg', value: 'Ver todos os cartões disponíveis para compra', inline: false },
                    { name: '🔑 /lg', value: 'Ver todos os logins disponíveis para compra', inline: false },
                    { name: '💰 /pix [valor]', value: 'Gerar código PIX para adicionar saldo (ex: /pix 20)', inline: false },
                    { name: '📊 /perfil', value: 'Ver seu perfil com saldo e informações', inline: false },
                    { name: '🛍️ /pv', value: 'Ver seu histórico de compras (enviado no privado)', inline: false },
                    { name: '🎁 /gift [código]', value: 'Resgatar um código de presente (ex: /gift ABC12345)', inline: false },
                    { name: '🎁 /resgatar [código]', value: 'Resgatar um código de presente (ex: /resgatar ABC12345)', inline: false },
                    { name: '---', value: '**COMANDOS DE ADMINISTRADOR**', inline: false },
                    { name: '📢 /mencionar', value: 'Mencionar todos os membros do servidor (apenas admin)', inline: false },
                    { name: '💎 /donate [cartões]', value: 'Doar cartões e mencionar todos (apenas admin)', inline: false }
                )
                .setFooter({ text: 'StorageBlack - A melhor storage de GGs!' });

            return message.reply({ embeds: [embed] });
        }

        if (command === 'pix') {
            const amountStr = args.trim().replace(',', '.');
            const amount = parseFloat(amountStr);

            if (isNaN(amount) || amount <= 0) {
                return message.reply("❌ Uso correto: /pix [valor] (ex: /pix 20)");
            }

            const { pixCode, qrCodeUrl } = generatePixPayment(amount);
            const paymentId = `${userId}_${Date.now()}`;
            
            pendingPixPayments.set(paymentId, {
                userId,
                amount,
                timestamp: Date.now()
            });

            const embed = new EmbedBuilder()
                .setTitle("💰 DEPÓSITO VIA PIX")
                .setDescription(`**Valor:** R$ ${amount.toFixed(2)}\n\n**Código Copia e Cola:**\n\`\`\`${pixCode}\`\`\`\n\n⚠️ **ATENÇÃO:** Após realizar o pagamento, aguarde até 5 minutos para confirmação automática.`)
                .setColor(0x00ff00)
                .setImage(qrCodeUrl)
                .setFooter({ text: 'O saldo será adicionado automaticamente após confirmação do pagamento' });

            await message.reply({ embeds: [embed] });

            // Simulate payment confirmation after 30 seconds (in production, integrate with real payment gateway)
            setTimeout(async () => {
                const payment = pendingPixPayments.get(paymentId);
                if (payment) {
                    await updateUserBalance(payment.userId, payment.amount);
                    const user = await getUser(payment.userId);
                    
                    const confirmEmbed = new EmbedBuilder()
                        .setTitle("✅ PAGAMENTO CONFIRMADO!")
                        .setDescription(`**Valor recebido:** R$ ${payment.amount.toFixed(2)}\n**Novo saldo:** R$ ${user.balance.toFixed(2)}`)
                        .setColor(0x00ff00);

                    message.channel.send({ content: `<@${message.author.id}>`, embeds: [confirmEmbed] });
                    pendingPixPayments.delete(paymentId);
                }
            }, 30000); // 30 seconds for demo, use webhook in production
        }

        if (command === 'gg') {
            const bins = await getBinCounts();

            if (bins.length === 0) {
                return message.reply("❌ Nenhum cartão disponível no momento.");
            }

            const embed = new EmbedBuilder()
                .setTitle("💳 CARTÕES DISPONÍVEIS")
                .setDescription("Use `/comprar [BIN]` para comprar um cartão.\nExemplo: `/comprar 123456`")
                .setColor(0x00ff00);

            for (const binInfo of bins) {
                const price = await getBinPrice(binInfo.bin);
                embed.addFields({
                    name: `${binInfo.brand.toUpperCase()} ${binInfo.bin}`,
                    value: `Quantidade: ${binInfo.count}\nPreço: R$ ${price.toFixed(2)}`,
                    inline: true
                });
            }

            message.reply({ embeds: [embed] });
        }

        if (command === 'lg') {
            const loginCategories = await getLoginCategories();

            if (loginCategories.length === 0) {
                return message.reply("❌ Nenhum login disponível no momento.");
            }

            const embed = new EmbedBuilder()
                .setTitle("🔑 LOGINS DISPONÍVEIS")
                .setDescription("Use `/comprarlogin [categoria]` para comprar.\nExemplo: `/comprarlogin netflix`")
                .setColor(0x0099ff);

            for (const cat of loginCategories) {
                const price = await getLoginPrice(cat.category);
                embed.addFields({
                    name: cat.category.toUpperCase(),
                    value: `Quantidade: ${cat.count}\nPreço: R$ ${price.toFixed(2)}`,
                    inline: true
                });
            }

            message.reply({ embeds: [embed] });
        }

        if (command === 'comprar') {
            const bin = args.trim();
            if (!bin) return message.reply("❌ Uso: /comprar [BIN]");

            const user = await getUser(userId);
            const price = await getBinPrice(bin);

            if (user.balance < price) {
                return message.reply(`❌ Saldo insuficiente! Você precisa de R$ ${price.toFixed(2)}. Use /pix para adicionar saldo.`);
            }

            const card = await getRandomCardByBin(bin);
            if (!card) {
                return message.reply("❌ Nenhum cartão disponível para esta BIN.");
            }

            await updateUserBalance(userId, -price);
            await deleteCard(card.id);
            await recordSale(userId, card.id, price);
            
            // Store purchase history
            db.run(`INSERT INTO user_purchases (user_id, card_number, card_month, card_year, card_cvv, bin, brand, price, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PURCHASED')`,
                [userId, card.number, card.month, card.year, card.cvv, card.bin, card.brand, price]);

            const updatedUser = await getUser(userId);

            const embed = new EmbedBuilder()
                .setTitle("✅ COMPRA REALIZADA!")
                .setDescription(`**Cartão:** \`${card.number}|${card.month}|${card.year}|${card.cvv}\`\n**BIN:** ${card.bin}\n**Bandeira:** ${card.brand.toUpperCase()}\n**Preço:** R$ ${price.toFixed(2)}\n**Saldo Restante:** R$ ${updatedUser.balance.toFixed(2)}`)
                .setColor(0x00ff00)
                .setFooter({ text: 'Use o cartão imediatamente!' });

            message.author.send({ embeds: [embed] }).catch(() => {
                message.reply({ embeds: [embed] });
            });
        }

        if (command === 'comprarlogin') {
            const category = args.trim().toLowerCase();
            if (!category) return message.reply("❌ Uso: /comprarlogin [categoria]");

            const user = await getUser(userId);
            const price = await getLoginPrice(category);

            if (user.balance < price) {
                return message.reply(`❌ Saldo insuficiente! Você precisa de R$ ${price.toFixed(2)}. Use /pix para adicionar saldo.`);
            }

            const loginData = await getRandomLoginByCategory(category);
            if (!loginData) {
                return message.reply(`❌ Nenhum login ${category.toUpperCase()} disponível.`);
            }

            await updateUserBalance(userId, -price);
            await deleteLogin(loginData.id);
            await recordLoginSale(userId, loginData.id, price);

            const updatedUser = await getUser(userId);

            const embed = new EmbedBuilder()
                .setTitle("✅ COMPRA REALIZADA!")
                .setDescription(`**Login ${category.toUpperCase()}:** \`${loginData.login_data}\`\n**Preço:** R$ ${price.toFixed(2)}\n**Saldo Restante:** R$ ${updatedUser.balance.toFixed(2)}`)
                .setColor(0x00ff00);

            message.author.send({ embeds: [embed] }).catch(() => {
                message.reply({ embeds: [embed] });
            });
        }

        if (command === 'perfil') {
            const user = await getUser(userId);
            const embed = new EmbedBuilder()
                .setTitle("📊 SEU PERFIL")
                .setDescription(`**ID:** ${userId}\n**Saldo:** R$ ${user.balance.toFixed(2)}\n**Pontos:** ${user.points}`)
                .setColor(0x0099ff);

            message.reply({ embeds: [embed] });
        }

        if (command === 'pv') {
            const purchases = await getUserPurchases(userId);
            
            if (purchases.length === 0) {
                return message.author.send("❌ Você ainda não fez nenhuma compra.").catch(() => {
                    message.reply("❌ Você ainda não fez nenhuma compra. (Não consegui enviar mensagem privada)");
                });
            }

            let purchaseText = "🛍️ **SEU HISTÓRICO DE COMPRAS**\n\n";
            for (const p of purchases) {
                if (p.status === 'LOGIN') {
                    purchaseText += `🔑 Login ${p.bin.toUpperCase()}: \`${p.card_number}\` - R$ ${p.price.toFixed(2)}\n`;
                } else {
                    purchaseText += `💳 Cartão: \`${p.card_number}|${p.card_month}|${p.card_year}|${p.card_cvv}\` - R$ ${p.price.toFixed(2)}\n`;
                }
                purchaseText += `   Data: ${new Date(p.created_at).toLocaleString('pt-BR')}\n\n`;
            }

            message.author.send(purchaseText).catch(() => {
                message.reply("❌ Não consegui enviar mensagem privada. Verifique suas configurações de privacidade.");
            });

            if (message.channel.type === 0) { // Guild text channel
                message.reply("✅ Histórico enviado no seu privado!");
            }
        }

        if (command === 'gift' || command === 'resgatar') {
            const code = args.trim().toUpperCase();
            if (code.length !== 8) {
                return message.reply("❌ Uso: /gift [código] ou /resgatar [código] (código de 8 caracteres)");
            }

            const giftData = await getGiftCode(code);
            if (!giftData) {
                return message.reply("❌ Código de gift inválido ou já utilizado!");
            }

            await useGiftCode(code, userId);
            await updateUserBalance(userId, giftData.amount);
            const user = await getUser(userId);

            const embed = new EmbedBuilder()
                .setTitle("🎁 GIFT RESGATADO!")
                .setDescription(`**Código:** \`${code}\`\n**Valor:** R$ ${giftData.amount.toFixed(2)}\n**Novo Saldo:** R$ ${user.balance.toFixed(2)}`)
                .setColor(0x00ff00);

            message.reply({ embeds: [embed] });
        }

        if (command === 'mencionar') {
            if (!isAdmin(message.member)) {
                return message.reply("❌ Apenas administradores podem usar este comando!");
            }

            const members = await message.guild.members.fetch();
            const mentions = members.map(m => `<@${m.id}>`).join(' ');
            
            // Split message if too long
            const chunks = [];
            let currentChunk = "📢 **ATENÇÃO A TODOS!**\n\n";
            for (const mention of mentions.split(' ')) {
                if ((currentChunk + mention).length > 1900) {
                    chunks.push(currentChunk);
                    currentChunk = mention + ' ';
                } else {
                    currentChunk += mention + ' ';
                }
            }
            if (currentChunk) chunks.push(currentChunk);

            for (const chunk of chunks) {
                await message.channel.send(chunk);
            }
        }

        if (command === 'donate') {
            if (!isAdmin(message.member)) {
                return message.reply("❌ Apenas administradores podem usar este comando!");
            }

            const cardsData = args.split('\n').filter(line => line.includes('|'));
            
            if (cardsData.length === 0) {
                return message.reply("❌ Uso: /donate seguido dos cartões (um por linha)\nExemplo:\n/donate 123456789012|12|2025|123\n234567890123|11|2026|456");
            }

            let added = 0;
            for (const cardDataStr of cardsData) {
                const parts = cardDataStr.trim().split("|");
                if (parts.length !== 4) continue;

                const [number, month, year, cvv] = parts;
                const bin = number.substring(0, 6);
                const brand = getCardBrand(number);
                const type = getCardType(number);

                const result = await addCard(number, month, year, cvv, bin, brand, type);
                if (result) added++;
            }

            const members = await message.guild.members.fetch();
            const mentions = members.map(m => `<@${m.id}>`).join(' ');

            const embed = new EmbedBuilder()
                .setTitle("💎 DOAÇÃO DE CARTÕES!")
                .setDescription(`✅ **${added} cartões** foram doados para a comunidade!\n\nUse **/gg** para ver os cartões disponíveis!`)
                .setColor(0xFFD700);

            await message.channel.send({ content: mentions, embeds: [embed] });
        }
    }
});


// --- Main Execution ---
async function main() {
    console.log("🚀 Iniciando bots...");

    // Initialize DB
    initDB();

    // Start Telegram Bot
    console.log("📱 Bot do Telegram iniciando...");
    // Telegram bot is already started with `polling: true`

    // Start Discord Bot
    console.log("🎮 Bot do Discord iniciando...");
    try {
        await discordClient.login(DISCORD_BOT_TOKEN);
        console.log("✅ Bot do Discord iniciado!");
    } catch (err) {
        console.error("❌ Erro ao iniciar bot do Discord:", err);
    }
}

main().catch(err => {
    console.error("❌ Erro fatal na inicialização:", err);
});