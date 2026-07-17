import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useLocalWorkOrders } from './localWorkOrders';

describe('useLocalWorkOrders', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists local work orders and invoice drafts', async () => {
    const { result } = renderHook(() => useLocalWorkOrders(true));

    await act(async () => {
      await result.current.createWorkOrder({ customer_id: 1, title: 'Filter clean', scheduled_date: '2026-07-11' });
    });

    const workOrder = result.current.workOrders[0];
    expect(workOrder).toMatchObject({ customer_id: 1, title: 'Filter clean', status: 'scheduled' });

    await act(async () => {
      await result.current.createInvoiceDraft({
        customer_id: 1,
        work_order_id: workOrder._id,
        line_items: [{ description: 'Filter clean', quantity: 1, unit_price: 120, amount: 120 }],
        tax_rate: 0.0825,
      });
    });

    expect(result.current.invoices[0]).toMatchObject({
      customer_id: 1,
      work_order_id: workOrder._id,
      subtotal: 120,
      tax: 9.9,
      total: 129.9,
      status: 'draft',
    });
  });

  it('converts a local quote into a local work order', async () => {
    const { result } = renderHook(() => useLocalWorkOrders(true));
    let quoteId;

    await act(async () => {
      quoteId = await result.current.createQuote({
        customer_id: 1,
        title: 'Pump replacement',
        line_items: [{ description: 'Pump replacement', quantity: 1, unit_price: 900, amount: 900 }],
        tax_rate: 0,
      });
    });
    await act(async () => {
      await result.current.convertQuoteToWorkOrder({ id: quoteId, scheduled_date: '2026-07-11', priority: 'high' });
    });

    expect(result.current.quotes[0]).toMatchObject({ _id: quoteId, status: 'converted' });
    expect(result.current.workOrders[0]).toMatchObject({
      customer_id: 1,
      title: 'Pump replacement',
      source_quote_id: quoteId,
      priority: 'high',
    });
  });
});
