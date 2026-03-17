window.ENAU_CONFIG = Object.assign(
  {
    API_BASE_URL: '/api',
    API_TIMEOUT_MS: 15000,
    APP_SESSION_KEY: 'enau_user',
    PASSWORD_MIN_LENGTH: 8,
    SESSION_TTL_HOURS: 12
  },
  window.ENAU_CONFIG || {}
);
