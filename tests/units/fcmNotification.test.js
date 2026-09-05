import { describe, expect, it } from 'vitest';

const fcmService = require('../../services/fcmService');
const fcmQueueWatcher = require('../../services/fcmQueueWatcher');

describe('FCM Service & Queue Watcher', () => {
  it('fcmService gracefully handles unconfigured Firebase credentials without crashing', async () => {
    const result = await fcmService.sendDataPushToDoctor('test_user', 'sbar_request', 101);
    expect(result).toBeDefined();
    // In test environment without credentials, skipped or no_tokens
    expect(result.sent !== undefined || result.skipped !== undefined).toBe(true);
  });

  it('fcmQueueWatcher exports start, stop, and pollNewNotifications functions', () => {
    expect(typeof fcmQueueWatcher.start).toBe('function');
    expect(typeof fcmQueueWatcher.stop).toBe('function');
    expect(typeof fcmQueueWatcher.pollNewNotifications).toBe('function');
  });

  it('fcmQueueWatcher.pollNewNotifications executes safely without errors', async () => {
    await expect(fcmQueueWatcher.pollNewNotifications()).resolves.not.toThrow();
  });
});
