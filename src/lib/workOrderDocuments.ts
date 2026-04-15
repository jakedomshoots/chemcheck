type CustomerLike = {
  full_name?: string;
  address?: string;
  phone?: string;
  email?: string;
};

type LineItemLike = {
  description?: string;
  quantity?: number;
  unit_price?: number;
  amount?: number;
};

type QuoteLike = {
  _id?: string;
  title?: string;
  description?: string;
  created_at?: number;
  valid_until?: string;
  status?: string;
  line_items?: LineItemLike[];
  subtotal?: number;
  tax?: number;
  total?: number;
  deposit_required?: number;
  deposit_status?: string;
};

type InvoiceLike = {
  _id?: string;
  notes?: string;
  due_date?: string;
  status?: string;
  created_at?: number;
  paid_at?: number;
  sent_at?: number;
  line_items?: LineItemLike[];
  subtotal?: number;
  tax?: number;
  total?: number;
  deposit_applied?: number;
};

function escapeHtml(input: unknown): string {
  const text = String(input ?? "");
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatMoney(amount?: number): string {
  const safe = Number.isFinite(amount) ? Number(amount) : 0;
  return `$${safe.toFixed(2)}`;
}

function formatTimestamp(timestamp?: number): string {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  return new Date(timestamp).toLocaleDateString();
}

function quoteLineRows(quote: QuoteLike): string {
  return (quote.line_items || [])
    .map((line) => {
      const qty = Number.isFinite(line.quantity) ? Number(line.quantity) : 0;
      const unit = Number.isFinite(line.unit_price) ? Number(line.unit_price) : 0;
      const amount = Number.isFinite(line.amount) ? Number(line.amount) : qty * unit;
      return `
        <tr>
          <td>${escapeHtml(line.description || "Service")}</td>
          <td style="text-align:right;">${qty}</td>
          <td style="text-align:right;">${formatMoney(unit)}</td>
          <td style="text-align:right;">${formatMoney(amount)}</td>
        </tr>
      `;
    })
    .join("");
}

function invoiceLineRows(invoice: InvoiceLike): string {
  return (invoice.line_items || [])
    .map((line) => {
      const qty = Number.isFinite(line.quantity) ? Number(line.quantity) : 0;
      const unit = Number.isFinite(line.unit_price) ? Number(line.unit_price) : 0;
      const amount = Number.isFinite(line.amount) ? Number(line.amount) : qty * unit;
      return `
        <tr>
          <td>${escapeHtml(line.description || "Service")}</td>
          <td style="text-align:right;">${qty}</td>
          <td style="text-align:right;">${formatMoney(unit)}</td>
          <td style="text-align:right;">${formatMoney(amount)}</td>
        </tr>
      `;
    })
    .join("");
}

function wrapDocumentHtml(title: string, body: string): string {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(title)}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            color: #0f172a;
            margin: 0;
            padding: 24px;
            background: #f8fafc;
          }
          .page {
            background: #fff;
            border: 1px solid #e2e8f0;
            border-radius: 12px;
            padding: 24px;
            max-width: 860px;
            margin: 0 auto;
          }
          .header {
            display: flex;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 18px;
            border-bottom: 2px solid #0f172a;
            padding-bottom: 12px;
          }
          .title {
            font-size: 22px;
            font-weight: 700;
            margin: 0;
          }
          .meta {
            font-size: 12px;
            color: #475569;
            line-height: 1.5;
          }
          .grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px;
            margin-bottom: 20px;
          }
          .box {
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px;
            font-size: 13px;
          }
          .box h3 {
            margin: 0 0 8px 0;
            font-size: 12px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #334155;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
          }
          th, td {
            border-bottom: 1px solid #e2e8f0;
            padding: 8px;
            font-size: 12px;
            vertical-align: top;
          }
          th {
            text-align: left;
            background: #f8fafc;
            color: #334155;
          }
          .totals {
            margin-left: auto;
            width: 280px;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            padding: 10px;
          }
          .totals-row {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            margin: 4px 0;
          }
          .totals-row.total {
            font-size: 15px;
            font-weight: 700;
            border-top: 1px solid #e2e8f0;
            padding-top: 8px;
            margin-top: 8px;
          }
          .status {
            display: inline-block;
            border: 1px solid #cbd5e1;
            border-radius: 999px;
            padding: 2px 8px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            color: #334155;
            margin-top: 6px;
          }
          .note {
            margin-top: 16px;
            border: 1px dashed #cbd5e1;
            border-radius: 8px;
            padding: 10px;
            font-size: 12px;
            white-space: pre-wrap;
          }
          .print-actions {
            text-align: center;
            margin: 16px 0 0;
          }
          .print-btn {
            border: 1px solid #0f172a;
            background: #0f172a;
            color: #fff;
            border-radius: 6px;
            padding: 8px 14px;
            font-size: 12px;
            cursor: pointer;
          }
          @media print {
            body { background: #fff; padding: 0; }
            .page { border: 0; border-radius: 0; padding: 0; max-width: 100%; }
            .print-actions { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          ${body}
          <div class="print-actions">
            <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function buildQuoteDocumentHtml(args: {
  quote: QuoteLike;
  customer?: CustomerLike;
  businessName?: string;
}): string {
  const { quote, customer, businessName } = args;
  const createdDate = formatTimestamp(quote.created_at);
  const title = quote.title || "Quote";

  const body = `
    <div class="header">
      <div>
        <h1 class="title">Quote</h1>
        <div class="meta">${escapeHtml(businessName || "ChemCheck Pool Service")}</div>
        <div class="meta">Created: ${escapeHtml(createdDate || "N/A")}</div>
        <div class="meta">Quote #: ${escapeHtml(String(quote._id || ""))}</div>
      </div>
      <div style="text-align:right;">
        <div class="status">${escapeHtml(quote.status || "draft")}</div>
        <div class="meta">Valid Until: ${escapeHtml(quote.valid_until || "N/A")}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Customer</h3>
        <div>${escapeHtml(customer?.full_name || "Customer")}</div>
        <div>${escapeHtml(customer?.address || "")}</div>
        <div>${escapeHtml(customer?.phone || "")}</div>
        <div>${escapeHtml(customer?.email || "")}</div>
      </div>
      <div class="box">
        <h3>Quote Details</h3>
        <div><strong>Title:</strong> ${escapeHtml(title)}</div>
        <div><strong>Deposit Required:</strong> ${formatMoney(quote.deposit_required || 0)}</div>
        <div><strong>Deposit Status:</strong> ${escapeHtml(quote.deposit_status || "not_required")}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:right;">Qty</th>
          <th style="text-align:right;">Unit</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${quoteLineRows(quote)}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Subtotal</span><span>${formatMoney(quote.subtotal || 0)}</span></div>
      <div class="totals-row"><span>Tax</span><span>${formatMoney(quote.tax || 0)}</span></div>
      <div class="totals-row total"><span>Total</span><span>${formatMoney(quote.total || 0)}</span></div>
    </div>

    ${quote.description ? `<div class="note"><strong>Scope Notes</strong><br/>${escapeHtml(quote.description)}</div>` : ""}
  `;

  return wrapDocumentHtml(`Quote - ${title}`, body);
}

export function buildInvoiceDocumentHtml(args: {
  invoice: InvoiceLike;
  customer?: CustomerLike;
  businessName?: string;
}): string {
  const { invoice, customer, businessName } = args;
  const createdDate = formatTimestamp(invoice.created_at);

  const body = `
    <div class="header">
      <div>
        <h1 class="title">Invoice</h1>
        <div class="meta">${escapeHtml(businessName || "ChemCheck Pool Service")}</div>
        <div class="meta">Issued: ${escapeHtml(createdDate || "N/A")}</div>
        <div class="meta">Invoice #: ${escapeHtml(String(invoice._id || ""))}</div>
      </div>
      <div style="text-align:right;">
        <div class="status">${escapeHtml(invoice.status || "draft")}</div>
        <div class="meta">Due: ${escapeHtml(invoice.due_date || "Not set")}</div>
      </div>
    </div>

    <div class="grid">
      <div class="box">
        <h3>Bill To</h3>
        <div>${escapeHtml(customer?.full_name || "Customer")}</div>
        <div>${escapeHtml(customer?.address || "")}</div>
        <div>${escapeHtml(customer?.phone || "")}</div>
        <div>${escapeHtml(customer?.email || "")}</div>
      </div>
      <div class="box">
        <h3>Payment Status</h3>
        <div><strong>Sent:</strong> ${escapeHtml(formatTimestamp(invoice.sent_at) || "No")}</div>
        <div><strong>Paid:</strong> ${escapeHtml(formatTimestamp(invoice.paid_at) || "No")}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th style="text-align:right;">Qty</th>
          <th style="text-align:right;">Unit</th>
          <th style="text-align:right;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${invoiceLineRows(invoice)}
      </tbody>
    </table>

    <div class="totals">
      <div class="totals-row"><span>Subtotal</span><span>${formatMoney(invoice.subtotal || 0)}</span></div>
      <div class="totals-row"><span>Tax</span><span>${formatMoney(invoice.tax || 0)}</span></div>
      <div class="totals-row"><span>Deposit Applied</span><span>-${formatMoney(invoice.deposit_applied || 0)}</span></div>
      <div class="totals-row total"><span>Total</span><span>${formatMoney(invoice.total || 0)}</span></div>
    </div>

    ${invoice.notes ? `<div class="note"><strong>Notes</strong><br/>${escapeHtml(invoice.notes)}</div>` : ""}
  `;

  return wrapDocumentHtml(`Invoice - ${String(invoice._id || "")}`, body);
}

function openPrintWindow(html: string): boolean {
  if (typeof window === "undefined") return false;
  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  window.setTimeout(() => {
    try {
      printWindow.focus();
      printWindow.print();
    } catch {
      // Ignore print trigger failures; user can still print manually from the opened page.
    }
  }, 350);
  return true;
}

export function downloadQuotePdf(args: {
  quote: QuoteLike;
  customer?: CustomerLike;
  businessName?: string;
}): boolean {
  const html = buildQuoteDocumentHtml(args);
  return openPrintWindow(html);
}

export function downloadInvoicePdf(args: {
  invoice: InvoiceLike;
  customer?: CustomerLike;
  businessName?: string;
}): boolean {
  const html = buildInvoiceDocumentHtml(args);
  return openPrintWindow(html);
}
