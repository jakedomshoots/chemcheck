import { db } from '@/db/chemcheck-db';
import type { Customer, ServiceLog } from '@/db/chemcheck-db';
import { format, parseISO, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

export interface ReportOptions {
  title: string;
  dateRange?: { start: string; end: string };
  customerId?: number;
  includeChemicals?: boolean;
  includeNotes?: boolean;
}

interface ReportData {
  customer?: Customer;
  serviceLogs: ServiceLog[];
  chemicalUsage: Array<{ chemical_type: string; quantity: string; created_date: string }>;
  notes: Array<{ title: string; content: string; created_date: string }>;
}

function generateReportHTML(data: ReportData, options: ReportOptions): string {
  const { customer, serviceLogs, chemicalUsage, notes } = data;
  const businessName = localStorage.getItem('chemcheck_business_name') || 'Pool Service Company';
  
  const dateRangeText = options.dateRange 
    ? `${format(parseISO(options.dateRange.start), 'MMM d, yyyy')} - ${format(parseISO(options.dateRange.end), 'MMM d, yyyy')}`
    : 'All Time';

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${options.title}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          line-height: 1.5;
          color: #1f2937;
          padding: 40px;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 30px;
          padding-bottom: 20px;
          border-bottom: 2px solid #e5e7eb;
        }
        .logo { font-size: 24px; font-weight: bold; color: #7c3aed; }
        .report-info { text-align: right; }
        .report-title { font-size: 20px; font-weight: 600; margin-bottom: 5px; }
        .report-date { color: #6b7280; font-size: 14px; }
        
        .customer-info {
          background: #f9fafb;
          padding: 20px;
          border-radius: 8px;
          margin-bottom: 30px;
        }
        .customer-name { font-size: 18px; font-weight: 600; margin-bottom: 10px; }
        .customer-details { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
        .detail-item { font-size: 14px; }
        .detail-label { color: #6b7280; }
        
        .section { margin-bottom: 30px; }
        .section-title { 
          font-size: 16px; 
          font-weight: 600; 
          margin-bottom: 15px;
          padding-bottom: 8px;
          border-bottom: 1px solid #e5e7eb;
        }
        
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { 
          background: #f3f4f6; 
          padding: 10px; 
          text-align: left; 
          font-weight: 600;
          border-bottom: 2px solid #e5e7eb;
        }
        td { 
          padding: 10px; 
          border-bottom: 1px solid #e5e7eb;
          vertical-align: top;
        }
        tr:nth-child(even) { background: #f9fafb; }
        
        .status-completed { color: #059669; font-weight: 500; }
        .status-skipped { color: #dc2626; font-weight: 500; }
        .status-pending { color: #d97706; font-weight: 500; }
        
        .reading { 
          display: inline-block;
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          margin-right: 5px;
        }
        .reading-normal { background: #d1fae5; color: #065f46; }
        .reading-warning { background: #fef3c7; color: #92400e; }
        .reading-critical { background: #fee2e2; color: #991b1b; }
        
        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 15px;
          margin-bottom: 30px;
        }
        .summary-card {
          background: #f9fafb;
          padding: 15px;
          border-radius: 8px;
          text-align: center;
        }
        .summary-value { font-size: 24px; font-weight: bold; color: #7c3aed; }
        .summary-label { font-size: 12px; color: #6b7280; margin-top: 5px; }
        
        .footer {
          margin-top: 40px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          text-align: center;
          color: #9ca3af;
          font-size: 12px;
        }
        
        @media print {
          body { padding: 20px; }
          .no-print { display: none; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">${businessName}</div>
        <div class="report-info">
          <div class="report-title">${options.title}</div>
          <div class="report-date">${dateRangeText}</div>
          <div class="report-date">Generated: ${format(new Date(), 'MMM d, yyyy h:mm a')}</div>
        </div>
      </div>
      
      ${customer ? `
        <div class="customer-info">
          <div class="customer-name">${customer.full_name}</div>
          <div class="customer-details">
            <div class="detail-item"><span class="detail-label">Address:</span> ${customer.address}</div>
            <div class="detail-item"><span class="detail-label">Service Day:</span> ${customer.service_day}</div>
            <div class="detail-item"><span class="detail-label">Pool Type:</span> ${customer.pool_type}</div>
            <div class="detail-item"><span class="detail-label">Surface:</span> ${customer.surface_type}</div>
            ${customer.pool_gallons ? `<div class="detail-item"><span class="detail-label">Gallons:</span> ${customer.pool_gallons.toLocaleString()}</div>` : ''}
            ${customer.phone ? `<div class="detail-item"><span class="detail-label">Phone:</span> ${customer.phone}</div>` : ''}
          </div>
        </div>
      ` : ''}
      
      <div class="summary-grid">
        <div class="summary-card">
          <div class="summary-value">${serviceLogs.length}</div>
          <div class="summary-label">Total Services</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${serviceLogs.filter(l => l.status === 'completed').length}</div>
          <div class="summary-label">Completed</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${serviceLogs.filter(l => l.status === 'skipped').length}</div>
          <div class="summary-label">Skipped</div>
        </div>
        <div class="summary-card">
          <div class="summary-value">${chemicalUsage.length}</div>
          <div class="summary-label">Chemical Applications</div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">Service History</div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Status</th>
              <th>pH</th>
              <th>Chlorine</th>
              <th>Alkalinity</th>
              <th>Stabilizer</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${serviceLogs.map(log => `
              <tr>
                <td>${format(parseISO(log.service_date), 'MMM d, yyyy')}</td>
                <td class="status-${log.status}">${log.status}</td>
                <td>${log.ph || '-'}</td>
                <td>${log.chlorine || '-'}</td>
                <td>${log.alkalinity || '-'}</td>
                <td>${log.stabilizer || '-'}</td>
                <td>${log.notes || '-'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      ${options.includeChemicals && chemicalUsage.length > 0 ? `
        <div class="section">
          <div class="section-title">Chemical Usage</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Chemical</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              ${chemicalUsage.map(usage => `
                <tr>
                  <td>${format(parseISO(usage.created_date), 'MMM d, yyyy')}</td>
                  <td>${usage.chemical_type}</td>
                  <td>${usage.quantity}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      
      ${options.includeNotes && notes.length > 0 ? `
        <div class="section">
          <div class="section-title">Notes</div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>Content</th>
              </tr>
            </thead>
            <tbody>
              ${notes.map(note => `
                <tr>
                  <td>${format(parseISO(note.created_date), 'MMM d, yyyy')}</td>
                  <td>${note.title}</td>
                  <td>${note.content}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
      
      <div class="footer">
        <p>Generated by ChemCheck Pool Service Management</p>
        <p>This report is for informational purposes only.</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generate and open a PDF report in a new window for printing
 */
export async function generateServiceReport(options: ReportOptions): Promise<void> {
  const data: ReportData = {
    serviceLogs: [],
    chemicalUsage: [],
    notes: [],
  };

  if (options.customerId) {
    data.customer = await db.customers.get(options.customerId) || undefined;
  }

  let logsQuery = db.serviceLogs.toCollection();
  if (options.customerId) {
    logsQuery = db.serviceLogs.where('customer_id').equals(options.customerId);
  }
  data.serviceLogs = await logsQuery.toArray();

  if (options.dateRange) {
    data.serviceLogs = data.serviceLogs.filter(log => 
      log.service_date >= options.dateRange!.start && 
      log.service_date <= options.dateRange!.end
    );
  }

  data.serviceLogs.sort((a, b) => b.service_date.localeCompare(a.service_date));

  if (options.includeChemicals) {
    let usageQuery = db.chemicalUsage.toCollection();
    if (options.customerId) {
      usageQuery = db.chemicalUsage.where('customer_id').equals(options.customerId);
    }
    const usage = await usageQuery.toArray();
    data.chemicalUsage = usage.flatMap(u => {
      if (!u.created_date) return [];
      if (options.dateRange && (u.created_date < options.dateRange.start || u.created_date > options.dateRange.end)) {
        return [];
      }

      return [{
        chemical_type: u.chemical_type,
        quantity: u.quantity,
        created_date: u.created_date,
      }];
    });
  }

  if (options.includeNotes && options.customerId) {
    const notes = await db.notes.where('customer_id').equals(options.customerId).toArray();
    data.notes = notes.flatMap(n => {
      if (!n.created_date) return [];
      if (options.dateRange && (n.created_date < options.dateRange.start || n.created_date > options.dateRange.end)) {
        return [];
      }

      return [{
        title: n.title,
        content: n.content,
        created_date: n.created_date,
      }];
    });
  }

  const html = generateReportHTML(data, options);
  const printWindow = window.open('', '_blank');
  if (printWindow) {
    const document = new DOMParser().parseFromString(html, 'text/html');
    printWindow.document.documentElement.innerHTML = document.documentElement.innerHTML;
    printWindow.document.close();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  }
}

export async function generateWeeklyReport(weekStart?: Date): Promise<void> {
  const start = weekStart || startOfWeek(new Date(), { weekStartsOn: 1 });
  const end = endOfWeek(start, { weekStartsOn: 1 });

  await generateServiceReport({
    title: 'Weekly Service Report',
    dateRange: {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
    },
    includeChemicals: true,
  });
}

export async function generateMonthlyReport(month?: Date): Promise<void> {
  const targetMonth = month || new Date();
  const start = startOfMonth(targetMonth);
  const end = endOfMonth(targetMonth);

  await generateServiceReport({
    title: `Monthly Service Report - ${format(targetMonth, 'MMMM yyyy')}`,
    dateRange: {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
    },
    includeChemicals: true,
  });
}

export async function generateCustomerReport(
  customerId: number,
  options?: { dateRange?: { start: string; end: string } }
): Promise<void> {
  const customer = await db.customers.get(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  await generateServiceReport({
    title: `Service Report - ${customer.full_name}`,
    customerId,
    dateRange: options?.dateRange,
    includeChemicals: true,
    includeNotes: true,
  });
}
