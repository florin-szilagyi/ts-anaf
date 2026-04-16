import { describe, it, expect, jest } from '@jest/globals';
import { handleValidateXml } from '../../src/tools/validate.js';

describe('handleValidateXml', () => {
  it('returns valid=true when ANAF reports valid', async () => {
    const mockTools = {
      validateXml: jest
        .fn<() => Promise<{ valid: boolean; details: string }>>()
        .mockResolvedValue({ valid: true, details: 'OK' }),
    };
    const result = await handleValidateXml(
      { xml: '<?xml version="1.0"?><Invoice/>', standard: 'FACT1' },
      { tools: mockTools as any }
    );
    expect(mockTools.validateXml).toHaveBeenCalledWith('<?xml version="1.0"?><Invoice/>', 'FACT1');
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('"valid": true');
  });

  it('returns valid=false with details when ANAF reports invalid', async () => {
    const mockTools = {
      validateXml: jest
        .fn<() => Promise<{ valid: boolean; details: string }>>()
        .mockResolvedValue({ valid: false, details: 'BR-01 missing' }),
    };
    const result = await handleValidateXml({ xml: '<Invoice/>' }, { tools: mockTools as any });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toContain('"valid": false');
    expect(result.content[0].text).toContain('BR-01 missing');
  });

  it('wraps SDK errors into tool error result', async () => {
    const mockTools = {
      validateXml: jest
        .fn<() => Promise<{ valid: boolean; details: string }>>()
        .mockRejectedValue(new Error('network fail')),
    };
    const result = await handleValidateXml({ xml: '<x/>' }, { tools: mockTools as any });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/VALIDATION_FAILED|network fail/);
  });
});
