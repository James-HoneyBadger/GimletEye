/**
 * The 1.0 contract, checked against the schema files consumers receive.
 *
 * A schema nobody validates is a comment. This compiles the two published
 * schemas, validates a golden report that carries every field, validates every
 * manifest this build registers, and refuses the shapes the contract rules out.
 *
 * The golden report is also the drift guard: if `Report` gains a field, the
 * golden and its schema must gain it too, or the key comparison below fails.
 */

import { readFileSync } from 'node:fs';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { NODE_TOOLS } from '../src/node.js';

type Validator = ((value: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };

const read = (path: URL): unknown => JSON.parse(readFileSync(path, 'utf8'));

const reportSchema = read(new URL('../../../docs/schema/report.schema.json', import.meta.url)) as {
  properties: Record<string, unknown>;
};
const manifestSchema = read(new URL('../../../docs/schema/manifest.schema.json', import.meta.url));
const golden = read(new URL('./fixtures/report-golden.json', import.meta.url)) as Record<string, unknown>;

const ajv = new Ajv({ allErrors: true, strict: false });
const validReport = ajv.compile(reportSchema) as Validator;
const validManifest = ajv.compile(manifestSchema) as Validator;

const why = (validator: Validator): string =>
  (validator.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message ?? ''}`).join('; ');

describe('the report contract', () => {
  it('accepts the golden report, which carries every declared field', () => {
    expect(validReport(golden), why(validReport)).toBe(true);
    expect(Object.keys(golden).sort()).toEqual(Object.keys(reportSchema.properties).sort());
  });

  it('refuses a status the contract does not know', () => {
    expect(validReport({ ...golden, status: 'fine' })).toBe(false);
  });

  it('refuses a finding without a code', () => {
    expect(validReport({ ...golden, findings: [{ severity: 'high', message: 'm' }] })).toBe(false);
  });

  it('refuses a finding severity the contract does not know', () => {
    expect(validReport({ ...golden, findings: [{ severity: 'urgent', code: 'c', message: 'm' }] })).toBe(false);
  });

  it('refuses a field the 1.0 envelope does not declare', () => {
    // `report_version` arrives in 1.1 with a schema bump; until then a report
    // that carries it is not a 1.0 report.
    expect(validReport({ ...golden, report_version: 2 })).toBe(false);
  });

  it('refuses a non-numeric duration', () => {
    expect(validReport({ ...golden, duration_ms: '12' })).toBe(false);
  });
});

describe('the manifest contract', () => {
  for (const tool of NODE_TOOLS) {
    it(`accepts the ${tool.manifest.id} manifest`, () => {
      expect(validManifest(tool.manifest), why(validManifest)).toBe(true);
    });
  }

  it('refuses a capability the contract does not know', () => {
    expect(validManifest({ ...NODE_TOOLS[0]!.manifest, capabilities: ['network:raw'] })).toBe(false);
  });

  it('refuses an argument type the form cannot render', () => {
    const manifest = { ...NODE_TOOLS[0]!.manifest, args: [{ name: 'x', type: 'file' }] };
    expect(validManifest(manifest)).toBe(false);
  });

  it('refuses a data shape without its required map', () => {
    const manifest = { ...NODE_TOOLS[0]!.manifest, data: { shape: 'object' } };
    expect(validManifest(manifest)).toBe(false);
  });
});
