// discord_bot.js

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from './src/config.js';
import { exec } from 'child_process'; // For running scripts
import puppeteer from 'puppeteer';    // For screenshots

// --- Configuration ---
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DB_FILE = path.resolve(process.cwd(), 'trading_bot.db');
const LIVE_ANALYSIS_FILE = 'live_analysis.json';
const LIVE_RISK_FILE = 'live_risk.json';
const MANUAL_CLOSE_FILE = 'manual_close.json';
const CHART_HTML_FILE = path.resolve(process.cwd(), 'chart.html');
const CHART_IMG_FILE = path.resolve(process.cwd(), 'chart.png');


if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error("[!!!] CRITICAL: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is not set in the .env file.");
    process.exit(1);
}

// --- Gemini AI Setup ---
let geminiModel;
if (GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        console.log("[*] Gemini AI configured successfully.");
    } catch (error) {
        console.error(`[!!!] Failed to initialize Gemini AI: ${error.message}`);
        geminiModel = null;
    }
} else {
    console.log("[!!!] WARNING: GEMINI_API_KEY not found in .env. The !ask command will be disabled.");
    geminiModel = null;
}

// --- Bot & Database Setup ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

let db;
let lastProcessedEventId = 0;
const commandPrefix = "!";

// --- Helper Functions (omitted for brevity, they remain the same) ---
async function getDbConnection() {
    if (db) return db;
    try {
        db = await open({
            filename: DB_FILE,
            driver: sqlite3.Database,
            mode: sqlite3.OPEN_READONLY
        });
        console.log('[*] Connected to the database successfully.');
        return db;
    } catch (error) {
        console.error(`[!!!] CRITICAL: Could not connect to database at "${DB_FILE}": ${error.message}`);
        return null;
    }
}

async function readJsonFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        console.error(`[!] Error reading JSON file ${filePath}: ${error.message}`);
        return null;
    }
}

function formatEventDetails(eventType, details) {
    try {
        if (eventType === "TRADE_EXECUTED") {
            const { asset, size, avg_px } = details;
            return `Bought ${Number(size).toFixed(4)} ${asset} @ $${Number(avg_px).toFixed(2)}`;
        }
        if (eventType === "FIB_STOP_HIT") {
            const { asset, current_price, stop_price, roe } = details;
            return `Closed ${asset} position. Price ${Number(current_price).toFixed(2)} hit stop ${Number(stop_price).toFixed(2)}. ROE: ${Number(roe * 100).toFixed(2)}%`;
        }
        if (eventType === "TAKE-PROFIT HIT" || eventType === "STOP-LOSS HIT") {
             const { asset, reason, value } = details;
             return `Closed ${asset} position due to ${reason}. Trigger: ${value}`;
        }
         if (eventType === "NEW_POSITION_MONITORING"){
             const { asset, entry_price } = details;
             return `New position opened for ${asset} at $${Number(entry_price).toFixed(2)}`;
         }
        const detailsStr = JSON.stringify(details);
        return (detailsStr.length > 200) ? detailsStr.substring(0, 197) + '...' : detailsStr;
    } catch {
        return "Could not parse details.";
    }
}

// --- Background Tasks (omitted for brevity, they remain the same) ---
async function checkForEvents() {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;
    const localDb = await getDbConnection();
    if (!localDb) return;

    try {
        const newEvents = await localDb.all(
            "SELECT id, event_type, details FROM events WHERE id > ? ORDER BY id ASC",
            [lastProcessedEventId]
        );

        for (const event of newEvents) {
            const details = JSON.parse(event.details);
            const eventType = event.event_type;
            const embed = new EmbedBuilder().setTimestamp(new Date());

            switch (eventType) {
                case "TRADE_EXECUTED":
                    embed.setTitle("✅ TRADE EXECUTED!").setDescription(`Bought **${details.size.toFixed(4)} ${details.asset}** @ **$${details.avg_px.toFixed(2)}**`).setColor(0x0099FF);
                    break;
                case "FIB_STOP_HIT": case "STOP-LOSS HIT":
                    embed.setTitle("🚨 STOP-LOSS TRIGGERED!").setDescription(`Closed position for **${details.asset}**. Reason: **${eventType}**`).setColor(0xFF0000);
                    break;
                case "TAKE-PROFIT HIT":
                    embed.setTitle("💰 TAKE PROFIT HIT!").setDescription(`Closed position for **${details.asset}**. ROE: **${details.value}**`).setColor(0x00FF00);
                    break;
                default: continue;
            }
            await channel.send({ embeds: [embed] });
            lastProcessedEventId = event.id;
        }
    } catch (error) {
        console.error(`[!] Error in check_for_events loop: ${error.message}`);
    }
}

async function sendStatusReport() {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;
    const localDb = await getDbConnection();
    if (!localDb) return;

    const riskData = await readJsonFile(LIVE_RISK_FILE);
    const analysisData = await readJsonFile(LIVE_ANALYSIS_FILE);
    const embed = new EmbedBuilder().setTitle("✅ 15-Minute Status Report").setDescription("Bot is alive and monitoring.").setColor(0x3498DB).setTimestamp(new Date());

    if (riskData) {
        const pnlEmoji = riskData.roe.includes('-') ? "🔽" : "🔼";
        const fieldValue = `**Entry:** \`$${riskData.entryPrice.toFixed(2)}\`\n**Live Price:** \`$${riskData.currentPrice.toFixed(2)}\`\n**Est. Live ROE:** \`${pnlEmoji} ${riskData.roe}\`\n**Fib Stop Active:** \`${riskData.fibStopActive}\`\n**Current Stop:** \`$${riskData.stopPrice ? riskData.stopPrice.toFixed(2) : 'N/A'}\``;
        embed.addFields({ name: `📊 Open Position: ${riskData.asset}`, value: fieldValue, inline: false });
    } else {
        embed.setDescription("Bot is alive. No open positions.");
    }
    if (analysisData) {
        embed.addFields(
            { name: "Fib Entry", value: `\`$${analysisData.fib_entry.toFixed(2)}\``, inline: true },
            { name: "Fib 0", value: `\`$${analysisData.wma_fib_0.toFixed(2)}\``, inline: true },
        );
        // --- MODIFIED THIS BLOCK ---
        if (analysisData.stoch_rsi && analysisData.stoch_rsi.k && analysisData.stoch_rsi.d) {
        	const k = analysisData.stoch_rsi.k;
        	let k_indicator = '';
        	if (k < 20) k_indicator = '🟢 (Oversold)';
        	if (k > 80) k_indicator = '🔴 (Overbought)';
        	
        	const d = analysisData.stoch_rsi.d;
        	let d_indicator = '';
        	if (d < 20) d_indicator = '🟢';
        	if (d > 80) d_indicator = '🔴';


        	embed.addFields({ name: "Stoch RSI", value: `K: \`${k.toFixed(2)}\` ${k_indicator}\nD: \`${d.toFixed(2)}\` ${d_indicator}`, inline: true });
        } else {
        	embed.addFields({ name: "Stoch RSI", value: "`Calculating...`", inline: true });
        }
    }
     const lastEvent = (await localDb.get('SELECT event_type, timestamp FROM events ORDER BY id DESC LIMIT 1'));
     if(lastEvent){
        const eventTime = new Date(lastEvent.timestamp).toLocaleTimeString();
        embed.setFooter({ text: `Last Event: ${lastEvent.event_type} at ${eventTime}` });
     }
    await channel.send({ embeds: [embed] });
}
// --- Bot Events & Command Handling ---
client.on('ready', async () => {
    console.log(`--- Discord Bot Connected ---`);
    console.log(`[*] Logged in as: ${client.user.tag}`);
    const localDb = await getDbConnection();
    if(localDb){
        const lastEvent = await localDb.get('SELECT id FROM events ORDER BY id DESC LIMIT 1');
        if (lastEvent) lastProcessedEventId = lastEvent.id;
        console.log(`[*] Starting event checks from ID: ${lastProcessedEventId}`);
    }
    setInterval(checkForEvents, 10000);
    setInterval(sendStatusReport, 15 * 60 * 1000);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(commandPrefix) || message.channel.id !== CHANNEL_ID) return;

    const args = message.content.slice(commandPrefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Command handlers for status, panic, logs, monitor...
    if (command === 'status') {
        await message.channel.send("Fetching instant status report...");
        await sendStatusReport();
    }

    if (command === 'panic') {
         const riskData = await readJsonFile(LIVE_RISK_FILE);
         if (!riskData) return message.channel.send("There are no open positions to close.");
         await fs.writeFile(MANUAL_CLOSE_FILE, JSON.stringify({ signal: 'close', reason: 'manual_panic' }, null, 2));
         const embed = new EmbedBuilder().setTitle("🚨 Panic Close Initiated").setDescription(`A signal has been sent to the trading bot to close the **${riskData.asset}** position.`).setColor(0xFFA500);
         await message.channel.send({ embeds: [embed] });
    }

    if (command === 'logs') {
        const limit = args[0] ? parseInt(args[0]) : 10;
        if (isNaN(limit) || limit <= 0 || limit > 25) return message.channel.send("Please provide a valid limit between 1 and 25.");
        await message.channel.send(`📜 Fetching the last ${limit} bot events...`);
        const localDb = await getDbConnection();
        if(!localDb) return message.channel.send("Database connection not available.");
        const events = await localDb.all('SELECT timestamp, event_type, details FROM events ORDER BY id DESC LIMIT ?', [limit]);
        if (!events || events.length === 0) return message.channel.send("No events found in the database.");
        const embed = new EmbedBuilder().setTitle("📜 Recent Bot Events").setColor(0x7289DA);
        let description = "";
        for (const event of events.reverse()) {
            const ts = new Date(event.timestamp).toLocaleTimeString();
            const details = JSON.parse(event.details);
            const detailsStr = formatEventDetails(event.event_type, details);
            description += `\`${ts}\` **${event.event_type}**\n\` > \` ${detailsStr}\n`;
        }
        embed.setDescription(description);
        await message.channel.send({ embeds: [embed] });
    }

    if (command === 'monitor') {
        const riskData = await readJsonFile(LIVE_RISK_FILE);
        const analysisData = await readJsonFile(LIVE_ANALYSIS_FILE);
        const localDb = await getDbConnection();
        const embed = new EmbedBuilder().setTitle("🤖 Hyperliquid Bot Live Monitor").setColor(0x00FFFF).setTimestamp(new Date());

        let riskDescription = "No open positions being tracked.";
        if (riskData) {
            const { leverage } = config.trading;
            const leveragedSLPct = config.risk.stopLossPercentage / leverage;
            const leveragedTPPct = config.risk.takeProfitPercentage / leverage;
            const stopLossPrice = riskData.entryPrice * (1 - leveragedSLPct);
            const takeProfitPrice = riskData.entryPrice * (1 + leveragedTPPct);
            const roeDisplay = riskData.roe.includes('-') ? `🔴 ${riskData.roe}` : `🟢 ${riskData.roe}`;

            riskDescription = `\`\`\`
Asset         : ${riskData.asset}
Entry Price   : $${riskData.entryPrice.toFixed(2)}
Current Price : $${riskData.currentPrice.toFixed(2)}
Live ROE      : ${roeDisplay}
----------------------------------
Stop Type     : ${riskData.fibStopActive ? 'Fib Trail Stop (Price)' : 'Fixed Stop-Loss (ROE)'}
Stop Price    : $${riskData.fibStopActive ? riskData.stopPrice.toFixed(2) : stopLossPrice.toFixed(2) + ` (for ${leverage}x)`}
Take Profit   : $${takeProfitPrice.toFixed(2)} (for ${leverage}x)
\`\`\``;
        }
        embed.addFields({ name: "🛡️ Live Position & Risk Management", value: riskDescription });

        let analysisDescription = "Waiting for analysis data...";
        if (analysisData) {
            // --- MODIFIED THIS BLOCK ---
             let stochRSI_K_text = 'N/A';
             let stochRSI_D_text = 'N/A';

             if (analysisData.stoch_rsi) {
                const k = analysisData.stoch_rsi.k;
                let k_indicator = '';
                if (k < 20) k_indicator = '🟢 (Oversold)';
                if (k > 80) k_indicator = '🔴 (Overbought)';
                stochRSI_K_text = `${k.toFixed(2)} ${k_indicator}`;

                const d = analysisData.stoch_rsi.d;
                let d_indicator = '';
                if (d < 20) d_indicator = '🟢';
                if (d > 80) d_indicator = '🔴';
                stochRSI_D_text = `${d.toFixed(2)} ${d_indicator}`;
             }
            
            analysisDescription = `\`\`\`
Latest Price  : $${analysisData.latest_price.toFixed(2)}
Fib Entry Lvl : $${analysisData.fib_entry.toFixed(2)}
WMA Fib 0 Lvl : $${analysisData.wma_fib_0.toFixed(2)}
Stoch RSI (K) : ${stochRSI_K_text}
Stoch RSI (D) : ${stochRSI_D_text}
\`\`\``;
        }
        embed.addFields({ name: "🔬 Live Technical Analysis", value: analysisDescription });

        if (localDb) {
            const events = await localDb.all("SELECT timestamp, event_type FROM events ORDER BY id DESC LIMIT 10");
            let eventDescription = "No events logged yet.";
            if (events.length > 0) {
                eventDescription = events.reverse().map(e => {
                    const time = new Date(e.timestamp).toLocaleTimeString();
                    return `\`${time}\` - **${e.event_type}**`;
                }).join('\n');
            }
            embed.addFields({ name: "📜 Recent Events (last 10)", value: eventDescription });
        }
        await message.channel.send({ embeds: [embed] });
    }

    // ==========================================================
    // /// <<<--- NEW CHART COMMAND ---
    // ==========================================================
   if (command === 'chart') {
    await message.channel.send("📊 Generating live chart, please wait a moment...");

    // 1. Run the chart generator script to create chart.html
    exec('node src/utils/ChartGenerator.js', async (error, stdout, stderr) => {
        if (error) {
            console.error(`[Chart Command] Error executing script: ${error}`);
            return message.channel.send("❌ Failed to generate chart data.");
        }

        try {
            // 2. Launch Puppeteer to take a screenshot
            const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
            const page = await browser.newPage();
            // Go to the locally generated HTML file
            await page.goto(`file://${CHART_HTML_FILE}`);
            await page.setViewport({ width: 1200, height: 750 });
            await page.screenshot({ path: CHART_IMG_FILE });
            await browser.close();

            // 3. Send the image to Discord
            const file = new AttachmentBuilder(CHART_IMG_FILE);
            const embed = new EmbedBuilder()
                .setTitle(`📈 Live Chart for ${config.trading.asset}`)
                .setImage(`attachment://${path.basename(CHART_IMG_FILE)}`)
                .setColor(0x7289DA)
                .setTimestamp(new Date());

            await message.channel.send({ embeds: [embed], files: [file] });

            // 4. Clean up BOTH generated files
            await fs.unlink(CHART_HTML_FILE);
            await fs.unlink(CHART_IMG_FILE);

        } catch (screenshotError) {
            console.error(`[Chart Command] Error during screenshot process: ${screenshotError}`);
            await message.channel.send("❌ An error occurred while capturing the chart image.");
        }
    });
}

    if (command === 'ask') {
        // ... ask command logic remains the same ...
        if (!geminiModel) return message.channel.send("Sorry, Master. My AI core is not configured. Please check the API key.");
        const question = args.join(' ');
        if (!question) return message.channel.send("Please ask a question, Master.");

        await message.channel.sendTyping();

        const analysisData = await readJsonFile(LIVE_ANALYSIS_FILE);
        const riskData = await readJsonFile(LIVE_RISK_FILE);

        const analysisDataStr = JSON.stringify(analysisData, null, 2) || "Not available.";
        let positionContextStr = "I am not currently in a position.";
        if (riskData) {
            positionContextStr = `I am currently in a LONG position for ${riskData.asset}. My entry price was $${riskData.entryPrice.toFixed(2)}, the current price is $${riskData.currentPrice.toFixed(2)}, and my current ROE is ${riskData.roe}.`;
        }

        const prompt = `You are a hyper-intelligent, loyal trading bot serving your "Master".

        This is your current operational status:
        ${positionContextStr}

        This is your internal market analysis data:
        \`\`\`json
        ${analysisDataStr}
        \`\`\`
        Your Master has asked: "${question}"

        Based on your operational status AND your market analysis, formulate a helpful and respectful response. Address your creator as "Master". Be conversational and interpret the data for them. Avoid listing exact numbers unless explicitly asked.`;

        try {
            const result = await geminiModel.generateContent(prompt);
            const response = await result.response;
            const text = response.text();
            await message.channel.send(text);
        } catch (error) {
            console.error(`[!!!] Gemini AI Error: ${error.message}`);
            await message.channel.send("I apologize, Master. I encountered an error while processing your request with my AI core.");
        }
    }
});

// --- Run the Bot ---
client.login(BOT_TOKEN);