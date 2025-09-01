// discord_bot_multi.js - Multi-token Discord bot with regime-based control
import 'dotenv/config';
import { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import multiConfig from './multi.config.js';
import MultiTokenManager from './src/multi-manager.js';
import Anthropic from '@anthropic-ai/sdk';

// Configuration
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const OWNER_USER_ID = process.env.DISCORD_OWNER_ID;
const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

if (!BOT_TOKEN || !CHANNEL_ID) {
    console.error("[!!!] CRITICAL: DISCORD_BOT_TOKEN or DISCORD_CHANNEL_ID is not set in .env file.");
    process.exit(1);
}

// Initialize Claude AI
let claudeClient;
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

// Helper function to calculate dynamic stop-loss and take-profit prices with leverage
function calculateDynamicPrices(riskData, leverage = 1) {
    if (!riskData || !riskData.entryPrice) return { stopPrice: null, takeProfitPrice: null, stopType: 'N/A' };

    const entryPrice = riskData.entryPrice;
    let stopPrice = riskData.stopPrice; // Start with static stop
    let takeProfitPrice = null;
    let stopType = 'Fixed';

    // Check for dynamic stop-loss percentage (adjust for leverage)
    if (riskData.liveStopLossPercentage && typeof riskData.liveStopLossPercentage === 'number') {
        const leveragedSLPct = riskData.liveStopLossPercentage / leverage;
        stopPrice = entryPrice * (1 - leveragedSLPct);
        stopType = `Dynamic ${(riskData.liveStopLossPercentage * 100).toFixed(2)}%`;
    }

    // Check for dynamic take-profit percentage (adjust for leverage)
    if (riskData.liveTakeProfitPercentage && typeof riskData.liveTakeProfitPercentage === 'number') {
        const leveragedTPPct = riskData.liveTakeProfitPercentage / leverage;
        takeProfitPrice = entryPrice * (1 + leveragedTPPct);
    }

    // Check if using fibonacci trailing stop
    if (riskData.fibStopActive) {
        stopType = 'Fib Trail';
    }

    return { stopPrice, takeProfitPrice, stopType };
}

// Helper function to get token leverage from config
async function getTokenLeverage(token) {
    try {
        const tokenConfig = multiConfig.tokens[token];
        if (!tokenConfig?.configFile) return 1; // Default to 1x if no config

        const configModule = await import(path.resolve(tokenConfig.configFile));
        return configModule.default?.trading?.leverage || 1;
    } catch (error) {
        console.warn(`[Discord Bot] Could not load leverage for ${token}: ${error.message}`);
        return 1; // Default to 1x leverage on error
    }
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

// Helper function to gather comprehensive multi-token data for AI context
async function gatherMultiTokenContext() {
    const context = {
        tokens: {},
        summary: {
            totalTokens: 0,
            enabledTokens: 0,
            activePositions: 0,
            totalRegimes: 0
        }
    };

    for (const [token, tokenConfig] of Object.entries(multiConfig.tokens)) {
        context.summary.totalTokens++;
        
        const tokenData = {
            enabled: tokenConfig.enabled,
            status: 'UNKNOWN',
            position: null,
            regime: null,
            analysis: null,
            lastActivity: null
        };

        if (tokenConfig.enabled) {
            context.summary.enabledTokens++;

            // Get analysis data
            const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
            if (analysisData) {
                tokenData.analysis = {
                    price: analysisData.latest_price,
                    fibEntry: analysisData.fib_entry,
                    fib0: analysisData.wma_fib_0,
                    bullState: analysisData.bull_state,
                    stochRSI: analysisData.stoch_rsi
                };
            }

            // Get position data
            const riskData = await readTokenAnalysisFile(token, 'live_risk.json');
            if (riskData) {
                context.summary.activePositions++;
                const leverage = await getTokenLeverage(token);
                const dynamicPrices = calculateDynamicPrices(riskData, leverage);
                tokenData.position = {
                    asset: riskData.asset,
                    entryPrice: riskData.entryPrice,
                    currentPrice: riskData.currentPrice,
                    roe: riskData.roe,
                    stopPrice: dynamicPrices.stopPrice,
                    takeProfitPrice: dynamicPrices.takeProfitPrice,
                    stopType: dynamicPrices.stopType,
                    fibStopActive: riskData.fibStopActive
                };
            }

            // Get most recent regime from database
            const monitor = dbNotificationManager?.monitors?.get(token);
            if (monitor) {
                try {
                    const recentRegime = await monitor.db.get(
                        'SELECT details, timestamp FROM events WHERE event_type = ? ORDER BY id DESC LIMIT 1',
                        ['REGIME_ASSESSMENT']
                    );
                    
                    if (recentRegime) {
                        context.summary.totalRegimes++;
                        const regimeData = JSON.parse(recentRegime.details);
                        tokenData.regime = {
                            current: regimeData.regime,
                            confidence: regimeData.confidence,
                            signals: regimeData.signals,
                            reasoning: regimeData.reasoning,
                            recommendations: regimeData.recommendations,
                            lastUpdated: recentRegime.timestamp,
                            ageMinutes: Math.round((Date.now() - new Date(recentRegime.timestamp).getTime()) / (1000 * 60))
                        };
                    }
                } catch (error) {
                    console.error(`[Multi Ask] Error getting regime for ${token}: ${error.message}`);
                }
            }

            // Determine overall status
            if (tokenData.position) {
                tokenData.status = 'IN_POSITION';
            } else if (tokenData.analysis) {
                tokenData.status = 'MONITORING';
            } else {
                tokenData.status = 'STARTING_UP';
            }
        } else {
            tokenData.status = 'DISABLED';
        }

        context.tokens[token] = tokenData;
    }

    return context;
}

// Helper function to format multi-token context for AI
function formatContextForAI(context) {
    let formatted = `MULTI-TOKEN TRADING PORTFOLIO STATUS:\n\n`;
    
    // Summary
    formatted += `📊 PORTFOLIO SUMMARY:\n`;
    formatted += `• Total Tokens: ${context.summary.totalTokens}\n`;
    formatted += `• Enabled Tokens: ${context.summary.enabledTokens}\n`;
    formatted += `• Active Positions: ${context.summary.activePositions}\n`;
    formatted += `• Regime Assessments: ${context.summary.totalRegimes}\n\n`;

    // Individual token details
    formatted += `🎯 INDIVIDUAL TOKEN STATUS:\n\n`;
    
    for (const [token, data] of Object.entries(context.tokens)) {
        formatted += `**${token}** (${data.status}):\n`;
        
        if (!data.enabled) {
            formatted += `   • Status: DISABLED\n\n`;
            continue;
        }

        // Current position
        if (data.position) {
            formatted += `   • POSITION: LONG ${data.position.asset}\n`;
            formatted += `     - Entry: $${data.position.entryPrice?.toFixed(2) || 'N/A'}\n`;
            formatted += `     - Current: $${data.position.currentPrice?.toFixed(2) || 'N/A'}\n`;
            formatted += `     - ROE: ${data.position.roe || '0.00%'}\n`;
            formatted += `     - Stop: ${data.position.stopType} @ $${data.position.stopPrice?.toFixed(2) || 'N/A'}\n`;
            if (data.position.takeProfitPrice) {
                formatted += `     - Target: $${data.position.takeProfitPrice.toFixed(2)}\n`;
            }
        } else {
            formatted += `   • POSITION: None (monitoring for entries)\n`;
        }

        // Market regime
        if (data.regime) {
            formatted += `   • REGIME: ${data.regime.current} (${data.regime.confidence}/10 confidence)\n`;
            formatted += `     - Signals: ${data.regime.signals || 'Mixed'}\n`;
            formatted += `     - Last Update: ${data.regime.ageMinutes}min ago\n`;
            if (data.regime.recommendations?.length > 0) {
                formatted += `     - Recommendations: ${data.regime.recommendations.join('; ')}\n`;
            }
        } else {
            formatted += `   • REGIME: Analysis pending\n`;
        }

        // Technical analysis
        if (data.analysis) {
            formatted += `   • TECHNICAL: Price $${data.analysis.price?.toFixed(3)} | Fib Entry $${data.analysis.fibEntry?.toFixed(3)} | Bull: ${data.analysis.bullState ? 'Yes' : 'No'}\n`;
            if (data.analysis.stochRSI) {
                const k = data.analysis.stochRSI.k;
                const kState = k > 80 ? 'Overbought' : k < 20 ? 'Oversold' : 'Neutral';
                formatted += `     - Stoch RSI: ${k?.toFixed(1)} (${kState})\n`;
            }
        }

        formatted += `\n`;
    }

    return formatted;
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
                // Skip automatic regime notifications - only send when manually requested
                // await this.sendRegimeNotification(token, parsedDetails, timestamp);
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

    multiManager.on('emergencyTradingHalt', ({ reason, tokensAffected }) => {
        sendNotification(`🛑 **EMERGENCY TRADING HALT**\n**Reason:** ${reason}\n**Tokens halted:** ${tokensAffected.join(', ')}\n\n📊 *Data collection continues*`, 0xFF8C00);
    });

    multiManager.on('emergencyStartup', ({ reason, tokensStarted, tokensFailed, summary }) => {
        const color = tokensFailed.length > 0 ? 0xFFFF00 : 0x00FF00; // Yellow if some failed, green if all succeeded
        let message = `🚀 **EMERGENCY STARTUP COMPLETE**\n**Reason:** ${reason}\n**Summary:** ${summary}`;
        
        if (tokensStarted.length > 0) {
            message += `\n**✅ Started:** ${tokensStarted.join(', ')}`;
        }
        if (tokensFailed.length > 0) {
            message += `\n**❌ Failed:** ${tokensFailed.join(', ')}`;
        }
        
        sendNotification(message, color);
    });

    multiManager.on('regimeUpdated', ({ token, regimeAssessment }) => {
        const emoji = getRegimeEmoji(regimeAssessment.regime);
        const color = getTokenColor(token);
        sendNotification(`🧠 **${token} Regime Updated**\n${emoji} **${regimeAssessment.regime}** (${regimeAssessment.confidence}/10)\n\n${regimeAssessment.reasoning || 'Market conditions assessed'}`, color);
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
            await message.channel.send(`🧠 Fetching **${token}** market regime from database...`);

            try {
                const monitor = dbNotificationManager?.monitors?.get(token);
                if (!monitor) {
                    return message.channel.send(`❌ Database monitor not available for ${token}`);
                }

                // Get most recent regime assessment from database
                const recentRegime = await monitor.db.get(
                    'SELECT details, timestamp FROM events WHERE event_type = ? ORDER BY id DESC LIMIT 1',
                    ['REGIME_ASSESSMENT']
                );

                if (!recentRegime) {
                    return message.channel.send(`❌ No regime assessments found for ${token}. Bot may still be starting up.`);
                }

                const regimeData = JSON.parse(recentRegime.details);
                const regimeAI = multiManager.regimeAIs.get(token);
                const regimeInfo = regimeAI ? regimeAI.getRegimeInfo(regimeData.regime) : {
                    emoji: getRegimeEmoji(regimeData.regime),
                    tradingBias: 'Unknown',
                    riskMultiplier: 1.0
                };

                // Calculate age of assessment
                const assessmentAge = Math.round((Date.now() - new Date(recentRegime.timestamp).getTime()) / (1000 * 60));
                const ageText = assessmentAge < 60 ? `${assessmentAge} minutes ago` : `${Math.round(assessmentAge/60)} hours ago`;

                const embed = new EmbedBuilder()
                    .setTitle(`🧠 ${token} Current Regime (From Database)`)
                    .setDescription(`**Current State: ${regimeInfo.emoji} ${regimeData.regime}**`)
                    .setColor(getTokenColor(token))
                    .addFields(
                        {
                            name: "📊 Assessment Details",
                            value: `**Confidence:** ${regimeData.confidence}/10\n**Trading Bias:** ${regimeInfo.tradingBias}\n**Risk Multiplier:** ${regimeInfo.riskMultiplier}x\n**Last Updated:** ${ageText}`,
                            inline: true
                        },
                        {
                            name: "🔍 Key Signals",
                            value: regimeData.signals || 'Mixed signals detected',
                            inline: true
                        },
                        {
                            name: "📈 Market Outlook",
                            value: regimeData.outlook || 'Monitor for changes',
                            inline: false
                        },
                        {
                            name: "🎯 AI Reasoning",
                            value: regimeData.reasoning || 'Technical analysis completed',
                            inline: false
                        }
                    )
                    .setFooter({ 
                        text: `Database Assessment • Updated every 15min • ${new Date(recentRegime.timestamp).toLocaleTimeString()}`,
                        iconURL: "https://cdn.discordapp.com/embed/avatars/2.png"
                    })
                    .setTimestamp(new Date(recentRegime.timestamp));

                // Add trading recommendations if available
                if (regimeData.recommendations && regimeData.recommendations.length > 0) {
                    const recommendationsText = regimeData.recommendations.join('\n');
                    embed.addFields({
                        name: "💡 Trading Recommendations",
                        value: recommendationsText,
                        inline: false
                    });
                }

                await message.channel.send({ embeds: [embed] });

            } catch (error) {
                await message.channel.send(`❌ Error fetching ${token} regime from database: ${error.message}`);
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
                    // Get the most recent regime assessment from database
                    const monitor = dbNotificationManager?.monitors?.get(token);
                    if (monitor && tokenConfig.enabled) {
                        try {
                            // Query for most recent REGIME_ASSESSMENT event
                            const recentRegime = await monitor.db.get(
                                'SELECT details, timestamp FROM events WHERE event_type = ? ORDER BY id DESC LIMIT 1',
                                ['REGIME_ASSESSMENT']
                            );
                            
                            if (recentRegime) {
                                const regimeData = JSON.parse(recentRegime.details);
                                const emoji = getRegimeEmoji(regimeData.regime);
                                const confidence = regimeData.confidence || 0;
                                const confidenceBar = '█'.repeat(Math.floor(confidence / 2)) + '░'.repeat(5 - Math.floor(confidence / 2));
                                
                                // Calculate age of assessment
                                const assessmentAge = Math.round((Date.now() - new Date(recentRegime.timestamp).getTime()) / (1000 * 60));
                                const ageText = assessmentAge < 60 ? `${assessmentAge}m ago` : `${Math.round(assessmentAge/60)}h ago`;
                                
                                regimeDescription += `${emoji} **${token}**: ${regimeData.regime}\n`;
                                regimeDescription += `└ Confidence: ${confidenceBar} ${confidence}/10 (${ageText})\n\n`;
                                activeTokens++;
                            } else {
                                // No regime assessment found, check for analysis data
                                const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
                                if (analysisData) {
                                    regimeDescription += `⏳ **${token}**: Analyzing...\n`;
                                    regimeDescription += `└ Data: Price $${analysisData.latest_price?.toFixed(2)}\n\n`;
                                } else {
                                    regimeDescription += `🔄 **${token}**: Starting up...\n`;
                                    regimeDescription += `└ Status: Building data\n\n`;
                                }
                            }
                        } catch (error) {
                            regimeDescription += `❌ **${token}**: DB Error\n`;
                            regimeDescription += `└ Error: ${error.message}\n\n`;
                        }
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

    if (command === 'emergency-halt' || command === 'emergency-shutdown') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const reason = args.join(' ') || 'Manual emergency trading halt via Discord';
        
        await message.channel.send("🛑 **INITIATING EMERGENCY TRADING HALT**\nStopping all trading operations while maintaining data collection...");
        
        try {
            const haltedTokens = await multiManager.emergencyTradingHalt(reason);
            
            const embed = new EmbedBuilder()
                .setTitle("🛑 Emergency Trading Halt Complete")
                .setDescription("All trading operations have been halted. Data collection continues.")
                .setColor(0xFF8C00)
                .addFields(
                    {
                        name: "Halted Tokens",
                        value: haltedTokens.length > 0 ? haltedTokens.join(', ') : 'None were running',
                        inline: true
                    },
                    {
                        name: "Status",
                        value: "📊 Data collection: **ACTIVE**\n💰 Trading: **DISABLED**",
                        inline: true
                    },
                    {
                        name: "Recovery",
                        value: "Use `!emergency-startup` to restore trading",
                        inline: false
                    }
                )
                .setTimestamp(new Date());
                
            await message.channel.send({ embeds: [embed] });
            
        } catch (error) {
            await message.channel.send(`❌ Error during emergency halt: ${error.message}`);
        }
    }

    if (command === 'emergency-startup' || command === 'emergency-start') {
        if (!isOwner(message.author.id)) {
            return message.channel.send("❌ Access denied. This command is owner-only.");
        }

        const reason = args.join(' ') || 'Manual emergency startup via Discord';
        
        await message.channel.send("🚀 **INITIATING EMERGENCY STARTUP**\nRestarting default trading tokens (AVAX, SOL, DOGE)...");
        
        try {
            const result = await multiManager.emergencyStartup(reason);
            
            const embed = new EmbedBuilder()
                .setTitle("🚀 Emergency Startup Complete")
                .setDescription("Default tokens have been restored to trading mode")
                .setColor(result.failedTokens.length > 0 ? 0xFFFF00 : 0x00FF00)
                .addFields(
                    {
                        name: "✅ Successfully Started",
                        value: result.startedTokens.length > 0 ? result.startedTokens.join(', ') : 'None',
                        inline: true
                    }
                )
                .setTimestamp(new Date());
                
            if (result.failedTokens.length > 0) {
                embed.addFields({
                    name: "❌ Failed to Start",
                    value: result.failedTokens.join(', '),
                    inline: true
                });
            }
            
            embed.addFields({
                name: "Current Status",
                value: `📊 Data collection: **ACTIVE**\n💰 Trading: **RESTORED**\n🎯 Active tokens: **${result.startedTokens.length}/3**`,
                inline: false
            });
                
            await message.channel.send({ embeds: [embed] });
            
        } catch (error) {
            await message.channel.send(`❌ Error during emergency startup: ${error.message}`);
        }
    }

    if (command === 'status') {
        const token = args[0]?.toUpperCase();
        
        if (token) {
            // Single token status
            if (!multiConfig.tokens[token]) {
                return message.channel.send(`❌ Token ${token} not found.`);
            }

            // Helper function to get appropriate decimal places for price formatting
            const getPriceDecimals = (tokenSymbol) => {
                return tokenSymbol === 'DOGE' ? 4 : 2;
            };
            const priceDecimals = getPriceDecimals(token);

            const analysisData = await readTokenAnalysisFile(token, 'live_analysis.json');
            const riskData = await readTokenAnalysisFile(token, 'live_risk.json');
            const status = multiManager.getStatus();
            const tokenStatus = status.tokens[token];

            // Use same logic as !tokens command for accurate status detection
            let isActuallyRunning = false;
            let estimatedUptime = 0;
            
            try {
                // Check if analysis file exists and is recent (same as !tokens command)
                const filePath = path.resolve(multiConfig.tokens[token].dataDir, 'live_analysis.json');
                const stats = await fs.stat(filePath);
                const now = new Date();
                const fileAge = now - stats.mtime;
                
                // Consider running if file was modified within last 10 minutes (same threshold as !tokens)
                if (fileAge < 10 * 60 * 1000) {
                    isActuallyRunning = true;
                    estimatedUptime = fileAge; // Use file age as uptime estimate
                }
                
                console.log(`[Status Debug] ${token}: File age ${Math.round(fileAge/60000)}min, running: ${isActuallyRunning}`);
            } catch (error) {
                console.log(`[Status Debug] ${token}: No analysis file - ${error.message}`);
            }

            const embed = new EmbedBuilder()
                .setTitle(`📊 ${token} Status Report`)
                .setColor(getTokenColor(token))
                .setTimestamp(new Date());

            // Use file-based status detection instead of multi-manager status
            const isRunning = isActuallyRunning;
            const isEnabled = tokenStatus?.enabled !== false; // Default to enabled unless explicitly disabled
            const uptime = estimatedUptime;
            
            embed.addFields({
                name: "🤖 Bot Status",
                value: `**Status:** ${isRunning ? '🟢 Running' : '🔴 Stopped'}\n**Enabled:** ${isEnabled ? 'Yes' : 'No'}\n**Uptime:** ${Math.round(uptime / 60000)}min`,
                inline: true
            });

            // Position info
            if (riskData) {
                const roe = riskData.roe || '0.00%';
                const pnlEmoji = (typeof roe === 'string' && roe.includes('-')) ? "🔴" : "🟢";
                const leverage = await getTokenLeverage(token);
                const dynamicPrices = calculateDynamicPrices(riskData, leverage);
                
                let positionValue = `**Entry:** $${riskData.entryPrice?.toFixed(priceDecimals) || 'N/A'}\n**Current:** $${riskData.currentPrice?.toFixed(priceDecimals) || 'N/A'}\n**ROE:** ${pnlEmoji} ${roe}`;
                
                if (dynamicPrices.stopPrice) {
                    positionValue += `\n**Stop:** ${dynamicPrices.stopType} @ $${dynamicPrices.stopPrice.toFixed(priceDecimals)}`;
                }
                
                if (dynamicPrices.takeProfitPrice) {
                    positionValue += `\n**Target:** $${dynamicPrices.takeProfitPrice.toFixed(priceDecimals)}`;
                }
                
                embed.addFields({
                    name: `💼 Position: ${riskData.asset}`,
                    value: positionValue,
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
                    value: `**Price:** $${analysisData.latest_price?.toFixed(priceDecimals)}\n**Fib Entry:** $${analysisData.fib_entry?.toFixed(priceDecimals)}\n**Fib 0:** $${analysisData.wma_fib_0?.toFixed(priceDecimals)}`,
                    inline: true
                });

                // Trigger status display
                if (analysisData.triggerArmed !== undefined) {
                    const triggerEmoji = analysisData.triggerArmed ? "🎯" : "⏸️";
                    const triggerStatus = analysisData.triggerArmed ? "ARMED" : "WAITING";
                    embed.addFields({
                        name: `${triggerEmoji} Trigger Status`,
                        value: `**Status:** ${triggerStatus}\n**Condition:** ${analysisData.triggerReason || 'No information available'}`,
                        inline: false
                    });
                }
            }

            await message.channel.send({ embeds: [embed] });
        } else {
            // Multi-token status overview
            const status = multiManager.getStatus();
            
            // Debug: Log the multi-token status data
            console.log('[Multi-Status Debug] Full status:', status);
            console.log('[Multi-Status Debug] Tokens:', Object.keys(status.tokens).map(token => ({
                token,
                running: status.tokens[token]?.running,
                enabled: status.tokens[token]?.enabled,
                status: status.tokens[token]?.status
            })));
            
            const embed = new EmbedBuilder()
                .setTitle("📊 Multi-Token Status Overview")
                .setColor(0x00FFFF)
                .setTimestamp(new Date());

            let runningCount = 0;
            let totalPositions = 0;
            let statusText = "";

            for (const [token, tokenStatus] of Object.entries(status.tokens)) {
                // Use file-based detection like !tokens command
                let isActuallyRunning = false;
                
                try {
                    const filePath = path.resolve(multiConfig.tokens[token].dataDir, 'live_analysis.json');
                    const stats = await fs.stat(filePath);
                    const fileAge = Date.now() - stats.mtime;
                    
                    // Same logic as !tokens: running if file modified within 10 minutes
                    if (fileAge < 10 * 60 * 1000) {
                        isActuallyRunning = true;
                    }
                } catch (error) {
                    // No file = not running
                    isActuallyRunning = false;
                }
                
                if (isActuallyRunning) runningCount++;
                
                const statusEmoji = isActuallyRunning ? '🟢' : '🔴';
                const actualStatus = isActuallyRunning ? 'RUNNING' : 'STOPPED';
                statusText += `${statusEmoji} **${token}**: ${actualStatus}\n`;
                
                // Check for positions
                const riskData = await readTokenAnalysisFile(token, 'live_risk.json');
                if (riskData) {
                    totalPositions++;
                    const roe = riskData.roe || '0.00%';
                    statusText += `   └ Position: ${roe}\n`;
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
                    value: `\`!tokens\` - List all tokens and their status\n\`!status [token]\` - Detailed status for token or all\n\`!regime [token]\` - Regime analysis for token or all\n\`!strategies\` - Current trading strategies and risk parameters\n\`!notifications\` - Manage notification system\n\`!ask [question]\` - AI-powered portfolio analysis and consultation`,
                    inline: false
                },
                {
                    name: "🎮 **Control Commands (Owner Only)**",
                    value: `\`!start TOKEN\` - Start trading bot for token\n\`!stop TOKEN\` - Stop trading bot for token\n\`!enable TOKEN\` - Enable token in config\n\`!disable TOKEN\` - Disable and stop token`,
                    inline: false
                },
                {
                    name: "🚨 **Emergency Commands (Owner Only)**",
                    value: `\`!panic [TOKEN|ALL]\` - Emergency stop token or all (kills processes)\n\`!emergency-halt [reason]\` - Stop trading, keep data collection\n\`!emergency-startup [reason]\` - Restart AVAX, SOL, DOGE\n\`!regime-rules\` - View regime-based rules`,
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

            // Get most recent regime assessment from database
            const monitor = dbNotificationManager?.monitors?.get(token);
            let regimeData = null;
            
            if (monitor) {
                try {
                    const recentRegime = await monitor.db.get(
                        'SELECT details, timestamp FROM events WHERE event_type = ? ORDER BY id DESC LIMIT 1',
                        ['REGIME_ASSESSMENT']
                    );
                    
                    if (recentRegime) {
                        regimeData = JSON.parse(recentRegime.details);
                    }
                } catch (error) {
                    console.error(`[Strategies] Error getting regime for ${token}: ${error.message}`);
                }
            }

            if (regimeData) {
                const { regime, confidence } = regimeData;
                const regimeAI = multiManager?.regimeAIs?.get(token);
                const regimeInfo = regimeAI ? regimeAI.getRegimeInfo(regime) : {
                    tradingBias: 'NEUTRAL',
                    riskMultiplier: 1.0
                };
                const emoji = getRegimeEmoji(regime);
                
                // Get regime-specific risk parameters
                const riskParams = multiConfig.regimeRiskMultipliers[regime] || {
                    stopLoss: 0.02,
                    takeProfit: 0.04,
                    sizeMultiplier: 1.0,
                    strategy: 'DEFAULT',
                    description: 'Using default parameters'
                };

                // Load token-specific config to get actual trade size
                let baseSize = 1000; // Fallback default
                try {
                    const tokenConfigPath = multiConfig.tokens[token].configFile;
                    const tokenConfigModule = await import(path.resolve(tokenConfigPath));
                    baseSize = tokenConfigModule.default?.trading?.tradeUsdSize || 1000;
                } catch (error) {
                    console.error(`[Strategies] Error loading config for ${token}: ${error.message}`);
                }
                
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

    // ==========================================================
    // /// <<<--- MULTI-TOKEN ASK COMMAND ---
    // ==========================================================
    if (command === 'ask') {
        if (!claudeClient) {
            return message.channel.send("❌ AI core not configured. Please check CLAUDE_API_KEY in environment.");
        }

        const question = args.join(' ');
        if (!question) {
            return message.channel.send("Please ask a question about the multi-token trading portfolio.");
        }

        await message.channel.sendTyping();
        await message.channel.send("🧠 Analyzing multi-token portfolio and generating AI response...");

        try {
            // Gather comprehensive multi-token context
            console.log('[Multi Ask] Gathering multi-token context...');
            const context = await gatherMultiTokenContext();
            const formattedContext = formatContextForAI(context);
            
            // Get multi-config for AI context
            const configStr = JSON.stringify({
                regimeRules: multiConfig.regimeRules,
                regimeRiskMultipliers: multiConfig.regimeRiskMultipliers,
                tokens: Object.keys(multiConfig.tokens).reduce((acc, token) => {
                    acc[token] = {
                        enabled: multiConfig.tokens[token].enabled,
                        symbol: multiConfig.tokens[token].symbol
                    };
                    return acc;
                }, {})
            }, null, 2);

            // AI system prompt for multi-token bot
            const systemPrompt = `You are a sophisticated multi-token cryptocurrency trading system commander serving your "Master". You oversee multiple trading bots across different tokens (AVAX, SOL, DOGE, LTC, ADA, LINK) with AI-powered regime analysis and dynamic risk management.

Your personality traits:
- Speak like a tactical military commander - precise, authoritative, and strategic
- Use military terminology when appropriate ("operational status", "positions", "strategic assessment")
- Be concise but comprehensive in your analysis
- Address your creator as "Master"
- Focus on portfolio-level insights and cross-token correlations
- Provide actionable intelligence rather than just data dumps

Your capabilities:
- Multi-token portfolio management with regime-based risk adjustment
- Real-time position monitoring across all tokens
- AI-powered market regime analysis for each asset
- Dynamic trade sizing based on market conditions
- Automated token enabling/disabling based on regime rules

Always consider the portfolio as a whole while being able to drill down into specific tokens when asked.`;

            // User prompt with full context
            const userPrompt = `MULTI-TOKEN TRADING SYSTEM STATUS:

${formattedContext}

🎯 SYSTEM CONFIGURATION:
${configStr}

🎖️ OPERATIONAL DIRECTIVES:
- Fibonacci-based entry strategies across all tokens
- AI regime analysis every 15 minutes
- Dynamic risk parameters based on market regimes
- Automatic token management based on regime rules
- Position monitoring with trailing stops

Master's Query: "${question}"

Provide a strategic assessment and recommendations based on the current portfolio state.`;

            // Call Claude AI
            console.log('[Multi Ask] Sending request to Claude AI...');
            const msg = await claudeClient.messages.create({
                model: "claude-3-haiku-20240307",
                max_tokens: 1500,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            });

            const response = msg.content[0].text;
            
            // Split response if too long for Discord
            if (response.length > 2000) {
                const chunks = response.match(/.{1,1900}(\s|$)/g);
                for (let i = 0; i < chunks.length && i < 3; i++) { // Max 3 chunks to avoid spam
                    await message.channel.send(chunks[i].trim());
                    if (i < chunks.length - 1) await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                }
            } else {
                await message.channel.send(response);
            }

            console.log('[Multi Ask] AI response sent successfully');

        } catch (error) {
            console.error(`[Multi Ask] Error: ${error.message}`);
            
            let errorMsg = "❌ Error processing AI request: ";
            if (error.message.includes('rate_limit')) {
                errorMsg += "API rate limit reached. Please wait a moment and try again.";
            } else if (error.message.includes('api_key')) {
                errorMsg += "API key issue. Please check configuration.";
            } else {
                errorMsg += error.message;
            }
            
            await message.channel.send(errorMsg);
        }
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