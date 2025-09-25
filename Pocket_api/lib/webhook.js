const { now } = require('./utils');

class WebhookService {
  async emit(share, eventName, metadata = {}) {
    if (!share.webhookUrl) return;
    const payload = {
      event: eventName,
      share_id: share.id,
      timestamp: now(),
      metadata
    };
    try {
      await fetch(share.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // Swallow webhook errors to avoid crashing the server
      console.error('Webhook dispatch failed', err.message);
    }
  }
}

module.exports = { WebhookService };
