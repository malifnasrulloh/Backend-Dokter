import { beforeEach, describe, expect, it, vi } from 'vitest';

const soapVerificationService = require('../../services/soapVerificationService');

describe('soapVerificationService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('isDoctorDPJP mengembalikan true jika username adalah SuperAdmin', async () => {
    const isDPJP = await soapVerificationService.isDoctorDPJP(
      '2026/10/10/000001',
      'admin',
      'ranap',
      true
    );
    expect(isDPJP).toBe(true);
  });

  it('checkVerificationDeadline mendeteksi kadaluarsa jika melewati 24 jam', async () => {
    const tglLalu = '2026-10-01';
    const jamLalu = '08:00:00';
    const res = await soapVerificationService.checkVerificationDeadline(
      '2026/10/01/000001',
      tglLalu,
      jamLalu,
      'ranap'
    );
    expect(res.isExpired).toBe(true);
  });
});
