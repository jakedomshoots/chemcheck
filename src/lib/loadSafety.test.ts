import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function readConvexModule(fileName: string): string {
  return readFileSync(resolve(process.cwd(), 'convex', fileName), 'utf8');
}

function getExportBlock(source: string, exportName: string, nextExportName: string): string {
  const startMarker = `export const ${exportName} =`;
  const endMarker = `export const ${nextExportName} =`;
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  expect(start, `${startMarker} should exist`).toBeGreaterThanOrEqual(0);
  expect(end, `${endMarker} should follow ${startMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('Convex load-safety contracts', () => {
  it('bounds the customer compatibility list before materializing rows', () => {
    const listBlock = getExportBlock(readConvexModule('customers.ts'), 'list', 'listPaginated');

    expect(listBlock).not.toContain('listAccessibleCustomers');
    expect(listBlock).toContain('.take(');
    expect(listBlock).not.toContain('.collect(');
  });

  it('paginates quotes instead of collecting an unbounded tenant history', () => {
    const listBlock = getExportBlock(readConvexModule('quotes.ts'), 'list', 'create');

    expect(listBlock).toContain('.paginate(');
    expect(listBlock).not.toContain('.collect(');
    expect(listBlock).toContain('continueCursor');
    expect(listBlock).toContain('isDone');
  });

  it('picks work-ticket customers from the local store instead of an unbounded cloud list', () => {
    const pickerSource = readFileSync(resolve(process.cwd(), 'src/components/work/CustomerPicker.jsx'), 'utf8');

    expect(pickerSource).toContain('useCustomers');
    expect(pickerSource).not.toContain('api.customers.list');
  });
});
