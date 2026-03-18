const dotenv = require("dotenv");

dotenv.config({quiet: true});

const ENV_CONFIG = {
    AI_PROVIDER: process.env.AI_PROVIDER || "",
    AI_MODEL: process.env.AI_MODEL || "",
    AI_SUMMARY_MODEL: process.env.AI_SUMMARY_MODEL || process.env.AI_MODEL || "",
    AI_VISION_MODEL: process.env.AI_VISION_MODEL || "",
    VISION_MODEL: process.env.VISION_MODEL || "",
    AI_API_PATH: process.env.AI_API_PATH || "",
    AI_REQUEST_FORMAT: process.env.AI_REQUEST_FORMAT || "",
    BASE_URL: process.env.BASE_URL || "",
    API_KEY: process.env.API_KEY || "",
};

module.exports = {
    ENV_CONFIG,
};
