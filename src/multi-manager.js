// src/multi-manager.js - Multi-token process manager with regime-based control
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import EventEmitter from 'events';
import multiConfig from '../multi.config.js';
import MarketRegimeAI from './components/MarketRegimeAI.js';
import DatabaseManager from './database/DatabaseManager.js';

class MultiTokenManager extends EventEmitter {
    constructor() {
        super();
        this.processes = new Map(); // token -> process info
        this.regimeAIs = new Map(); // token -> MarketRegimeAI instance
        this.databases = new Map(); // token -> DatabaseManager instance
        this.regimeStates = new Map(); // token -> last regime assessment
        this.config = multiConfig;
        
        // Manager state
        this.isShuttingDown = false;
        this.regimeCheckInterval = null;
        this.healthCheckInterval = null;
        
        console.log('[MultiManager] Initializing multi-token manager...');
    }

    async initialize() {
        try {
            // Create data directories for all tokens
            await this.createDataDirectories();
            
            // Initialize regime AIs for enabled tokens
            await this.initializeRegimeAIs();
            
            // Start health monitoring
            this.startHealthMonitoring();
            
            // Start regime-based monitoring if enabled
            if (this.config.regimeRules.enabled) {
                this.startRegimeMonitoring();
            }
            
            console.log('[MultiManager] ✅ Manager initialized successfully');
            return true;
            
        } catch (error) {
            console.error(`[MultiManager] ❌ Initialization failed: ${error.message}`);
            return false;
        }
    }

    async createDataDirectories() {
        const tokens = Object.keys(this.config.tokens);
        
        for (const token of tokens) {
            const tokenConfig = this.config.tokens[token];
            const dataDir = tokenConfig.dataDir;
            
            try {
                await fs.mkdir(dataDir, { recursive: true });
                console.log(`[MultiManager] Created data directory: ${dataDir}`);
            } catch (error) {
                console.error(`[MultiManager] Error creating directory ${dataDir}: ${error.message}`);
            }
        }
    }

    async initializeRegimeAIs() {
        const enabledTokens = Object.entries(this.config.tokens)
            .filter(([token, config]) => config.enabled)
            .map(([token]) => token);

        for (const token of enabledTokens) {
            try {
                // Load token-specific config
                const tokenConfigPath = this.config.tokens[token].configFile;
                const tokenConfig = await import(path.resolve(tokenConfigPath));
                
                // Initialize database for this token
                const db = new DatabaseManager(tokenConfig.default.database.file, tokenConfig.default);
                await db.connect();
                this.databases.set(token, db);
                
                // Initialize regime AI for this token
                const regimeAI = new MarketRegimeAI(tokenConfig.default, db);
                this.regimeAIs.set(token, regimeAI);
                
                console.log(`[MultiManager] ✅ Initialized regime AI for ${token}`);
                
            } catch (error) {
                console.error(`[MultiManager] ❌ Failed to initialize regime AI for ${token}: ${error.message}`);
            }
        }
    }

    async startToken(token) {
        if (this.processes.has(token)) {
            console.log(`[MultiManager] ${token} is already running`);
            return false;
        }

        const tokenConfig = this.config.tokens[token];
        if (!tokenConfig) {
            console.error(`[MultiManager] ❌ No configuration found for token: ${token}`);
            return false;
        }

        if (!tokenConfig.enabled) {
            console.log(`[MultiManager] ${token} is disabled in configuration`);
            return false;
        }

        try {
            console.log(`[MultiManager] 🚀 Starting ${token} bot...`);
            
            const childProcess = spawn('node', ['src/app.js'], {
                env: {
                    ...process.env,
                    TOKEN_SYMBOL: token,
                    TOKEN_CONFIG_PATH: tokenConfig.configFile
                },
                cwd: process.cwd(),
                stdio: ['ignore', 'pipe', 'pipe']
            });

            const processInfo = {
                process: childProcess,
                token,
                startTime: Date.now(),
                restartCount: 0,
                status: 'STARTING'
            };

            // Handle process events
            childProcess.on('error', (error) => {
                console.error(`[MultiManager] ❌ ${token} process error: ${error.message}`);
                this.handleProcessCrash(token, error);
            });

            childProcess.on('exit', (code, signal) => {
                console.log(`[MultiManager] ${token} process exited with code ${code}, signal ${signal}`);
                this.handleProcessExit(token, code, signal);
            });

            // Log output
            childProcess.stdout.on('data', (data) => {
                console.log(`[${token}] ${data.toString().trim()}`);
            });

            childProcess.stderr.on('data', (data) => {
                console.error(`[${token}] ERROR: ${data.toString().trim()}`);
            });

            this.processes.set(token, processInfo);
            processInfo.status = 'RUNNING';
            
            this.emit('tokenStarted', { token, pid: childProcess.pid });
            console.log(`[MultiManager] ✅ ${token} started with PID ${childProcess.pid}`);
            
            return true;

        } catch (error) {
            console.error(`[MultiManager] ❌ Failed to start ${token}: ${error.message}`);
            return false;
        }
    }

    async stopToken(token, reason = 'Manual stop') {
        const processInfo = this.processes.get(token);
        if (!processInfo) {
            console.log(`[MultiManager] ${token} is not running`);
            return true;
        }

        try {
            console.log(`[MultiManager] 🛑 Stopping ${token} (${reason})...`);
            
            processInfo.status = 'STOPPING';
            processInfo.process.kill('SIGTERM');
            
            // Give process time to gracefully shutdown
            const timeout = setTimeout(() => {
                console.log(`[MultiManager] Force killing ${token}...`);
                processInfo.process.kill('SIGKILL');
            }, this.config.processManager.gracefulShutdownTimeout);

            // Wait for process to exit
            await new Promise((resolve) => {
                processInfo.process.on('exit', () => {
                    clearTimeout(timeout);
                    resolve();
                });
            });

            this.processes.delete(token);
            this.emit('tokenStopped', { token, reason });
            console.log(`[MultiManager] ✅ ${token} stopped`);
            
            return true;

        } catch (error) {
            console.error(`[MultiManager] ❌ Error stopping ${token}: ${error.message}`);
            return false;
        }
    }

    async handleProcessCrash(token, error) {
        const processInfo = this.processes.get(token);
        if (!processInfo) return;

        processInfo.restartCount++;
        processInfo.status = 'CRASHED';

        console.error(`[MultiManager] 💥 ${token} crashed (restart count: ${processInfo.restartCount})`);
        
        if (processInfo.restartCount <= this.config.processManager.maxRestarts) {
            console.log(`[MultiManager] 🔄 Scheduling ${token} restart...`);
            
            setTimeout(async () => {
                if (!this.isShuttingDown) {
                    this.processes.delete(token);
                    await this.startToken(token);
                }
            }, this.config.processManager.restartDelay);
        } else {
            console.error(`[MultiManager] ❌ ${token} exceeded max restarts, giving up`);
            this.processes.delete(token);
            this.emit('tokenFailed', { token, error: 'Max restarts exceeded' });
        }
    }

    handleProcessExit(token, code, signal) {
        const processInfo = this.processes.get(token);
        if (processInfo && processInfo.status !== 'STOPPING') {
            this.handleProcessCrash(token, new Error(`Process exited with code ${code}`));
        }
    }

    // Regime-based token management
    async startRegimeMonitoring() {
        console.log('[MultiManager] 🧠 Starting regime-based token monitoring...');
        
        this.regimeCheckInterval = setInterval(async () => {
            if (this.isShuttingDown) return;
            
            try {
                await this.checkAllRegimes();
            } catch (error) {
                console.error(`[MultiManager] Error in regime check: ${error.message}`);
            }
        }, this.config.regimeRules.checkInterval);
    }

    async checkAllRegimes() {
        const enabledTokens = Object.entries(this.config.tokens)
            .filter(([token, config]) => config.enabled)
            .map(([token]) => token);

        for (const token of enabledTokens) {
            await this.checkTokenRegime(token);
        }
    }

    async checkTokenRegime(token) {
        try {
            const regimeAI = this.regimeAIs.get(token);
            if (!regimeAI) return;

            // Read current analysis data for this token
            const tokenConfig = this.config.tokens[token];
            const analysisFile = path.resolve(tokenConfig.dataDir, 'live_analysis.json');
            
            let analysisData;
            try {
                const data = await fs.readFile(analysisFile, 'utf8');
                analysisData = JSON.parse(data);
            } catch (error) {
                console.log(`[MultiManager] No analysis data for ${token}, skipping regime check`);
                return;
            }

            // Get regime assessment (auto mode with token for rate limiting)
            const regimeAssessment = await regimeAI.assessMarketRegime(analysisData, null, 'auto', token);
            this.regimeStates.set(token, regimeAssessment);

            console.log(`[MultiManager] ${token} regime: ${regimeAssessment.regime} (confidence: ${regimeAssessment.confidence}/10)`);

            // Apply regime-based risk parameters
            await this.applyRegimeRiskParameters(token, regimeAssessment);
            
            // Check regime rules
            await this.applyRegimeRules(token, regimeAssessment);

        } catch (error) {
            console.error(`[MultiManager] Error checking ${token} regime: ${error.message}`);
        }
    }

    async applyRegimeRiskParameters(token, regimeAssessment) {
        try {
            const tokenConfig = this.config.tokens[token];
            if (!tokenConfig) return;

            // Get regime-based risk parameters from multi config
            const regimeRiskParams = this.config.regimeRiskMultipliers[regimeAssessment.regime];
            if (!regimeRiskParams) {
                console.log(`[MultiManager] No risk parameters defined for regime: ${regimeAssessment.regime}`);
                return;
            }

            // Construct the live risk file path
            const riskFilePath = path.resolve(tokenConfig.dataDir, 'live_risk.json');
            
            // Read existing live risk data if it exists
            let existingRiskData = {};
            try {
                const data = await fs.readFile(riskFilePath, 'utf8');
                existingRiskData = JSON.parse(data);
            } catch (error) {
                // File doesn't exist yet, that's okay
                console.log(`[MultiManager] ${token}: No existing risk data, creating new`);
            }

            // Create updated risk data with regime-based parameters
            const updatedRiskData = {
                ...existingRiskData,
                timestamp: new Date().toISOString(),
                regime: regimeAssessment.regime,
                regimeConfidence: regimeAssessment.confidence,
                liveStopLossPercentage: regimeRiskParams.stopLoss,
                liveTakeProfitPercentage: regimeRiskParams.takeProfit,
                sizeMultiplier: regimeRiskParams.sizeMultiplier,
                strategy: regimeRiskParams.strategy,
                regimeDescription: regimeRiskParams.description
            };

            // Write updated risk parameters to live_risk.json
            await fs.writeFile(riskFilePath, JSON.stringify(updatedRiskData, null, 2));
            
            console.log(`[MultiManager] ${token}: Applied ${regimeAssessment.regime} risk params - SL: ${(regimeRiskParams.stopLoss * 100).toFixed(1)}%, TP: ${(regimeRiskParams.takeProfit * 100).toFixed(1)}%, Size: ${(regimeRiskParams.sizeMultiplier * 100).toFixed(0)}%`);

        } catch (error) {
            console.error(`[MultiManager] Error applying risk parameters for ${token}: ${error.message}`);
        }
    }

    async applyRegimeRules(token, regimeAssessment) {
        const tokenConfig = this.config.tokens[token];
        const isRunning = this.processes.has(token);

        for (const rule of this.config.regimeRules.rules) {
            if (rule.condition(regimeAssessment)) {
                console.log(`[MultiManager] 🎯 ${token}: Regime rule '${rule.name}' triggered`);

                switch (rule.action) {
                    case 'DISABLE':
                        if (isRunning) {
                            await this.stopToken(token, `Regime rule: ${rule.description}`);
                            this.emit('regimeAction', { token, action: 'DISABLED', rule: rule.name, regime: regimeAssessment.regime });
                        }
                        break;

                    case 'ENABLE':
                        if (!isRunning && tokenConfig.enabled) {
                            await this.startToken(token);
                            this.emit('regimeAction', { token, action: 'ENABLED', rule: rule.name, regime: regimeAssessment.regime });
                        }
                        break;

                    case 'REDUCE_RISK':
                        // Implement risk reduction logic
                        this.emit('regimeAction', { token, action: 'RISK_REDUCED', rule: rule.name, regime: regimeAssessment.regime });
                        break;

                    case 'PANIC_ALL':
                        console.log('[MultiManager] 🚨 EMERGENCY REGIME SHUTDOWN TRIGGERED');
                        await this.emergencyShutdown(`Emergency regime rule: ${rule.description}`);
                        break;
                }
                break; // Only apply first matching rule
            }
        }
    }

    async emergencyShutdown(reason) {
        console.log(`[MultiManager] 🚨 EMERGENCY SHUTDOWN: ${reason}`);
        
        // Stop all running tokens
        const runningTokens = Array.from(this.processes.keys());
        for (const token of runningTokens) {
            await this.stopToken(token, `Emergency shutdown: ${reason}`);
        }

        this.emit('emergencyShutdown', { reason, tokensAffected: runningTokens });
    }

    startHealthMonitoring() {
        this.healthCheckInterval = setInterval(() => {
            this.checkProcessHealth();
        }, this.config.processManager.healthCheckInterval);
    }

    checkProcessHealth() {
        for (const [token, processInfo] of this.processes.entries()) {
            if (processInfo.status === 'RUNNING') {
                // Simple health check - could be enhanced with heartbeat system
                const uptime = Date.now() - processInfo.startTime;
                if (uptime > 60000) { // After 1 minute, consider it healthy
                    processInfo.status = 'HEALTHY';
                }
            }
        }
    }

    async shutdown(graceful = true) {
        if (this.isShuttingDown) return;
        
        console.log('[MultiManager] 🛑 Shutting down multi-token manager...');
        this.isShuttingDown = true;

        // Clear intervals
        if (this.regimeCheckInterval) {
            clearInterval(this.regimeCheckInterval);
        }
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        // Stop all tokens
        const runningTokens = Array.from(this.processes.keys());
        for (const token of runningTokens) {
            await this.stopToken(token, 'Manager shutdown');
        }

        // Close databases
        for (const [token, db] of this.databases.entries()) {
            try {
                await db.close();
            } catch (error) {
                console.error(`[MultiManager] Error closing ${token} database: ${error.message}`);
            }
        }

        console.log('[MultiManager] ✅ Shutdown complete');
    }

    getStatus() {
        const status = {
            manager: {
                isRunning: !this.isShuttingDown,
                regimeMonitoringEnabled: this.config.regimeRules.enabled,
                lastRegimeCheck: Date.now()
            },
            tokens: {}
        };

        for (const [token, tokenConfig] of Object.entries(this.config.tokens)) {
            const processInfo = this.processes.get(token);
            const regimeState = this.regimeStates.get(token);

            status.tokens[token] = {
                enabled: tokenConfig.enabled,
                running: !!processInfo,
                status: processInfo?.status || 'STOPPED',
                pid: processInfo?.process.pid,
                restartCount: processInfo?.restartCount || 0,
                uptime: processInfo ? Date.now() - processInfo.startTime : 0,
                regime: regimeState ? {
                    current: regimeState.regime,
                    confidence: regimeState.confidence,
                    lastCheck: regimeState.timestamp
                } : null
            };
        }

        return status;
    }
}

export default MultiTokenManager;