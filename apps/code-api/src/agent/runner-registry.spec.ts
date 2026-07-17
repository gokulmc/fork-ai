import { BadRequestException } from '@nestjs/common';
import { RunnerRegistry } from './runner-registry';
import type { AgentRunner } from './agent-runner';

const mockRunner = (): AgentRunner => ({ run: jest.fn() });

describe('RunnerRegistry', () => {
  it('resolves the default runner when no environment is given', () => {
    const mock = mockRunner();
    const registry = new RunnerRegistry({ mock }, 'mock');
    expect(registry.resolve()).toBe(mock);
    expect(registry.resolve(undefined)).toBe(mock);
  });

  it('resolves an explicitly requested, configured environment', () => {
    const mock = mockRunner();
    const cloud = mockRunner();
    const registry = new RunnerRegistry({ mock, cloud }, 'mock');
    expect(registry.resolve('cloud')).toBe(cloud);
  });

  it('throws BadRequestException for an explicitly requested but unconfigured environment', () => {
    const mock = mockRunner();
    const registry = new RunnerRegistry({ mock }, 'mock');
    expect(() => registry.resolve('cloud')).toThrow(BadRequestException);
  });

  it('throws BadRequestException for an unknown environment string — never silently falls back', () => {
    const mock = mockRunner();
    const cloud = mockRunner();
    const registry = new RunnerRegistry({ mock, cloud }, 'mock');
    expect(() => registry.resolve('not-a-real-environment')).toThrow(BadRequestException);
  });

  it('throws when even the default runner is missing (misconfig)', () => {
    const cloud = mockRunner();
    const registry = new RunnerRegistry({ cloud }, 'mock');
    expect(() => registry.resolve()).toThrow(/mock/);
  });

  it('resolves the blaxel runner when configured', () => {
    const mock = mockRunner();
    const blaxel = mockRunner();
    const registry = new RunnerRegistry({ mock, blaxel }, 'mock');
    expect(registry.resolve('blaxel')).toBe(blaxel);
  });

  it('treats both cloud and blaxel as billed-cloud (isCloud), mock/local as not', () => {
    const registry = new RunnerRegistry({ mock: mockRunner() }, 'mock');
    expect(registry.isCloud('cloud')).toBe(true);
    expect(registry.isCloud('blaxel')).toBe(true);
    expect(registry.isCloud('mock')).toBe(false);
    expect(registry.isCloud('local')).toBe(false);
  });

  it('isCloud() with no environment follows the server default', () => {
    expect(new RunnerRegistry({ blaxel: mockRunner() }, 'blaxel').isCloud()).toBe(true);
    expect(new RunnerRegistry({ mock: mockRunner() }, 'mock').isCloud()).toBe(false);
  });
});
