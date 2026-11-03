// Keep tests deterministic and isolated from the production .env file in the project root.
process.env.DOTENV_CONFIG_PATH = 'tests/.env.test-do-not-create';
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.MODEL_PROVIDER = 'echo';
process.env.STORAGE_DRIVER = 'memory';
process.env.OPENAI_COMPATIBLE_BASE_URL = '';
process.env.OPENAI_COMPATIBLE_API_KEY = '';
process.env.OPENAI_COMPATIBLE_MODEL = '';
process.env.SENTRY_DSN = '';
process.env.ADMIN_TOKEN = '';
process.env.CHAT_API_TOKEN = '';
process.env.WEIXIN_ACCOUNT_ID = '';
process.env.WEIXIN_BOT_TOKEN = '';