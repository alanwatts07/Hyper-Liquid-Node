// src/components/Notifier.js
import axios from 'axios';
import logger from '../utils/logger.js'; // <-- Import logger for better error handling

class Notifier {
    constructor(discordConfig) {
        // --- FIX: Expect the config object and get the URL from it ---
        this.webhookUrl = discordConfig.webhookUrl;
        this.botName = discordConfig.botName;
    }

    async send(title, message, type = 'info') {
        // Add a check to prevent crashing if the URL is not set in .env
        if (!this.webhookUrl) {
            logger.warn("Discord webhook URL not set. Skipping notification.");
            return;
        }

        let color;
        switch (type) {
            case 'success': color = 3066993; break; // Green
            case 'error': color = 15158332; break; // Red
            case 'warning': color = 15105570; break; // Yellow
            default: color = 3447003; // Blue
        }

        const embed = {
            title,
            description: message,
            color,
            timestamp: new Date().toISOString(),
        };

        try {
            await axios.post(this.webhookUrl, { 
                username: this.botName,
                embeds: [embed] 
            });
        } catch (error) {
            // Log the actual error without crashing the bot
            logger.error(`Error sending Discord notification: ${error.message}`);
        }
    }
}

export default Notifier;