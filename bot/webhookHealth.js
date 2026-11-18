class WebhookHealth {
    constructor(register, { schedule = setTimeout, now = Date.now } = {}) {
        this.register = register;
        this.schedule = schedule;
        this.now = now;
        this.state = {
            status: 'starting',
            reconnectAttempts: 0,
            lastConnectedAt: null,
            lastFailureAt: null,
            nextRetryAt: null
        };
        this.pending = false;
        this.retryTimer = null;
    }

    snapshot() {
        return { ...this.state };
    }

    async connect() {
        if (this.pending || this.retryTimer) return;
        this.pending = true;
        this.state.status = this.state.reconnectAttempts ? 'reconnecting' : 'connecting';
        this.state.nextRetryAt = null;
        try {
            if (!await this.register()) throw new Error('Webhook registration failed');
            this.state.status = 'ready';
            this.state.lastConnectedAt = new Date(this.now()).toISOString();
            this.state.reconnectAttempts = 0;
        } catch {
            // Telegram errors can contain the bot token; expose only state and timestamps.
            this.state.status = 'reconnecting';
            this.state.lastFailureAt = new Date(this.now()).toISOString();
            this.state.reconnectAttempts += 1;
            const delay = Math.min(1000 * 2 ** Math.min(this.state.reconnectAttempts - 1, 5), 30000);
            this.state.nextRetryAt = new Date(this.now() + delay).toISOString();
            this.retryTimer = this.schedule(() => {
                this.retryTimer = null;
                void this.connect();
            }, delay);
            this.retryTimer.unref?.();
        } finally {
            this.pending = false;
        }
    }
}

module.exports = WebhookHealth;
