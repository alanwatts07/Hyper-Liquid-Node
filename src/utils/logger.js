// src/utils/logger.js

// ANSI color codes for terminal output
const colors = {
    reset: "\x1b[0m",
    bright: "\x1b[1m",
    dim: "\x1b[2m",
    underscore: "\x1b[4m",
    blink: "\x1b[5m",
    reverse: "\x1b[7m",
    hidden: "\x1b[8m",
    
    fg: {
        black: "\x1b[30m",
        red: "\x1b[31m",
        green: "\x1b[32m",
        yellow: "\x1b[33m",
        blue: "\x1b[34m",
        magenta: "\x1b[35m",
        cyan: "\x1b[36m",
        white: "\x1b[37m",
    },
    bg: {
        black: "\x1b[40m",
        red: "\x1b[41m",
        green: "\x1b[42m",
        yellow: "\x1b[43m",
        blue: "\x1b[44m",
        magenta: "\x1b[45m",
        cyan: "\x1b[46m",
        white: "\x1b[47m",
    }
};

const getTimestamp = () => new Date().toLocaleTimeString();

const logger = {
    info: (message) => {
        console.log(`${colors.fg.cyan}[${getTimestamp()}] INFO: ${message}${colors.reset}`);
    },
    warn: (message) => {
        console.warn(`${colors.fg.yellow}[${getTimestamp()}] WARN: ${message}${colors.reset}`);
    },
    error: (message) => {
        console.error(`${colors.fg.red}[${getTimestamp()}] ERROR: ${message}${colors.reset}`);
    },
    success: (message) => {
        console.log(`${colors.fg.green}[${getTimestamp()}] SUCCESS: ${message}${colors.reset}`);
    }
};

// This is the crucial part that fixes your error.
// We are exporting the logger object as the default export for this module.
export default logger;