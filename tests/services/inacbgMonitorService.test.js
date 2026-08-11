import { describe, expect, it } from 'vitest';

describe('inacbgMonitorService', () => {
  it('should export start function', () => {
    const svc = require('../../services/inacbgMonitorService');
    expect(svc).toBeDefined();
    expect(typeof svc.start).toBe('function');
  });

  it('should have no syntax errors', () => {
    expect(() => require('../../services/inacbgMonitorService')).not.toThrow();
  });
});
