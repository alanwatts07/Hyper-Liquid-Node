// src/components/Notifier.js
import axios from 'axios';
import logger from '../utils/logger.js'; // <-- Import logger for better error handling

class Notifier {
    constructor(discordConfig) {
        // --- FIX: Expect the config object and get the URL from it ---
        this.webhookUrl = discordConfig.webhookUrl;
        this.botName = discordConfig.botName;
        this.lastMessageId = null; // Track the last message ID for editing
        this.messageTypes = new Map(); // Track message types to decide when to edit vs send new
    }

    async send(title, message, type = 'info', messageCategory = 'general') {
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
            // For position updates and general status messages, try to edit the last message
            if (messageCategory === 'position_update' || messageCategory === 'status') {
                const lastMessageId = this.messageTypes.get(messageCategory);
                if (lastMessageId) {
                    try {
                        // Try to edit the existing message
                        const editUrl = this.webhookUrl.replace('/github.com/webhooks/', '/api/webhooks/') + '/messages/' + lastMessageId;
                        await axios.patch(editUrl, { 
                            username: this.botName,
                            embeds: [embed] 
                        });
                        logger.info(`Updated existing Discord message for category: ${messageCategory}`);
                        return;
                    } catch (editError) {
                        logger.warn(`Failed to edit message, sending new one: ${editError.message}`);
                    }
                }
            }

            // Send new message (either first time or edit failed)
            const response = await axios.post(this.webhookUrl, { 
                username: this.botName,
                embeds: [embed],
                wait: true // This returns the message object with ID
            });

            // Store the message ID for future edits if this is a trackable category
            if (response.data && response.data.id && (messageCategory === 'position_update' || messageCategory === 'status')) {
                this.messageTypes.set(messageCategory, response.data.id);
                logger.info(`Stored message ID ${response.data.id} for category: ${messageCategory}`);
            }

        } catch (error) {
            // Log the actual error without crashing the bot
            logger.error(`Error sending Discord notification: ${error.message}`);
        }
    }
}

export default Notifier;