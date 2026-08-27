import { describe, expect, it } from 'vitest';

describe('inacbgMonitorService', () => {
  it('should export start, stop, poll, resolveDoctorNik, and getRecipientsForPatient functions', () => {
    const svc = require('../../services/inacbgMonitorService');
    expect(svc).toBeDefined();
    expect(typeof svc.start).toBe('function');
    expect(typeof svc.stop).toBe('function');
    expect(typeof svc.poll).toBe('function');
    expect(typeof svc.resolveDoctorNik).toBe('function');
    expect(typeof svc.getRecipientsForPatient).toBe('function');
  });

  it('should handle resolveDoctorNik with invalid input gracefully', async () => {
    const svc = require('../../services/inacbgMonitorService');
    const resultNull = await svc.resolveDoctorNik(null);
    expect(resultNull).toBeNull();

    const resultEmpty = await svc.resolveDoctorNik('');
    expect(resultEmpty).toBe('');
  });

  it('should execute poll without throwing unhandled exceptions', async () => {
    const svc = require('../../services/inacbgMonitorService');
    await expect(svc.poll()).resolves.toBeUndefined();
  });
});
