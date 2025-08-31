// MarketRegimeAI.js - AI-powered market regime assessment
import Anthropic from '@anthropic-ai/sdk';

export default class MarketRegimeAI {
    constructor(config, databaseManager) {
        this.config = config;
        this.db = databaseManager;
        this.claudeClient = null;
        
        // Initialize Claude AI if available
        if (process.env.CLAUDE_API_KEY) {
            this.claudeClient = new Anthropic({
                apiKey: process.env.CLAUDE_API_KEY,
            });
        }
        
        // Market regime classifications
        this.regimeTypes = {
            STRONG_UPTREND: {
                color: 0x00FF00,
                emoji: '🚀',
                description: 'Strong bullish momentum, fib levels acting as support',
                tradingBias: 'BULLISH',
                riskMultiplier: 1.2
            },
            WEAK_UPTREND: {
                color: 0x90EE90,
                emoji: '📈',
                description: 'Choppy upward movement, mixed signals',
                tradingBias: 'CAUTIOUSLY_BULLISH',
                riskMultiplier: 1.0
            },
            RANGING: {
                color: 0xFFD700,
                emoji: '↔️',
                description: 'Sideways action, price oscillating between levels',
                tradingBias: 'NEUTRAL',
                riskMultiplier: 0.8
            },
            WEAK_DOWNTREND: {
                color: 0xFFA500,
                emoji: '📉',
                description: 'Declining but with bounces, mixed bearish signals',
                tradingBias: 'CAUTIOUSLY_BEARISH',
                riskMultiplier: 0.6
            },
            STRONG_DOWNTREND: {
                color: 0xFF0000,
                emoji: '💥',
                description: 'Clear bearish momentum, fib levels acting as resistance',
                tradingBias: 'BEARISH',
                riskMultiplier: 0.3
            },
            VOLATILE_UNCERTAIN: {
                color: 0x800080,
                emoji: '⚡',
                description: 'High volatility, unclear direction, whipsaw conditions',
                tradingBias: 'AVOID',
                riskMultiplier: 0.4
            }
        };
    }

    async assessMarketRegime(analysisData, priceHistory = null) {
        if (!this.claudeClient) {
            throw new Error('Claude AI not configured. Set CLAUDE_API_KEY environment variable.');
        }

        try {
            // Get additional market data if not provided
            if (!priceHistory) {
                priceHistory = await this.getRecentPriceHistory();
            }

            // Calculate additional technical indicators
            const marketMetrics = await this.calculateMarketMetrics(analysisData, priceHistory);
            
            // Create comprehensive market analysis prompt
            const regimePrompt = this.buildRegimeAnalysisPrompt(analysisData, marketMetrics, priceHistory);

            // Get AI assessment
            const response = await this.claudeClient.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 300,
                system: this.getSystemPrompt(),
                messages: [{ role: 'user', content: regimePrompt }]
            });

            // Parse and validate response
            const assessment = this.parseRegimeResponse(response.content[0].text);
            
            // Add trading recommendations
            assessment.recommendations = this.generateTradingRecommendations(assessment);
            
            // Store assessment for future analysis
            await this.storeRegimeAssessment(assessment);
            
            return assessment;

        } catch (error) {
            console.error(`[MarketRegimeAI] Error assessing regime: ${error.message}`);
            return this.getFallbackRegime(analysisData);
        }
    }

    getSystemPrompt() {
        return `You are an expert market analyst specializing in cryptocurrency trend analysis. Your task is to classify the current market regime based on technical indicators and price action.

You must respond EXACTLY in this format:
REGIME:[classification]
CONFIDENCE:[1-10]
REASONING:[brief 1-2 sentence explanation]
SIGNALS:[key technical signals observed]
OUTLOOK:[short-term outlook]

Available regime classifications:
- STRONG_UPTREND: Clear bullish momentum, sustained buying pressure
- WEAK_UPTREND: Choppy upward movement, mixed signals
- RANGING: Sideways consolidation, no clear direction
- WEAK_DOWNTREND: Declining with bounces, mixed bearish signals
- STRONG_DOWNTREND: Clear bearish momentum, sustained selling
- VOLATILE_UNCERTAIN: High volatility, whipsaw conditions

Be precise and concise. Focus on actionable insights.`;
    }

    buildRegimeAnalysisPrompt(analysisData, marketMetrics, priceHistory) {
        const recentPrices = priceHistory.slice(-24).map(p => p.close);
        const priceChange24h = ((recentPrices[recentPrices.length - 1] - recentPrices[0]) / recentPrices[0] * 100).toFixed(2);
        
        return `Analyze current market regime for ${this.config.trading.asset}:

CURRENT MARKET STATE:
- Asset: ${this.config.trading.asset}
- Current Price: $${analysisData.latest_price?.toFixed(2)}
- 24h Change: ${priceChange24h}%
- Bull State: ${analysisData.bull_state ? 'BULLISH' : 'BEARISH'}

FIBONACCI ANALYSIS:
- Fib Entry Level: $${analysisData.fib_entry?.toFixed(2)}
- Fib 0 Level (WMA): $${analysisData.wma_fib_0?.toFixed(2)}
- Price vs Fib Entry: ${analysisData.latest_price > analysisData.fib_entry ? 'ABOVE' : 'BELOW'}
- Price vs Fib 0: ${analysisData.latest_price > analysisData.wma_fib_0 ? 'ABOVE' : 'BELOW'}

STOCHASTIC RSI (5MIN):
- K: ${analysisData.stoch_rsi?.k?.toFixed(2)} ${this.getStochLabel(analysisData.stoch_rsi?.k)}
- D: ${analysisData.stoch_rsi?.d?.toFixed(2)} ${this.getStochLabel(analysisData.stoch_rsi?.d)}

STOCHASTIC RSI (4HR):
- K: ${analysisData.stoch_rsi_4hr?.k?.toFixed(2)} ${this.getStochLabel(analysisData.stoch_rsi_4hr?.k)}
- D: ${analysisData.stoch_rsi_4hr?.d?.toFixed(2)} ${this.getStochLabel(analysisData.stoch_rsi_4hr?.d)}

MARKET METRICS:
- Volatility (24h): ${marketMetrics.volatility?.toFixed(2)}%
- Price Range (24h): ${marketMetrics.priceRange?.toFixed(2)}%
- Support/Resistance Respect: ${marketMetrics.levelRespect}
- Recent Breakouts: ${marketMetrics.breakouts}

RECENT PRICE ACTION (last 12 candles):
${recentPrices.slice(-12).map((price, i) => `${i+1}: $${price.toFixed(2)}`).join(', ')}

Based on this comprehensive technical analysis, classify the current market regime and provide actionable insights.`;
    }

    async calculateMarketMetrics(analysisData, priceHistory) {
        const recentPrices = priceHistory.slice(-24).map(p => p.close);
        
        // Calculate volatility (standard deviation of returns)
        const returns = [];
        for (let i = 1; i < recentPrices.length; i++) {
            returns.push((recentPrices[i] - recentPrices[i-1]) / recentPrices[i-1]);
        }
        
        const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
        const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
        const volatility = Math.sqrt(variance) * 100;

        // Calculate price range
        const high24h = Math.max(...recentPrices);
        const low24h = Math.min(...recentPrices);
        const priceRange = ((high24h - low24h) / low24h) * 100;

        // Analyze level respect (simplified)
        const currentPrice = analysisData.latest_price;
        const fibEntry = analysisData.fib_entry;
        const fib0 = analysisData.wma_fib_0;
        
        let levelRespect = 'WEAK';
        if (Math.abs(currentPrice - fibEntry) / fibEntry < 0.01 || 
            Math.abs(currentPrice - fib0) / fib0 < 0.01) {
            levelRespect = 'STRONG';
        }

        // Count recent breakouts
        let breakouts = 0;
        for (let i = 1; i < recentPrices.length; i++) {
            const change = Math.abs(recentPrices[i] - recentPrices[i-1]) / recentPrices[i-1];
            if (change > 0.02) breakouts++; // 2% moves
        }

        return {
            volatility,
            priceRange,
            levelRespect,
            breakouts
        };
    }

    parseRegimeResponse(aiResponse) {
        try {
            const lines = aiResponse.split('\n').filter(line => line.trim());
            const result = {
                regime: 'RANGING', // default
                confidence: 5,
                reasoning: 'Unable to parse AI response',
                signals: 'Mixed',
                outlook: 'Uncertain',
                timestamp: new Date().toISOString()
            };

            lines.forEach(line => {
                if (line.startsWith('REGIME:')) {
                    result.regime = line.split(':')[1].trim();
                } else if (line.startsWith('CONFIDENCE:')) {
                    result.confidence = parseInt(line.split(':')[1].trim()) || 5;
                } else if (line.startsWith('REASONING:')) {
                    result.reasoning = line.split(':')[1].trim();
                } else if (line.startsWith('SIGNALS:')) {
                    result.signals = line.split(':')[1].trim();
                } else if (line.startsWith('OUTLOOK:')) {
                    result.outlook = line.split(':')[1].trim();
                }
            });

            // Validate regime type
            if (!this.regimeTypes[result.regime]) {
                result.regime = 'RANGING';
            }

            return result;

        } catch (error) {
            console.error('[MarketRegimeAI] Error parsing AI response:', error);
            return this.getFallbackRegime();
        }
    }

    generateTradingRecommendations(assessment) {
        const regime = this.regimeTypes[assessment.regime];
        const recommendations = [];

        switch (assessment.regime) {
            case 'STRONG_UPTREND':
                recommendations.push('✅ Favorable for long entries on dips');
                recommendations.push('🎯 Use wider stops, trend is strong');
                recommendations.push('⚡ Consider increasing position size');
                break;
            
            case 'WEAK_UPTREND':
                recommendations.push('⚠️ Cautious long bias, watch for reversal');
                recommendations.push('🎯 Use standard stops, trend is fragile');
                recommendations.push('📊 Wait for clearer signals');
                break;
            
            case 'RANGING':
                recommendations.push('↔️ Range-bound trading opportunity');
                recommendations.push('🎯 Tight stops, quick profits');
                recommendations.push('📊 Trade the range, avoid breakout trades');
                break;
            
            case 'WEAK_DOWNTREND':
                recommendations.push('🛑 Avoid long entries, consider shorts');
                recommendations.push('⚠️ If long, use very tight stops');
                recommendations.push('📊 Wait for trend reversal signals');
                break;
            
            case 'STRONG_DOWNTREND':
                recommendations.push('❌ Avoid all long positions');
                recommendations.push('🛑 Consider short entries on bounces');
                recommendations.push('⚡ High risk environment for longs');
                break;
            
            case 'VOLATILE_UNCERTAIN':
                recommendations.push('⚡ High risk - reduce position size');
                recommendations.push('🛑 Avoid new entries until clarity');
                recommendations.push('📊 Focus on risk management');
                break;
        }

        return recommendations;
    }

    async getRecentPriceHistory(limit = 100) {
        try {
            const prices = await this.db.db.all(
                'SELECT price as close, timestamp FROM prices ORDER BY timestamp DESC LIMIT ?',
                [limit]
            );
            return prices.reverse(); // Return in chronological order
        } catch (error) {
            console.error('[MarketRegimeAI] Error fetching price history:', error);
            return [];
        }
    }

    async storeRegimeAssessment(assessment) {
        try {
            await this.db.logEvent('REGIME_ASSESSMENT', {
                regime: assessment.regime,
                confidence: assessment.confidence,
                reasoning: assessment.reasoning,
                signals: assessment.signals,
                outlook: assessment.outlook
            });
        } catch (error) {
            console.error('[MarketRegimeAI] Error storing assessment:', error);
        }
    }

    getStochLabel(value) {
        if (!value) return '';
        if (value > 80) return '(Overbought)';
        if (value < 20) return '(Oversold)';
        return '';
    }

    getFallbackRegime(analysisData = null) {
        // Simple fallback based on available data
        let regime = 'RANGING';
        let confidence = 3;
        
        if (analysisData) {
            if (analysisData.bull_state && analysisData.stoch_rsi?.k < 80) {
                regime = 'WEAK_UPTREND';
                confidence = 4;
            } else if (!analysisData.bull_state && analysisData.stoch_rsi?.k > 20) {
                regime = 'WEAK_DOWNTREND';
                confidence = 4;
            }
        }

        return {
            regime,
            confidence,
            reasoning: 'Fallback analysis - AI unavailable',
            signals: 'Limited data available',
            outlook: 'Monitor for clearer signals',
            timestamp: new Date().toISOString(),
            recommendations: this.generateTradingRecommendations({ regime })
        };
    }

    getRegimeInfo(regimeType) {
        return this.regimeTypes[regimeType] || this.regimeTypes.RANGING;
    }
}