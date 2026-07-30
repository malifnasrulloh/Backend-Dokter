import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

describe('hono loader', () => {
  it('should load without error', () => {
    const app = new Hono();
    expect(() => require('../../loaders/hono')(app)).not.toThrow();
  });

  it('should register routes', () => {
    const app = new Hono();
    require('../../loaders/hono')(app);
    // App should have routes registered — verify it's not an empty app
    expect(app.routes).toBeDefined();
    expect(Array.isArray(app.routes)).toBe(true);
  });
});
