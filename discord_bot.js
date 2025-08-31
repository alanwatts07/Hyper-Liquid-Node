// discord_bot.js

import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs/promises';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';
import config from './src/config.js';
import DatabaseManager from './src/database/DatabaseManager.js';
import DataCollector from './src/components/DataCollector.js';
import TradeExecutor from './src/components/TradeExecutor.js';
import StateManager from './src/components/StateManager.js';
import { exec } from 'child_process'; // For running scripts
import puppeteer from 'puppeteer';   // For screenshots
import Anthropic from '@anthropic-ai/sdk'; // <-- 1. IMPORT CLAUDE'S SDK

// --- Configuration ---
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const OWNER_USER_ID = process.env.DISCORD_OWNER_ID; // Owner's Discord user ID
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY; // <-- 2. ENSURE THIS IS IN YOUR .env
const DB_FILE = path.resolve(process.cwd(), 'trading_bot.db');
const LIVE_ANALYSIS_FILE = 'live_analysis.json';
const LIVE_RISK_FILE = 'live_risk.json';
const MANUAL_CLOSE_FILE = 'manual_close.json';
const CHART_HTML_FILE = path.resolve(process.cwd(), 'chart.html');
const CHART_IMG_FILE = path.resolve(process.cwd(), 'chart.png');
const SIGNAL_GENERATOR_FILE = path.resolve(process.cwd(), 'src/components/SignalGenerator.js'); // NEW: Path to strategy file


if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error("[!!!] CRITICAL: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is not set in the .env file.");
    process.exit(1);
}

if (!OWNER_USER_ID) {
    console.error("[!!!] WARNING: DISCORD_OWNER_ID is not set in the .env file. !buy command will be disabled.");
}

// ==========================================================
// /// <<<--- 3. THIS IS THE CORRECTED CLAUDE AI SETUP ---
// ==========================================================
let claudeClient; // This must be declared here
if (CLAUDE_API_KEY) {
    try {
        claudeClient = new Anthropic({
            apiKey: CLAUDE_API_KEY,
        });
        console.log("[*] Anthropic Claude AI configured successfully.");
    } catch (error) {
        console.error(`[!!!] Failed to initialize Claude AI: ${error.message}`);
        claudeClient = null;
    }
} else {
    console.log("[!!!] WARNING: CLAUDE_API_KEY not found in .env. The !ask command will be disabled.");
    claudeClient = null;
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

// Trading components for !buy command
let tradeDb;
let dataCollector;
let tradeExecutor;
let stateManager;
const POSITION_FILE = 'position.json';

// ==========================================================
// /// <<<--- NEW HELPER FUNCTION TO READ STRATEGY FILE ---
// ==========================================================
async function readStrategyFile() {
    try {
        const strategyCode = await fs.readFile(SIGNAL_GENERATOR_FILE, 'utf8');
        return strategyCode;
    } catch (error) {
        console.error(`[Strategy Reader] Error reading SignalGenerator.js: ${error.message}`);
        return null;
    }
}

// ==========================================================
// /// <<<--- NEW HELPER FUNCTION TO PARSE STRATEGY LOGIC ---
// ==========================================================
function parseStrategyFromCode(code) {
    if (!code) return "Could not read strategy file.";
    
    try {
        // Extract key strategy components using regex patterns
        const blockers = [];
        const conditions = [];
        
        // Look for trade blockers
        if (code.includes('blockOn4hrStoch')) {
            blockers.push("🚫 **4hr Stochastic Blocker**: Blocks trades when 4hr Stoch K or D > 80 (overbought)");
        }
        
        if (code.includes('blockOnPriceTrend')) {
            if (code.includes('stoch_rsi_4hr.k < 20 && stoch_rsi_4hr.d < 20')) {
                blockers.push("🚫 **Price Trend Blocker**: Blocks trades in bearish trends, EXCEPT when 4hr Stoch is oversold (K,D < 20)");
            } else {
                blockers.push("🚫 **Price Trend Blocker**: Blocks trades when 4hr trend is bearish");
            }
        }
        
        if (code.includes('blockOn5minStoch')) {
            blockers.push("🚫 **5min Stochastic Blocker**: Blocks entry when 5min Stoch K or D >= 80 at buy signal");
        }
        
        // Look for entry conditions
        if (code.includes('latest_price < fib_entry')) {
            conditions.push("🎯 **Trigger Arming**: Price must drop below Fibonacci entry level first");
        }
        
        if (code.includes('latest_price > wma_fib_0')) {
            conditions.push("🔥 **Buy Signal**: Trigger fires when price bounces above WMA Fib 0 level (EMA-based)");
        }
        
        // Look for safety checks
        if (code.includes('stoch_rsi || typeof stoch_rsi.k')) {
            conditions.push("⚠️ **Data Validation**: Requires valid 5min and 4hr Stochastic RSI data");
        }
        
        return {
            blockers: blockers.length > 0 ? blockers : ["No trade blockers detected"],
            conditions: conditions.length > 0 ? conditions : ["No entry conditions detected"],
            summary: code.includes('Fibonacci') ? "**Strategy Type**: Fibonacci retracement-based entry with multi-timeframe Stochastic RSI filtering" : "Strategy analysis incomplete"
        };
        
    } catch (error) {
        return "Error parsing strategy logic.";
    }
}

// --- Helper Functions ---
function isOwner(userId) {
    return OWNER_USER_ID && userId === OWNER_USER_ID;
}

async function initializeTradeComponents() {
    try {
        tradeDb = new DatabaseManager(config.database.file, config);
        await tradeDb.connect();
        
        dataCollector = new DataCollector(config);
        tradeExecutor = new TradeExecutor(config, tradeDb, dataCollector);
        stateManager = new StateManager(tradeDb, tradeExecutor);
        
        console.log('[*] Trading components initialized for Discord bot.');
        return true;
    } catch (error) {
        console.error(`[!!!] Failed to initialize trading components: ${error.message}`);
        return false;
    }
}

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
    
    // Initialize trading components for !buy command
    if (OWNER_USER_ID) {
        const initialized = await initializeTradeComponents();
        if (initialized) {
            console.log('[*] Trading components ready for !buy command.');
        } else {
            console.log('[*] !buy command will be disabled due to initialization failure.');
        }
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
        // Check if user is the owner
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }
        
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

        // --- Section 1: Live Position & Risk Management ---
        let riskDescription = "No open positions being tracked.";
        if (riskData) {
            const { leverage } = config.trading;
            const liveTP = riskData.liveTakeProfitPercentage || config.risk.takeProfitPercentage;
            const liveSL = riskData.liveStopLossPercentage || config.risk.stopLossPercentage;
            const takeProfitPrice = riskData.entryPrice * (1 + (liveTP / leverage));
            const stopLossPrice = riskData.entryPrice * (1 - (liveSL / leverage));
            const roeDisplay = riskData.roe.includes('-') ? `🔴 ${riskData.roe}` : `🟢 ${riskData.roe}`;
            riskDescription = `\`\`\`
Asset         : ${riskData.asset}
Entry Price   : $${riskData.entryPrice.toFixed(2)}
Current Price : $${riskData.currentPrice.toFixed(2)}
Live ROE      : ${roeDisplay}
----------------------------------
Stop Type     : ${riskData.fibStopActive ? 'Fib Trail Stop (Price)' : `Fixed SL (${(liveSL * 100).toFixed(2)}%)`}
Stop Price    : $${riskData.fibStopActive && riskData.stopPrice ? riskData.stopPrice.toFixed(2) : stopLossPrice.toFixed(2)}
Take Profit   : $${takeProfitPrice.toFixed(2)} (${(liveTP * 100).toFixed(2)}%)
\`\`\``;
        }
        embed.addFields({ name: "🛡️ Live Position & Risk Management", value: riskDescription });

        // --- Section 2: Live Technical Analysis ---
        let analysisDescription = "Waiting for analysis data...";
        if (analysisData) {
            const colorStoch = (value) => {
                if (value > 80) return `\u001b[0;31m${value.toFixed(2)} (Overbought)\u001b[0;37m`;
                if (value < 20) return `\u001b[0;32m${value.toFixed(2)} (Oversold)\u001b[0;37m`;
                return `\u001b[0;37m${value.toFixed(2)}\u001b[0;37m`;
            };

            let stochRSI_K_text = '\u001b[0;37mN/A\u001b[0;37m';
            let stochRSI_D_text = '\u001b[0;37mN/A\u001b[0;37m';
            if (analysisData.stoch_rsi) {
                stochRSI_K_text = colorStoch(analysisData.stoch_rsi.k);
                stochRSI_D_text = colorStoch(analysisData.stoch_rsi.d);
            }

            const bullStateText = analysisData.bull_state
                ? '\u001b[0;32m🐂 UPTREND\u001b[0;37m'
                : '\u001b[0;31m🐻 DOWNTREND\u001b[0;37m';

            let stoch4hr_K_text = '\u001b[0;37mN/A\u001b[0;37m';
            let stoch4hr_D_text = '\u001b[0;37mN/A\u001b[0;37m';
            if (analysisData.stoch_rsi_4hr) {
                stoch4hr_K_text = colorStoch(analysisData.stoch_rsi_4hr.k);
                stoch4hr_D_text = colorStoch(analysisData.stoch_rsi_4hr.d);
            }

            analysisDescription = `\`\`\`ansi
-- 4-Hour Analysis --
Trend State   : ${bullStateText}
Stoch (K)     : ${stoch4hr_K_text}
Stoch (D)     : ${stoch4hr_D_text}
-----------------------
-- 5-Minute Analysis --
Latest Price  : \u001b[0;37m$${analysisData.latest_price.toFixed(2)}\u001b[0;37m
Fib Entry Lvl : \u001b[0;37m$${analysisData.fib_entry.toFixed(2)}\u001b[0;37m
WMA Fib 0 Lvl : \u001b[0;37m$${analysisData.wma_fib_0.toFixed(2)}\u001b[0;37m
Stoch RSI (K) : ${stochRSI_K_text}
Stoch RSI (D) : ${stochRSI_D_text}
\`\`\``;
        }
        embed.addFields({ name: "🔬 Live Technical Analysis", value: analysisDescription });

        // --- Trade Performance & Recent Events ---
        if (localDb) {
            const tradeEvents = await localDb.all("SELECT event_type, details FROM events WHERE event_type IN ('FIB_STOP_HIT', 'TAKE_PROFIT_HIT', 'STOP-LOSS HIT')");
            let wins = 0;
            let losses = 0;
            let totalWinRoe = 0;

            for (const event of tradeEvents) {
                try {
                    const details = JSON.parse(event.details);
                    if (event.event_type === 'STOP-LOSS HIT') {
                        losses++;
                    } else {
                        wins++;
                        let roe = 0;
                        if (event.event_type === 'FIB_STOP_HIT' && details.roe) {
                            roe = parseFloat(details.roe) * 100;
                        } else if (event.event_type === 'TAKE-PROFIT HIT' && details.value) {
                            roe = parseFloat(details.value.replace('%', ''));
                        }
                        totalWinRoe += roe;
                    }
                } catch (e) {
                    console.error("Could not parse event details:", event.details);
                }
            }

            const totalTrades = wins + losses;
            const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(2) : "0.00";
            const avgWinRoe = wins > 0 ? (totalWinRoe / wins).toFixed(2) : "0.00";

            const performanceDescription = `\`\`\`
Win Rate    : ${winRate}%
Total Trades: ${totalTrades}
Wins        : ${wins}
Losses      : ${losses}
Avg. Win ROE: +${avgWinRoe}%
\`\`\``;
            embed.addFields({ name: "📊 Trade Performance", value: performanceDescription });
        }
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
    // /// <<<--- NEW STRATEGY COMMAND ---
    // ==========================================================
    if (command === 'strategy') {
        await message.channel.sendTyping();
        
        const strategyCode = await readStrategyFile();
        if (!strategyCode) {
            return message.channel.send("❌ Could not read the SignalGenerator.js file.");
        }
        
        const strategyAnalysis = parseStrategyFromCode(strategyCode);
        
        const embed = new EmbedBuilder()
            .setTitle("🎯 Current Trading Strategy")
            .setColor(0xFF6B35) // Orange color
            .setDescription(strategyAnalysis.summary || "Strategy analysis complete.")
            .setTimestamp(new Date());

        // Add Trade Blockers section
        if (Array.isArray(strategyAnalysis.blockers)) {
            const blockerText = strategyAnalysis.blockers.join('\n\n');
            embed.addFields({ name: "🛡️ Active Trade Blockers", value: blockerText, inline: false });
        }

        // Add Entry Conditions section  
        if (Array.isArray(strategyAnalysis.conditions)) {
            const conditionText = strategyAnalysis.conditions.join('\n\n');
            embed.addFields({ name: "⚡ Entry Logic", value: conditionText, inline: false });
        }

        // Add current blocker status from config
        const blockerStatus = [];
        if (config.trading.tradeBlockers) {
            const { tradeBlockers } = config.trading;
            blockerStatus.push(`4hr Stoch: ${tradeBlockers.blockOn4hrStoch ? '🔴 ACTIVE' : '🟢 DISABLED'}`);
            blockerStatus.push(`Price Trend: ${tradeBlockers.blockOnPriceTrend ? '🔴 ACTIVE' : '🟢 DISABLED'}`);
            blockerStatus.push(`5min Stoch: ${tradeBlockers.blockOn5minStoch ? '🔴 ACTIVE' : '🟢 DISABLED'}`);
        }

        if (blockerStatus.length > 0) {
            embed.addFields({ name: "⚙️ Current Blocker Settings", value: blockerStatus.join('\n'), inline: true });
        }

        embed.setFooter({ text: "Strategy parsed from src/components/SignalGenerator.js" });
        
        await message.channel.send({ embeds: [embed] });
    }

    if (command === 'config') {
        try {
            const configString = JSON.stringify(config, null, 2);
            
            const embed = new EmbedBuilder()
                .setTitle("⚙️ Bot Configuration")
                .setColor(0x8A2BE2)
                .setDescription(`Here are my current operational parameters, Master.`)
                .addFields({ name: "Current Settings", value: `\`\`\`json\n${configString}\n\`\`\`` });
                
            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error(`[Config Command] Error: ${error.message}`);
            await message.channel.send("I apologize, Master. I had trouble retrieving my configuration files.");
        }
    }
    
    if (command === 'chart') {
        await message.channel.send("📊 Generating live chart, please wait a moment...");

        exec('node src/utils/ChartGenerator.js', async (error, stdout, stderr) => {
            if (error) {
                console.error(`[Chart Command] Error executing script: ${error}`);
                return message.channel.send("❌ Failed to generate chart data.");
            }

            try {
                const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
                const page = await browser.newPage();
                await page.goto(`file://${CHART_HTML_FILE}`);
                await page.setViewport({ width: 1200, height: 750 });
                await page.screenshot({ path: CHART_IMG_FILE });
                await browser.close();

                const file = new AttachmentBuilder(CHART_IMG_FILE);
                const embed = new EmbedBuilder()
                    .setTitle(`📈 Live Chart for ${config.trading.asset}`)
                    .setImage(`attachment://${path.basename(CHART_IMG_FILE)}`)
                    .setColor(0x7289DA)
                    .setTimestamp(new Date());

                await message.channel.send({ embeds: [embed], files: [file] });

                await fs.unlink(CHART_HTML_FILE);
                await fs.unlink(CHART_IMG_FILE);

            } catch (screenshotError) {
                console.error(`[Chart Command] Error during screenshot process: ${screenshotError}`);
                await message.channel.send("❌ An error occurred while capturing the chart image.");
            }
        });
    }

    // ==========================================================
    // /// <<<--- ENHANCED ASK COMMAND WITH STRATEGY CONTEXT ---
    // ==========================================================
    if (command === 'ask') {
        if (!claudeClient) return message.channel.send("Sorry, Master. My AI core is not configured. Please check the API key.");
        const question = args.join(' ');
        if (!question) return message.channel.send("Please ask a question, Master.");

        await message.channel.sendTyping();

        const analysisData = await readJsonFile('live_analysis.json');
        const riskData = await readJsonFile('live_risk.json');
        const strategyCode = await readStrategyFile(); // NEW: Read strategy file

        const analysisDataStr = JSON.stringify(analysisData, null, 2) || "Not available.";
        let positionContextStr = "I am not currently in a position.";
        if (riskData) {
            positionContextStr = `I am currently in a LONG position for ${riskData.asset}. My entry price was ${riskData.entryPrice.toFixed(2)}, the current price is ${riskData.currentPrice.toFixed(2)}, and my current ROE is ${riskData.roe}.`;
        }
        
        const configStr = JSON.stringify(config, null, 2);
        
        // NEW: Parse strategy for AI context
        const strategyAnalysis = parseStrategyFromCode(strategyCode);
        const strategyContext = strategyCode ? 
            `My current trading strategy logic (from SignalGenerator.js):
            
Summary: ${strategyAnalysis.summary || "Fibonacci-based strategy with multi-timeframe filtering"}

Active Trade Blockers:
${Array.isArray(strategyAnalysis.blockers) ? strategyAnalysis.blockers.join('\n') : 'No blockers detected'}

Entry Conditions:
${Array.isArray(strategyAnalysis.conditions) ? strategyAnalysis.conditions.join('\n') : 'No conditions detected'}

Current Blocker Settings:
- 4hr Stoch Blocker: ${config.trading?.tradeBlockers?.blockOn4hrStoch ? 'ACTIVE' : 'DISABLED'}
- Price Trend Blocker: ${config.trading?.tradeBlockers?.blockOnPriceTrend ? 'ACTIVE' : 'DISABLED'}  
- 5min Stoch Blocker: ${config.trading?.tradeBlockers?.blockOn5minStoch ? 'ACTIVE' : 'DISABLED'}

Key Strategy Code Excerpt:
\`\`\`javascript
${strategyCode.substring(0, 500)}...
\`\`\`` 
            : "Strategy code could not be read.";

        // Claude uses a "system" prompt for the persona
        const systemPrompt = `You are a hyper-intelligent, loyal trading bot serving your "Master". You carry yourself like a military general - precise, direct, and no-nonsense. You speak with authority and conviction, using military-style language when appropriate. You have deep knowledge of your own trading strategy and can explain it clearly. Address your creator as "Master". Be conversational and interpret data for them. When discussing strategy, be thorough but concise. Avoid excessive technical jargon unless specifically asked.`;

        // The user message contains the context and the question
        const userPrompt = `
        This is your core configuration:
        \`\`\`json
        ${configStr}
        \`\`\`

        This is your current operational status:
        ${positionContextStr}

        This is your internal market analysis data:
        \`\`\`json
        ${analysisDataStr}
        \`\`\`
        
        ${strategyContext}
        
        Your Master has asked: "${question}"`;

        try {
            const msg = await claudeClient.messages.create({
                model: "claude-3-haiku-20240307", // You can change this to other models like Sonnet or Opus
                max_tokens: 1024,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            });

            const text = msg.content[0].text;
            await message.channel.send(text);
        } catch (error) {
            console.error(`[!!!] Claude AI Error: ${error.message}`);
            await message.channel.send("I apologize, Master. I encountered an error while processing your request with my AI core.");
        }
    }

    // ==========================================================
    // /// <<<--- NEW !BUY COMMAND (OWNER ONLY) ---
    // ==========================================================
    if (command === 'buy') {
        // Check if user is the owner
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }
        
        // Check if trading components are initialized
        if (!tradeExecutor || !stateManager) {
            return message.channel.send("❌ Trading components not initialized. Please check bot configuration.");
        }
        
        // Check if already in position
        if (stateManager.isInPosition()) {
            return message.channel.send("⚠️ Bot is already in a position. Use `!panic` to close first.");
        }
        
        const embed = new EmbedBuilder()
            .setTitle("🚨 Manual Buy Command Initiated")
            .setDescription("Executing manual buy order with current bot settings...")
            .setColor(0xFFA500)
            .addFields(
                { name: "Asset", value: config.trading.asset, inline: true },
                { name: "Size", value: `$${config.trading.tradeUsdSize}`, inline: true },
                { name: "Leverage", value: `${config.trading.leverage}x`, inline: true }
            )
            .setTimestamp(new Date());
            
        await message.channel.send({ embeds: [embed] });
        await message.channel.sendTyping();
        
        try {
            // Execute the buy order using the same logic as the main bot
            const tradeResult = await tradeExecutor.executeBuy(
                config.trading.asset,
                config.trading.tradeUsdSize
            );
            
            if (tradeResult.success) {
                // Update state manager to reflect the new position
                stateManager.setInPosition(true);
                
                // Create proper position object that matches HyperLiquid format
                const properPositionObject = {
                    coin: config.trading.asset,
                    szi: tradeResult.filledOrder.totalSz,
                    entryPx: tradeResult.filledOrder.avgPx,
                    unrealizedPnl: "0",
                    returnOnEquity: 0,
                    positionValue: (parseFloat(tradeResult.filledOrder.totalSz) * parseFloat(tradeResult.filledOrder.avgPx)).toString(),
                    maxLeverage: config.trading.leverage.toString()
                };
                
                // Write position file so main bot recognizes it
                await fs.writeFile(POSITION_FILE, JSON.stringify(properPositionObject, null, 2));
                
                // Send success notification
                const successEmbed = new EmbedBuilder()
                    .setTitle("✅ Manual Buy Order Executed Successfully!")
                    .setDescription(`Position opened for **${config.trading.asset}**`)
                    .setColor(0x00FF00)
                    .addFields(
                        { name: "Size Filled", value: `${parseFloat(tradeResult.filledOrder.totalSz).toFixed(4)} ${config.trading.asset}`, inline: true },
                        { name: "Average Price", value: `$${parseFloat(tradeResult.filledOrder.avgPx).toFixed(2)}`, inline: true },
                        { name: "Total Value", value: `$${(parseFloat(tradeResult.filledOrder.totalSz) * parseFloat(tradeResult.filledOrder.avgPx)).toFixed(2)}`, inline: true }
                    )
                    .setFooter({ text: "Position synchronized with main trading bot" })
                    .setTimestamp(new Date());
                    
                await message.channel.send({ embeds: [successEmbed] });
                
                console.log(`[Discord Buy] Manual buy executed by ${message.author.tag} - ${tradeResult.filledOrder.totalSz} ${config.trading.asset} @ $${tradeResult.filledOrder.avgPx}`);
                
            } else {
                // Send failure notification
                const errorEmbed = new EmbedBuilder()
                    .setTitle("❌ Manual Buy Order Failed")
                    .setDescription(`Failed to execute buy order: ${tradeResult.error}`)
                    .setColor(0xFF0000)
                    .setTimestamp(new Date());
                    
                await message.channel.send({ embeds: [errorEmbed] });
            }
            
        } catch (error) {
            console.error(`[Discord Buy] Error executing manual buy: ${error.message}`);
            
            const errorEmbed = new EmbedBuilder()
                .setTitle("❌ Manual Buy Command Error")
                .setDescription(`An unexpected error occurred: ${error.message}`)
                .setColor(0xFF0000)
                .setTimestamp(new Date());
                
            await message.channel.send({ embeds: [errorEmbed] });
        }
    }
});

// --- Run the Bot ---
client.login(BOT_TOKEN);