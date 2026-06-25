import { describe, it, expect } from '@jest/globals';
import { resolveParameters } from '../snippet-parameters.mjs';

describe('resolveParameters', () => {
  it('passes undeclared attributes through as strings', () => {
    const { values, errors } = resolveParameters([], { text: 'hello', extra: 'x' });
    expect(values).toEqual({ text: 'hello', extra: 'x' });
    expect(errors).toEqual([]);
  });

  it('applies defaultValue when a parameter is missing', () => {
    const params = [{ name: 'tone', type: 'string', defaultValue: 'dry' }];
    const { values, errors } = resolveParameters(params, {});
    expect(values.tone).toBe('dry');
    expect(errors).toEqual([]);
  });

  it('applies defaultValue when a parameter is provided but empty', () => {
    const params = [{ name: 'tone', type: 'string', defaultValue: 'dry' }];
    const { values } = resolveParameters(params, { tone: '' });
    expect(values.tone).toBe('dry');
  });

  it('reports an error for a missing required parameter and omits it', () => {
    const params = [{ name: 'text', type: 'textarea', required: true }];
    const { values, errors } = resolveParameters(params, {});
    expect(values).not.toHaveProperty('text');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ name: 'text' });
  });

  it('coerces number parameters', () => {
    const params = [{ name: 'count', type: 'number' }];
    expect(resolveParameters(params, { count: '3' }).values.count).toBe(3);
  });

  it('errors on a non-numeric number, keeping the raw string', () => {
    const params = [{ name: 'count', type: 'number' }];
    const { values, errors } = resolveParameters(params, { count: 'abc' });
    expect(values.count).toBe('abc');
    expect(errors).toHaveLength(1);
  });

  it('coerces boolean parameters', () => {
    const params = [{ name: 'flag', type: 'boolean' }];
    expect(resolveParameters(params, { flag: 'true' }).values.flag).toBe(true);
    expect(resolveParameters(params, { flag: 'false' }).values.flag).toBe(false);
    expect(resolveParameters(params, { flag: 'nope' }).errors).toHaveLength(1);
  });

  it('validates select options', () => {
    const params = [{ name: 'tone', type: 'select', options: ['dry', 'warm'] }];
    expect(resolveParameters(params, { tone: 'dry' }).errors).toEqual([]);
    expect(resolveParameters(params, { tone: 'spicy' }).errors).toHaveLength(1);
  });

  it('treats url/textarea/string as plain strings', () => {
    const params = [
      { name: 'href', type: 'url' },
      { name: 'body', type: 'textarea' },
      { name: 'label', type: 'string' }
    ];
    const { values, errors } = resolveParameters(params, {
      href: 'https://x.io',
      body: '*hi*',
      label: 'Go'
    });
    expect(values).toMatchObject({ href: 'https://x.io', body: '*hi*', label: 'Go' });
    expect(errors).toEqual([]);
  });
});
