// multi-launcher.js - Main entry point for multi-token trading system
import MultiTokenManager from './src/multi-manager.js';
import multiConfig from './multi.config.js';
import { spawn } from 'child_process';

console.log('🚀 Starting Multi-Token Trading System...');
console.log('=====================================');

async function startMultiTokenSystem() {
    const manager = new MultiTokenManager();
    
    try {
        // Initialize the manager
        const initialized = await manager.initialize();
        if (!initialized) {
            console.error('❌ Failed to initialize multi-token manager');
            process.exit(1);
        }

        console.log('✅ Multi-token manager initialized successfully');
        
        // Start enabled tokens
        const enabledTokens = Object.entries(multiConfig.tokens)
            .filter(([token, config]) => config.enabled)
            .map(([token]) => token);
            
        console.log(`🎯 Starting enabled tokens: ${enabledTokens.join(', ')}`);
        
        for (const token of enabledTokens) {
            console.log(`🚀 Starting ${token}...`);
            const started = await manager.startToken(token);
            if (started) {
                console.log(`✅ ${token} started successfully`);
            } else {
                console.error(`❌ Failed to start ${token}`);
            }
            
            // Small delay between starts
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        console.log('\n🎉 Multi-token system startup complete!');
        console.log(`📊 Running tokens: ${enabledTokens.length}`);
        console.log(`🧠 Regime monitoring: ${multiConfig.regimeRules.enabled ? 'ENABLED' : 'DISABLED'}`);
        
        // Start Discord bot if configured
        let discordBot = null;
        if (multiConfig.global.discord.enabled && multiConfig.global.discord.bot_token) {
            console.log('🤖 Starting integrated Discord bot...');
            try {
                // We need to pass the manager instance to Discord bot
                // For now, just start it separately - we'll integrate later
                discordBot = spawn('node', ['discord_bot_multi.js'], {
                    stdio: 'inherit'
                });
                console.log('✅ Discord bot started');
            } catch (error) {
                console.log('❌ Failed to start Discord bot:', error.message);
            }
        }
        
        console.log('\nUse Ctrl+C to shutdown gracefully');

        // Keep the process alive
        process.on('SIGINT', async () => {
            console.log('\n🛑 Shutting down multi-token system...');
            await manager.shutdown();
            console.log('✅ Shutdown complete');
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down...');
            await manager.shutdown();
            process.exit(0);
        });

    } catch (error) {
        console.error(`❌ Error starting multi-token system: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

// Start the system
startMultiTokenSystem();