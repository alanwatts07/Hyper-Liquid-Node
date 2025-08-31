// discord_bot_multi.js - Multi-token Discord bot with regime-based control
import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import multiConfig from './multi.config.js';
import MultiTokenManager from './src/multi-manager.js';

// Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const OWNER_USER_ID = process.env.DISCORD_OWNER_ID;

if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error("[!!!] CRITICAL: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is not set in .env file.");
    process.exit(1);
}

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

// Initialize multi-token manager
let multiManager;
const commandPrefix = "!";

// Helper functions
function isOwner(userId) {
    return OWNER_USER_ID && userId === OWNER_USER_ID;
}

function getTokenColor(token) {
    return multiConfig.tokens[token]?.color || 0x7289DA;
}

function getRegimeEmoji(regime) {
    const emojis = {
        'STRONG_UPTREND': '🚀',
        'WEAK_UPTREND': '📈',
        'RANGING': '↔️',
        'WEAK_DOWNTREND': '📉',
        'STRONG_DOWNTREND': '💥',
        'VOLATILE_UNCERTAIN': '⚡'
    };
    return emojis[regime] || '❓';
}

async function readTokenAnalysisFile(token, filename) {
    try {
        const tokenConfig = multiConfig.tokens[token];
        if (!tokenConfig) return null;
        
        const filePath = path.resolve(tokenConfig.dataDir, filename);
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return null;
    }
}

// Database monitoring and notification system
class DatabaseNotificationManager {
    constructor() {
        this.monitors = new Map(); // token -> database monitor
        this.lastEventIds = new Map(); // token -> last event ID processed
        this.checkInterval = 5000; // Check every 5 seconds
        this.intervalId = null;
    }

    async initialize() {
        console.log('[DB Monitor] Initializing database notification system...');
        
        // Initialize monitors for each token
        for (const [token, tokenConfig] of Object.entries(multiConfig.tokens)) {
            try {
                const dbPath = path.resolve(tokenConfig.dataDir, `${token}_bot.db`);
                
                // Check if database exists
                await fs.access(dbPath);
                
                const db = await open({
                    filename: dbPath,
                    driver: sqlite3.Database
                });

                this.monitors.set(token, { db, config: tokenConfig });
                
                // Get the latest event ID to start from (avoid sending notifications for old events)
                const latestEvent = await db.get('SELECT MAX(id) as maxId FROM events');
                const startId = latestEvent?.maxId || 0;
                this.lastEventIds.set(token, startId);
                
                console.log(`[DB Monitor] ✅ Monitoring ${token} database: ${dbPath} (starting from event ID ${startId})`);
            } catch (error) {
                console.log(`[DB Monitor] ⚠️  Database not found for ${token}: ${error.message}`);
            }
        }

        // Start monitoring
        this.startMonitoring();
    }

    startMonitoring() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }

        this.intervalId = setInterval(async () => {
            await this.checkForNewEvents();
        }, this.checkInterval);

        console.log(`[DB Monitor] 📡 Started monitoring with ${this.checkInterval}ms interval`);
    }

    async checkForNewEvents() {
        for (const [token, monitor] of this.monitors) {
            try {
                const lastId = this.lastEventIds.get(token) || 0;
                
                // Get new events since last check
                const events = await monitor.db.all(
                    'SELECT * FROM events WHERE id > ? ORDER BY id ASC LIMIT 50',
                    [lastId]
                );

                if (events.length === 0) continue;

                console.log(`[DB Monitor] ${token}: Found ${events.length} new events (after ID ${lastId})`);

                // Update last processed ID BEFORE processing to avoid duplicates
                const maxId = Math.max(...events.map(e => e.id));
                this.lastEventIds.set(token, maxId);

                // Process each new event
                for (const event of events) {
                    console.log(`[DB Monitor] ${token}: Processing event ${event.id} - ${event.event_type}`);
                    await this.processEvent(token, event);
                }

            } catch (error) {
                console.error(`[DB Monitor] Error checking ${token} events:`, error.message);
            }
        }
    }

    async processEvent(token, event) {
        const { event_type, timestamp, details } = event;
        let parsedDetails = {};
        
        try {
            parsedDetails = JSON.parse(details);
        } catch (error) {
            // Details might not be JSON, use as string
            parsedDetails = { raw: details };
        }

        // Skip certain noisy events
        if (event_type === 'BOT_TICK_ANALYSIS') return;

        // Process different event types
        switch (event_type) {
            case 'TRADE_EXECUTED':
                await this.sendTradeNotification(token, 'buy', parsedDetails, timestamp);
                break;
            
            case 'TRADE_FAILED':
                await this.sendTradeFailedNotification(token, parsedDetails, timestamp);
                break;

            case 'FIB_STOP_HIT':
            case 'STOP-LOSS HIT':
            case 'TAKE-PROFIT HIT':
                await this.sendExitNotification(token, event_type, parsedDetails, timestamp);
                break;

            case 'FIB_STOP_ACTIVATED':
                await this.sendStopUpdateNotification(token, parsedDetails, timestamp);
                break;

            case 'REGIME_ASSESSMENT':
                await this.sendRegimeNotification(token, parsedDetails, timestamp);
                break;

            case 'TRADE_BLOCKED':
                await this.sendBlockedTradeNotification(token, parsedDetails, timestamp);
                break;

            case 'NEW_POSITION_MONITORING':
                await this.sendPositionStartNotification(token, parsedDetails, timestamp);
                break;

            case 'CLOSE_FAILED':
                await this.sendCloseFailedNotification(token, parsedDetails, timestamp);
                break;

            default:
                // Log other events for debugging
                console.log(`[DB Monitor] ${token}: ${event_type}`, parsedDetails);
        }
    }

    async sendTradeNotification(token, type, details, timestamp) {
        const { asset, size, avg_px } = details;
        const color = getTokenColor(token);
        
        const embed = new EmbedBuilder()
            .setTitle(`🚀 ${token} Trade Executed`)
            .setDescription(`**Type:** ${type.toUpperCase()}\n**Asset:** ${asset}\n**Size:** ${size}\n**Price:** $${avg_px?.toFixed(4) || 'N/A'}`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Trading Bot` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendExitNotification(token, exitType, details, timestamp) {
        const { asset, reason, value } = details;
        const color = getTokenColor(token);
        
        let emoji = '🔴';
        let title = 'Position Closed';
        
        if (exitType === 'TAKE-PROFIT HIT') {
            emoji = '🟢';
            title = 'Take Profit Hit!';
        } else if (exitType === 'FIB_STOP_HIT') {
            emoji = '🟡';
            title = 'Fibonacci Stop Hit';
        }

        const embed = new EmbedBuilder()
            .setTitle(`${emoji} ${token} ${title}`)
            .setDescription(`**Asset:** ${asset}\n**Reason:** ${reason}\n**Value:** ${value}\n**Exit Type:** ${exitType.replace(/_/g, ' ')}`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Trading Bot` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendStopUpdateNotification(token, details, timestamp) {
        const { asset, wma_fib_0_stop_price, entry_price } = details;
        const color = getTokenColor(token);
        
        const embed = new EmbedBuilder()
            .setTitle(`🛡️ ${token} Stop Loss Updated`)
            .setDescription(`**Asset:** ${asset}\n**Entry:** $${entry_price?.toFixed(4)}\n**New Stop:** $${wma_fib_0_stop_price?.toFixed(4)}\n**Type:** Fibonacci Trailing Stop`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Risk Management` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendRegimeNotification(token, details, timestamp) {
        const { regime, confidence, reasoning } = details;
        const color = getTokenColor(token);
        const emoji = getRegimeEmoji(regime);
        
        // Only send regime notifications for significant changes or high confidence assessments
        if (confidence < 7) return;
        
        const embed = new EmbedBuilder()
            .setTitle(`🧠 ${token} Regime Change`)
            .setDescription(`${emoji} **${regime}**\n**Confidence:** ${confidence}/10\n\n${reasoning || 'Market regime assessment updated'}`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Market Analysis` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendBlockedTradeNotification(token, details, timestamp) {
        const { reason, k, d, bull_state } = details;
        const color = 0xFFA500; // Orange for blocked trades
        
        let reasonText = reason.replace(/_/g, ' ').toUpperCase();
        let detailText = '';
        
        if (k !== undefined && d !== undefined) {
            detailText = `\n**Stoch K:** ${k?.toFixed(2)}\n**Stoch D:** ${d?.toFixed(2)}`;
        }
        if (bull_state !== undefined) {
            detailText += `\n**Bull State:** ${bull_state ? 'Yes' : 'No'}`;
        }

        const embed = new EmbedBuilder()
            .setTitle(`🚫 ${token} Trade Blocked`)
            .setDescription(`**Reason:** ${reasonText}${detailText}\n\n*Trade entry conditions not met*`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Risk Management` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendPositionStartNotification(token, details, timestamp) {
        const { asset, entry_price } = details;
        const color = getTokenColor(token);
        
        const embed = new EmbedBuilder()
            .setTitle(`👁️ ${token} Position Monitoring Started`)
            .setDescription(`**Asset:** ${asset}\n**Entry Price:** $${entry_price?.toFixed(4)}\n\n*Risk management system activated*`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Risk Management` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendTradeFailedNotification(token, details, timestamp) {
        const { error } = details;
        const color = 0xFF0000; // Red for failures
        
        const embed = new EmbedBuilder()
            .setTitle(`❌ ${token} Trade Failed`)
            .setDescription(`**Error:** ${error}\n\n*Trade execution unsuccessful*`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Trading Bot` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async sendCloseFailedNotification(token, details, timestamp) {
        const { asset, error } = details;
        const color = 0xFF0000; // Red for failures
        
        const embed = new EmbedBuilder()
            .setTitle(`❌ ${token} Position Close Failed`)
            .setDescription(`**Asset:** ${asset}\n**Error:** ${error}\n\n*Manual intervention may be required*`)
            .setColor(color)
            .setTimestamp(new Date(timestamp))
            .setFooter({ text: `${token} Trading Bot` });

        await sendDiscordNotification({ embeds: [embed] });
    }

    async shutdown() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
        }
        
        // Close all database connections
        for (const [token, monitor] of this.monitors) {
            try {
                await monitor.db.close();
            } catch (error) {
                console.error(`[DB Monitor] Error closing ${token} database:`, error.message);
            }
        }
        
        console.log('[DB Monitor] Shutdown complete');
    }
}

// Global notification manager
let dbNotificationManager;

// Bot events
client.on('ready', async () => {
    console.log(`--- Multi-Token Discord Bot Connected ---`);
    console.log(`[*] Logged in as: ${client.user.tag}`);
    
    // Initialize multi-token manager
    multiManager = new MultiTokenManager();
    const initialized = await multiManager.initialize();
    
    if (!initialized) {
        console.error('[!!!] Failed to initialize multi-token manager');
        return;
    }

    // Set up event listeners for manager (these are for process management events, not trading events)
    multiManager.on('tokenStarted', ({ token, pid }) => {
        sendNotification(`🚀 **${token}** bot started (PID: ${pid})`, getTokenColor(token));
    });

    multiManager.on('tokenStopped', ({ token, reason }) => {
        sendNotification(`🛑 **${token}** bot stopped\n**Reason:** ${reason}`, getTokenColor(token));
    });

    multiManager.on('tokenFailed', ({ token, error }) => {
        sendNotification(`❌ **${token}** bot failed\n**Error:** ${error}`, 0xFF0000);
    });

    multiManager.on('regimeAction', ({ token, action, rule, regime }) => {
        const emoji = getRegimeEmoji(regime);
        sendNotification(`🧠 **Regime Action for ${token}**\n${emoji} **${action}** due to ${regime}\n**Rule:** ${rule}`, getTokenColor(token));
    });

    multiManager.on('emergencyShutdown', ({ reason, tokensAffected }) => {
        sendNotification(`🚨 **EMERGENCY SHUTDOWN**\n**Reason:** ${reason}\n**Tokens affected:** ${tokensAffected.join(', ')}`, 0xFF0000);
    });

    console.log('[*] Multi-token manager initialized and ready');

    // Initialize database notification system
    dbNotificationManager = new DatabaseNotificationManager();
    await dbNotificationManager.initialize();
    
    // Send startup notification
    await sendNotification('🤖 **Multi-Token Bot Online**\nDatabase monitoring and unified notifications activated', 0x00FF00);
});

async function sendNotification(message, color = 0x7289DA) {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;

    const embed = new EmbedBuilder()
        .setDescription(message)
        .setColor(color)
        .setTimestamp(new Date());

    await channel.send({ embeds: [embed] });
}

// Enhanced notification function for database events
async function sendDiscordNotification(content) {
    const channel = client.channels.cache.get(CHANNEL_ID);
    if (!channel) return;

    await channel.send(content);
}

client.on('messageCreate', async (message) => {
    console.log(`[Discord] Message received: "${message.content}" in channel ${message.channel.id} from ${message.author.tag}`);
    console.log(`[Discord] Expected channel: ${CHANNEL_ID}`);
    console.log(`[Discord] Is bot: ${message.author.bot}, Starts with prefix: ${message.content.startsWith(commandPrefix)}, Correct channel: ${message.channel.id === CHANNEL_ID}`);
    
    if (message.author.bot || !message.content.startsWith(commandPrefix) || message.channel.id !== CHANNEL_ID) return;

    const args = message.content.slice(commandPrefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // === MULTI-TOKEN COMMANDS ===

    if (command === 'tokens') {
        const embed = new EmbedBuilder()
            .setTitle("🎯 Multi-Token Trading Status")
            .setColor(0x00FFFF)
            .setTimestamp(new Date());

        let description = "";
        
        // Check actual running processes and analysis files
        for (const [token, tokenConfig] of Object.entries(multiConfig.tokens)) {
            let isRunning = false;
            let hasData = false;
            
            try {
                // Check if analysis file exists (indicates bot is running)
                const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
                if (analysisData) {
                    hasData = true;
                }
                
                // Check file modification time to see if bot is active
                const filePath = path.resolve(tokenConfig.dataDir, 'live_analysis.json');
                const stats = await fs.stat(filePath);
                const now = new Date();
                const fileAge = now - stats.mtime;
                
                // Consider running if file was modified within last 10 minutes
                if (fileAge < 10 * 60 * 1000) {
                    isRunning = true;
                }
            } catch (error) {
                // File doesn't exist or can't be read
            }
            
            const statusEmoji = isRunning ? '🟢' : (tokenConfig.enabled ? '🟡' : '⚪');
            const statusText = isRunning ? 'RUNNING' : (tokenConfig.enabled ? 'STOPPED' : 'DISABLED');
            
            description += `${statusEmoji} **${token}** - ${statusText}\n`;
            
            if (hasData) {
                description += `   └ Data: Available\n`;
            } else {
                description += `   └ Data: ${tokenConfig.enabled ? 'Building...' : 'No data'}\n`;
            }
        }

        embed.setDescription(description);
        embed.addFields({
            name: "Legend", 
            value: "🟢 Running | 🟡 Enabled but stopped | ⚪ Disabled",
            inline: false
        });

        await message.channel.send({ embeds: [embed] });
    }

    if (command === 'start') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const token = args[0]?.toUpperCase();
        if (!token) {
            return message.channel.send("❌ Please specify a token. Usage: `!start TOKEN`");
        }

        if (!multiConfig.tokens[token]) {
            return message.channel.send(`❌ Token ${token} not found. Available: ${Object.keys(multiConfig.tokens).join(', ')}`);
        }

        const started = await multiManager.startToken(token);
        if (started) {
            await message.channel.send(`✅ Starting **${token}** bot...`);
        } else {
            await message.channel.send(`❌ Failed to start **${token}** bot`);
        }
    }

    if (command === 'stop') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const token = args[0]?.toUpperCase();
        if (!token) {
            return message.channel.send("❌ Please specify a token. Usage: `!stop TOKEN`");
        }

        const stopped = await multiManager.stopToken(token, 'Manual stop via Discord');
        if (stopped) {
            await message.channel.send(`✅ **${token}** bot stopped`);
        } else {
            await message.channel.send(`❌ **${token}** bot was not running`);
        }
    }

    if (command === 'regime') {
        const token = args[0]?.toUpperCase();
        
        if (token) {
            // Single token regime check
            if (!multiConfig.tokens[token]) {
                return message.channel.send(`❌ Token ${token} not found. Available: ${Object.keys(multiConfig.tokens).join(', ')}`);
            }

            await message.channel.sendTyping();
            await message.channel.send(`🧠 Analyzing **${token}** market regime...`);

            try {
                const regimeAI = multiManager.regimeAIs.get(token);
                if (!regimeAI) {
                    return message.channel.send(`❌ Regime AI not initialized for ${token}`);
                }

                const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
                if (!analysisData) {
                    return message.channel.send(`❌ No analysis data available for ${token}`);
                }

                const regimeAssessment = await regimeAI.assessMarketRegime(analysisData, null, 'manual', token);
                const regimeInfo = regimeAI.getRegimeInfo(regimeAssessment.regime);

                const embed = new EmbedBuilder()
                    .setTitle(`🧠 ${token} Regime Analysis`)
                    .setDescription(`**Current State: ${regimeInfo.emoji} ${regimeAssessment.regime}**`)
                    .setColor(getTokenColor(token))
                    .addFields(
                        {
                            name: "📊 Assessment",
                            value: `**Confidence:** ${regimeAssessment.confidence}/10\n**Trading Bias:** ${regimeInfo.tradingBias}\n**Risk Multiplier:** ${regimeInfo.riskMultiplier}x`,
                            inline: true
                        },
                        {
                            name: "🎯 AI Reasoning",
                            value: regimeAssessment.reasoning || 'Analysis complete',
                            inline: false
                        }
                    )
                    .setTimestamp(new Date());

                if (regimeAssessment.recommendations?.length > 0) {
                    embed.addFields({
                        name: "💡 Recommendations",
                        value: regimeAssessment.recommendations.join('\n'),
                        inline: false
                    });
                }

                await message.channel.send({ embeds: [embed] });

            } catch (error) {
                await message.channel.send(`❌ Error analyzing ${token} regime: ${error.message}`);
            }
        } else {
            // All tokens regime overview
            await message.channel.sendTyping();
            
            const status = multiManager.getStatus();
            
            const embed = new EmbedBuilder()
                .setTitle("🧠 Multi-Token Regime Overview")
                .setColor(0x9370DB)
                .setTimestamp(new Date());

            let regimeDescription = "";
            let activeTokens = 0;
            let totalTokens = 0;
            
            // Show all configured tokens, prioritizing active ones
            for (const [token, tokenConfig] of Object.entries(multiConfig.tokens)) {
                totalTokens++;
                const tokenStatus = status.tokens[token];
                
                if (tokenStatus && tokenStatus.regime) {
                    activeTokens++;
                    const emoji = getRegimeEmoji(tokenStatus.regime.current);
                    const confidence = tokenStatus.regime.confidence;
                    const confidenceBar = '█'.repeat(Math.floor(confidence / 2)) + '░'.repeat(5 - Math.floor(confidence / 2));
                    
                    regimeDescription += `${emoji} **${token}**: ${tokenStatus.regime.current}\n`;
                    regimeDescription += `└ Confidence: ${confidenceBar} ${confidence}/10\n\n`;
                } else {
                    // Check if we can get analysis data directly
                    const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
                    if (analysisData && tokenConfig.enabled) {
                        regimeDescription += `⏳ **${token}**: Analyzing...\n`;
                        regimeDescription += `└ Data: Price $${analysisData.latest_price?.toFixed(2)}\n\n`;
                    } else if (tokenConfig.enabled) {
                        regimeDescription += `🔄 **${token}**: Starting up...\n`;
                        regimeDescription += `└ Status: Building data\n\n`;
                    } else {
                        regimeDescription += `⚪ **${token}**: Disabled\n\n`;
                    }
                }
            }

            if (regimeDescription === "") {
                regimeDescription = "No token data available yet. Make sure bots are running with `!tokens`.";
            }

            embed.setDescription(regimeDescription);
            embed.addFields({
                name: "📊 Summary",
                value: `**Active Regimes:** ${activeTokens}/${totalTokens}\n**Available Tokens:** ${Object.keys(multiConfig.tokens).join(', ')}`,
                inline: false
            });

            await message.channel.send({ embeds: [embed] });
        }
    }

    if (command === 'regime-rules') {
        const embed = new EmbedBuilder()
            .setTitle("🧠 Regime-Based Trading Rules")
            .setColor(0x8A2BE2)
            .setDescription(`**Auto Regime Control:** ${multiConfig.regimeRules.enabled ? '🟢 ENABLED' : '🔴 DISABLED'}`)
            .setTimestamp(new Date());

        let rulesText = "";
        multiConfig.regimeRules.rules.forEach((rule, index) => {
            rulesText += `**${index + 1}. ${rule.name}**\n`;
            rulesText += `Action: ${rule.action}\n`;
            rulesText += `${rule.description}\n\n`;
        });

        embed.addFields({
            name: "Active Rules",
            value: rulesText,
            inline: false
        });

        embed.addFields({
            name: "Rule Check Interval",
            value: `${multiConfig.regimeRules.checkInterval / 60000} minutes`,
            inline: true
        });

        await message.channel.send({ embeds: [embed] });
    }

    if (command === 'enable') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const token = args[0]?.toUpperCase();
        if (!token || !multiConfig.tokens[token]) {
            return message.channel.send(`❌ Invalid token. Available: ${Object.keys(multiConfig.tokens).join(', ')}`);
        }

        multiConfig.tokens[token].enabled = true;
        await message.channel.send(`✅ **${token}** enabled. Use \`!start ${token}\` to begin trading.`);
    }

    if (command === 'disable') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const token = args[0]?.toUpperCase();
        if (!token || !multiConfig.tokens[token]) {
            return message.channel.send(`❌ Invalid token. Available: ${Object.keys(multiConfig.tokens).join(', ')}`);
        }

        multiConfig.tokens[token].enabled = false;
        await multiManager.stopToken(token, 'Disabled via Discord');
        await message.channel.send(`❌ **${token}** disabled and stopped.`);
    }

    if (command === 'panic') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const token = args[0]?.toUpperCase();
        
        if (token && token !== 'ALL') {
            // Single token panic
            if (!multiConfig.tokens[token]) {
                return message.channel.send(`❌ Token ${token} not found.`);
            }

            await multiManager.stopToken(token, 'PANIC STOP via Discord');
            await message.channel.send(`🚨 **${token}** PANIC STOP executed!`);
        } else {
            // Panic all tokens
            await message.channel.send("🚨 **EMERGENCY PANIC - STOPPING ALL TOKENS**");
            await multiManager.emergencyShutdown('Manual panic via Discord');
        }
    }

    if (command === 'status') {
        const token = args[0]?.toUpperCase();
        
        if (token) {
            // Single token status
            if (!multiConfig.tokens[token]) {
                return message.channel.send(`❌ Token ${token} not found.`);
            }

            const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
            const riskData = await readTokenAnalysisFile(token, 'live_risk.json');
            const status = multiManager.getStatus();
            const tokenStatus = status.tokens[token];

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${token} Status Report`)
                .setColor(getTokenColor(token))
                .setTimestamp(new Date());

            // Bot status
            embed.addFields({
                name: "🤖 Bot Status",
                value: `**Status:** ${tokenStatus.running ? '🟢 Running' : '🔴 Stopped'}\n**Enabled:** ${tokenStatus.enabled ? 'Yes' : 'No'}\n**Uptime:** ${Math.round(tokenStatus.uptime / 60000)}min`,
                inline: true
            });

            // Position info
            if (riskData) {
                const pnlEmoji = riskData.roe.includes('-') ? "🔴" : "🟢";
                embed.addFields({
                    name: `💼 Position: ${riskData.asset}`,
                    value: `**Entry:** $${riskData.entryPrice.toFixed(2)}\n**Current:** $${riskData.currentPrice.toFixed(2)}\n**ROE:** ${pnlEmoji} ${riskData.roe}`,
                    inline: true
                });
            } else {
                embed.addFields({
                    name: "💼 Position",
                    value: "No open positions",
                    inline: true
                });
            }

            // Technical data
            if (analysisData) {
                embed.addFields({
                    name: "📈 Technical Data",
                    value: `**Price:** $${analysisData.latest_price?.toFixed(2)}\n**Fib Entry:** $${analysisData.fib_entry?.toFixed(2)}\n**Fib 0:** $${analysisData.wma_fib_0?.toFixed(2)}`,
                    inline: true
                });
            }

            await message.channel.send({ embeds: [embed] });
        } else {
            // Multi-token status overview
            const status = multiManager.getStatus();
            
            const embed = new EmbedBuilder()
                .setTitle("📊 Multi-Token Status Overview")
                .setColor(0x00FFFF)
                .setTimestamp(new Date());

            let runningCount = 0;
            let totalPositions = 0;
            let statusText = "";

            for (const [token, tokenStatus] of Object.entries(status.tokens)) {
                if (tokenStatus.running) runningCount++;
                
                const statusEmoji = tokenStatus.running ? '🟢' : '🔴';
                statusText += `${statusEmoji} **${token}**: ${tokenStatus.status}\n`;
                
                // Check for positions
                const riskData = await readTokenAnalysisFile(token, 'live_risk.json');
                if (riskData) {
                    totalPositions++;
                    statusText += `   └ Position: ${riskData.roe}\n`;
                }
            }

            embed.setDescription(statusText);
            embed.addFields(
                {
                    name: "Summary",
                    value: `**Running Bots:** ${runningCount}/${Object.keys(status.tokens).length}\n**Open Positions:** ${totalPositions}`,
                    inline: true
                },
                {
                    name: "Regime Monitoring",
                    value: status.manager.regimeMonitoringEnabled ? '🟢 Active' : '🔴 Disabled',
                    inline: true
                }
            );

            await message.channel.send({ embeds: [embed] });
        }
    }

    if (command === 'info') {
        const embed = new EmbedBuilder()
            .setTitle("🎯 Multi-Token Trading Bot - Command Reference")
            .setDescription("Commands for managing multiple trading bots with regime-based control")
            .setColor(0x7289DA)
            .addFields(
                {
                    name: "📊 **Monitoring Commands**",
                    value: `\`!tokens\` - List all tokens and their status\n\`!status [token]\` - Detailed status for token or all\n\`!regime [token]\` - Regime analysis for token or all\n\`!strategies\` - Current trading strategies and risk parameters\n\`!notifications\` - Manage notification system`,
                    inline: false
                },
                {
                    name: "🎮 **Control Commands (Owner Only)**",
                    value: `\`!start TOKEN\` - Start trading bot for token\n\`!stop TOKEN\` - Stop trading bot for token\n\`!enable TOKEN\` - Enable token in config\n\`!disable TOKEN\` - Disable and stop token`,
                    inline: false
                },
                {
                    name: "🚨 **Emergency Commands (Owner Only)**",
                    value: `\`!panic [TOKEN|ALL]\` - Emergency stop token or all\n\`!regime-rules\` - View regime-based rules`,
                    inline: false
                },
                {
                    name: "🎯 **Available Tokens**",
                    value: Object.keys(multiConfig.tokens).join(', '),
                    inline: false
                }
            )
            .setFooter({ 
                text: "Multi-Token Regime-Controlled Trading System",
                iconURL: "https://cdn.discordapp.com/embed/avatars/3.png"
            })
            .setTimestamp(new Date());

        await message.channel.send({ embeds: [embed] });
    }

    if (command === 'notifications') {
        const subcommand = args[0]?.toLowerCase();
        
        if (subcommand === 'status') {
            // Show notification system status
            const embed = new EmbedBuilder()
                .setTitle("📢 Notification System Status")
                .setColor(0x00FFFF)
                .setTimestamp(new Date());

            if (!dbNotificationManager) {
                embed.setDescription("❌ Notification system not initialized");
                return message.channel.send({ embeds: [embed] });
            }

            let statusText = `**Monitoring:** ${dbNotificationManager.monitors.size} token databases\n`;
            statusText += `**Check Interval:** ${dbNotificationManager.checkInterval / 1000}s\n\n`;
            
            statusText += "**Monitored Tokens:**\n";
            for (const [token] of dbNotificationManager.monitors) {
                const lastId = dbNotificationManager.lastEventIds.get(token) || 0;
                statusText += `• ${token}: Last event ID ${lastId}\n`;
            }

            embed.setDescription(statusText);
            await message.channel.send({ embeds: [embed] });
            
        } else if (subcommand === 'test' && isOwner(message.author.id)) {
            // Send a test notification
            await sendDiscordNotification({
                embeds: [new EmbedBuilder()
                    .setTitle("🧪 Test Notification")
                    .setDescription("This is a test of the integrated notification system")
                    .setColor(0xFF00FF)
                    .setTimestamp(new Date())
                    .setFooter({ text: "Multi-Token Test System" })]
            });
            
        } else {
            const embed = new EmbedBuilder()
                .setTitle("📢 Notification Commands")
                .setDescription("Manage the integrated notification system")
                .setColor(0x00FFFF)
                .addFields(
                    {
                        name: "Commands",
                        value: "`!notifications status` - Show system status\n`!notifications test` - Send test notification (owner only)",
                        inline: false
                    },
                    {
                        name: "Notification Types",
                        value: "• 🚀 Trade executions\n• 🟢 Take profit hits\n• 🔴 Stop losses\n• 🛡️ Stop updates\n• 🧠 Regime changes\n• 🚫 Blocked trades\n• ❌ Failures & errors",
                        inline: false
                    }
                )
                .setTimestamp(new Date());

            await message.channel.send({ embeds: [embed] });
        }
    }

    if (command === 'strategies' || command === 'strategy') {
        await message.channel.sendTyping();
        
        const embed = new EmbedBuilder()
            .setTitle("🎯 Current Trading Strategies")
            .setDescription("Live regime-based trading strategies with dynamic risk parameters")
            .setColor(0x00FFFF)
            .setTimestamp(new Date());

        let strategiesText = "";
        let activeCount = 0;
        let insufficientDataCount = 0;
        let disabledCount = 0;

        for (const [token, tokenConfig] of Object.entries(multiConfig.tokens)) {
            if (!tokenConfig.enabled) {
                strategiesText += `⚪ **${token}**: DISABLED\n`;
                strategiesText += `   └ Status: Not trading (manually disabled)\n\n`;
                disabledCount++;
                continue;
            }

            // Check if we have analysis data
            const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
            if (!analysisData) {
                strategiesText += `🔄 **${token}**: STARTING UP\n`;
                strategiesText += `   └ Status: Building data (need 4+ hours)\n\n`;
                insufficientDataCount++;
                continue;
            }

            // Check if regime AI is available and get regime state
            const regimeAI = multiManager?.regimeAIs?.get(token);
            const status = multiManager?.getStatus();
            const tokenStatus = status?.tokens?.[token];

            if (regimeAI && tokenStatus?.regime) {
                const { regime, confidence } = tokenStatus.regime;
                const regimeInfo = regimeAI.getRegimeInfo(regime);
                const emoji = getRegimeEmoji(regime);
                
                // Get regime-specific risk parameters
                const riskParams = multiConfig.regimeRiskMultipliers[regime] || {
                    stopLoss: tokenConfig.risk?.stopLossPercentage || 0.02,
                    takeProfit: tokenConfig.risk?.takeProfitPercentage || 0.04,
                    sizeMultiplier: 1.0,
                    strategy: 'DEFAULT',
                    description: 'Using default parameters'
                };

                // Calculate adjusted trade size
                const baseSize = tokenConfig.trading?.tradeUsdSize || 1000;
                const adjustedSize = Math.round(baseSize * riskParams.sizeMultiplier);
                
                // Determine if trading is effectively disabled
                const effectivelyDisabled = riskParams.sizeMultiplier === 0 || regime === 'STRONG_DOWNTREND';
                
                if (effectivelyDisabled) {
                    strategiesText += `${emoji} **${token}**: ${regime}\n`;
                    strategiesText += `   └ Confidence: ${confidence}/10 | Strategy: ${riskParams.strategy}\n`;
                    strategiesText += `   └ Status: DISABLED - ${riskParams.description}\n`;
                    strategiesText += `   └ Price: $${analysisData.latest_price?.toFixed(3)}\n\n`;
                    disabledCount++;
                } else {
                    strategiesText += `${emoji} **${token}**: ${regime}\n`;
                    strategiesText += `   └ Confidence: ${confidence}/10 | Strategy: ${riskParams.strategy}\n`;
                    strategiesText += `   └ Size: $${adjustedSize} (${Math.round(riskParams.sizeMultiplier*100)}%) | SL: ${(riskParams.stopLoss*100).toFixed(0)}% | TP: ${(riskParams.takeProfit*100).toFixed(0)}%\n`;
                    strategiesText += `   └ Fib Trailing: ✅ Active | Price: $${analysisData.latest_price?.toFixed(3)}\n`;
                    strategiesText += `   └ Bias: ${regimeInfo.tradingBias} | ${riskParams.description}\n\n`;
                    activeCount++;
                }
            } else {
                // Has data but no regime assessment yet
                strategiesText += `⏳ **${token}**: ANALYZING\n`;
                strategiesText += `   └ Price: $${analysisData.latest_price?.toFixed(3)} | Awaiting regime analysis\n`;
                strategiesText += `   └ Fib Trailing: ✅ Active | Bull State: ${analysisData.bull_state ? 'Yes' : 'No'}\n\n`;
                insufficientDataCount++;
            }
        }

        if (strategiesText === "") {
            strategiesText = "No tokens configured.";
        }

        embed.setDescription(strategiesText);
        embed.addFields(
            {
                name: "📊 Summary",
                value: `**Active Strategies:** ${activeCount}\n**Regime-Disabled:** ${disabledCount}\n**Insufficient Data:** ${insufficientDataCount}\n**Total Tokens:** ${Object.keys(multiConfig.tokens).length}`,
                inline: true
            },
            {
                name: "⚙️ Risk Management",
                value: `**Regime Rules:** ${multiConfig.regimeRules.enabled ? '🟢 Active' : '🔴 Disabled'}\n**Dynamic Parameters:** ✅ Enabled\n**Fib Trailing:** Always Active`,
                inline: true
            },
            {
                name: "🎯 Strategy Types",
                value: `🚀 AGGRESSIVE_TREND (25% SL, 400% TP)\n⚡ VOLATILITY_SCALPING (40% SL, 65% TP)\n📊 RANGE_SCALPING (35% SL, 80% TP)\n📉 MINIMAL_COUNTER (40% SL, 25% TP)`,
                inline: false
            }
        );

        await message.channel.send({ embeds: [embed] });
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n[*] Received SIGINT, shutting down gracefully...');
    if (multiManager) {
        await multiManager.shutdown();
    }
    if (dbNotificationManager) {
        await dbNotificationManager.shutdown();
    }
    await client.destroy();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\n[*] Received SIGTERM, shutting down gracefully...');
    if (multiManager) {
        await multiManager.shutdown();
    }
    if (dbNotificationManager) {
        await dbNotificationManager.shutdown();
    }
    await client.destroy();
    process.exit(0);
});

// Start the bot
client.login(BOT_TOKEN);