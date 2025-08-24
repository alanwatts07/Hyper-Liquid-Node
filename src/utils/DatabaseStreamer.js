import fs from 'fs';
import path from 'path';

class DatabaseStreamer {
    constructor(logFile) {
        // This ensures the log file is created in the project's root directory
        this.logStream = fs.createWriteStream(path.resolve(logFile), { flags: 'a' });
        console.log(`Streaming database updates to ${path.resolve(logFile)}`);
    }

    /**
     * Writes a new entry to the stream file.
     * @param {string} table - The name of the table being changed.
     * @param {string} operation - The type of operation (e.g., 'INSERT', 'UPDATE').
     * @param {Object} data - The data being written.
     */
    logChange(table, operation, data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            table,
            operation,
            data
        };
        this.logStream.write(JSON.stringify(logEntry, null, 2) + ',\n');
    }
}

export default DatabaseStreamer;