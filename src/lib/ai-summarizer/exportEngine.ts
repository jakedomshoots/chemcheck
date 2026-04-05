/**
 * Export Engine
 * 
 * Generates various export formats for pool analysis reports and fleet data.
 * Supports PDF report generation with charts, CSV export for fleet data,
 * and includes timestamps and data ranges.
 * 
 * Requirements: 10.1, 10.4, 10.5
 * 
 * Security:
 * - All user data is escaped before HTML rendering (XSS prevention)
 * - CSV values are escaped to prevent formula injection
 * - Date ranges are validated before processing
 * - Array sizes are bounded to prevent DoS
 */

import { format, parseISO } from 'date-fns';
import type {
  ExportOptions,
  ExportResult,
  ExportBranding,
  PoolAnalysisResult,
  FleetInsights,
  FleetPool,
  PoolHealthScore,
  CostAnalysis,
  GeneratedSummary,
  CustomerReport,
} from './types';
import {
  escapeHtml,
  escapeCsvValue,
  validateDateRange,
  validateArray,
  BOUNDS,
} from './validation';

const DEFAULT_BRANDING: ExportBranding = {
  companyName: 'Pool Service Company',
  logo: null,
  primaryColor: '#7c3aed',
};

const MAX_FLEET_EXPORT_POOLS = 1000;

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export function isTimestampAccurate(timestamp: string, toleranceMs: number = 60000): boolean {
  const exportTime = new Date(timestamp).getTime();
  if (isNaN(exportTime)) {
    return false;
  }
  const now = Date.now();
  return Math.abs(now - exportTime) <= toleranceMs;
}

function formatDate(dateString: string): string {
  try {
    return format(parseISO(dateString), 'MMM d, yyyy');
  } catch {
    // SECURITY: Escape the raw string on error to prevent XSS
    return escapeHtml(dateString);
  }
}

function formatDateTime(dateString: string): string {
  try {
    return format(parseISO(dateString), 'MMM d, yyyy h:mm a');
  } catch {
    // SECURITY: Escape the raw string on error to prevent XSS
    return escapeHtml(dateString);
  }
}

function arrayToCsv<T extends Record<string, unknown>>(data: T[], headers: string[]): string {
  const validatedData = validateArray<T>(data, MAX_FLEET_EXPORT_POOLS);
  
  const headerRow = headers.map(h => escapeCsvValue(h)).join(',');
  const dataRows = validatedData.map(row =>
    headers.map(header => escapeCsvValue(row[header])).join(',')
  );
  return [headerRow, ...dataRows].join('\n');
}

function generatePoolAnalysisHTML(
  analysis: PoolAnalysisResult,
  branding: ExportBranding
): string {
  const { healthScore, professionalSummary, customerReport, costAnalysis, recommendations } = analysis;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Pool Analysis Report - ${analysis.customerName}</title>
      <style>
        ${getReportStyles(branding)}
      </style>
    </head>
    <body>
      ${generateReportHeader(branding, analysis)}
      ${generateHealthScoreSection(healthScore)}
      ${generateSummarySection(professionalSummary)}
      ${generateTrendsSection(analysis)}
      ${generateRecommendationsSection(recommendations)}
      ${costAnalysis ? generateCostSection(costAnalysis) : ''}
      ${generateCustomerReportSection(customerReport)}
      ${generateReportFooter(analysis)}
    </body>
    </html>
  `;
}

function getReportStyles(branding: ExportBranding): string {
  return `
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #1f2937;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 3px solid ${branding.primaryColor};
    }
    .logo { font-size: 24px; font-weight: bold; color: ${branding.primaryColor}; }
    .report-info { text-align: right; }
    .report-title { font-size: 20px; font-weight: 600; margin-bottom: 5px; }
    .report-date { color: #6b7280; font-size: 14px; }
    
    .section { margin-bottom: 30px; }
    .section-title { 
      font-size: 18px; 
      font-weight: 600; 
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 2px solid #e5e7eb;
      color: ${branding.primaryColor};
    }
    
    .health-score-card {
      background: linear-gradient(135deg, ${branding.primaryColor}15, ${branding.primaryColor}05);
      border: 2px solid ${branding.primaryColor};
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      margin-bottom: 20px;
    }
    .score-value { font-size: 48px; font-weight: bold; color: ${branding.primaryColor}; }
    .score-grade { font-size: 24px; color: #6b7280; margin-left: 8px; }
    .score-label { font-size: 14px; color: #6b7280; margin-top: 8px; }
    
    .summary-box {
      background: #f9fafb;
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 20px;
    }
    .summary-headline { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
    .summary-text { color: #4b5563; }
    
    .bullet-list { list-style: none; padding: 0; }
    .bullet-list li { 
      padding: 8px 0 8px 24px;
      position: relative;
      border-bottom: 1px solid #e5e7eb;
    }
    .bullet-list li:before {
      content: "•";
      color: ${branding.primaryColor};
      font-weight: bold;
      position: absolute;
      left: 8px;
    }
    
    .recommendation-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 12px;
    }
    .recommendation-priority {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      margin-right: 8px;
    }
    .priority-immediate { background: #fee2e2; color: #991b1b; }
    .priority-thisVisit { background: #fef3c7; color: #92400e; }
    .priority-nextVisit { background: #dbeafe; color: #1e40af; }
    .priority-longTerm { background: #e5e7eb; color: #374151; }
    
    .cost-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 16px;
      margin-bottom: 20px;
    }
    .cost-card {
      background: #f9fafb;
      border-radius: 8px;
      padding: 16px;
      text-align: center;
    }
    .cost-value { font-size: 24px; font-weight: bold; color: ${branding.primaryColor}; }
    .cost-label { font-size: 12px; color: #6b7280; margin-top: 4px; }
    
    .customer-report-box {
      background: #f0fdf4;
      border: 1px solid #86efac;
      border-radius: 8px;
      padding: 20px;
    }
    
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
      .page-break { page-break-before: always; }
    }
  `;
}
function generateReportHeader(branding: ExportBranding, analysis: PoolAnalysisResult): string {
  return `
    <div class="header">
      <div class="logo">${escapeHtml(branding.companyName)}</div>
      <div class="report-info">
        <div class="report-title">Pool Analysis Report</div>
        <div class="report-date">${escapeHtml(analysis.customerName)}</div>
        <div class="report-date">Data: ${escapeHtml(formatDate(analysis.dataRange.start))} - ${escapeHtml(formatDate(analysis.dataRange.end))}</div>
        <div class="report-date">Generated: ${escapeHtml(formatDateTime(analysis.generatedAt))}</div>
      </div>
    </div>
  `;
}

function generateHealthScoreSection(healthScore: PoolHealthScore): string {
  const trendIcon = healthScore.trend === 'improving' ? '↑' : 
                    healthScore.trend === 'declining' ? '↓' : '→';
  const trendColor = healthScore.trend === 'improving' ? '#059669' : 
                     healthScore.trend === 'declining' ? '#dc2626' : '#6b7280';
  
  return `
    <div class="section">
      <div class="section-title">Pool Health Score</div>
      <div class="health-score-card">
        <span class="score-value">${Math.round(healthScore.score)}</span>
        <span class="score-grade">Grade: ${healthScore.grade}</span>
        <div class="score-label">
          Trend: <span style="color: ${trendColor}">${trendIcon} ${healthScore.trend}</span>
          | Confidence: ${healthScore.confidence}%
        </div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(${healthScore.breakdown.length}, 1fr); gap: 8px;">
        ${healthScore.breakdown.map(b => `
          <div style="text-align: center; padding: 8px; background: #f9fafb; border-radius: 4px;">
            <div style="font-weight: 600;">${b.chemical}</div>
            <div style="font-size: 20px; color: #7c3aed;">${Math.round(b.score)}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function generateSummarySection(summary: GeneratedSummary): string {
  const toneColors: Record<string, string> = {
    positive: '#059669',
    neutral: '#6b7280',
    concerned: '#d97706',
    urgent: '#dc2626',
  };
  
  return `
    <div class="section">
      <div class="section-title">Analysis Summary</div>
      <div class="summary-box">
        <div class="summary-headline" style="color: ${toneColors[summary.tone] || '#1f2937'}">
          ${escapeHtml(summary.headline)}
        </div>
        <p class="summary-text">${escapeHtml(summary.paragraph)}</p>
      </div>
      <ul class="bullet-list">
        ${summary.bulletPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}
      </ul>
      ${summary.callToAction ? `
        <div style="margin-top: 16px; padding: 12px; background: #fef3c7; border-radius: 8px; font-weight: 500;">
          ${escapeHtml(summary.callToAction)}
        </div>
      ` : ''}
    </div>
  `;
}

function generateTrendsSection(analysis: PoolAnalysisResult): string {
  if (!analysis.chemicalTrends || analysis.chemicalTrends.length === 0) {
    return '';
  }
  
  return `
    <div class="section">
      <div class="section-title">Chemical Trends</div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">
        ${analysis.chemicalTrends.map(trend => {
          const trendIcon = trend.trend === 'improving' ? '↑' : 
                           trend.trend === 'declining' ? '↓' : '→';
          const statusColor = trend.currentStatus === 'good' ? '#059669' :
                             trend.currentStatus === 'critical' ? '#dc2626' : '#d97706';
          return `
            <div style="padding: 16px; background: #f9fafb; border-radius: 8px;">
              <div style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(trend.chemical)}</div>
              <div style="display: flex; justify-content: space-between;">
                <span style="color: ${statusColor}; font-weight: 500;">${escapeHtml(trend.currentStatus)}</span>
                <span>${trendIcon} ${escapeHtml(trend.trend)}</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}
function generateRecommendationsSection(recommendations: PoolAnalysisResult['recommendations']): string {
  const allRecs = [
    ...recommendations.immediate.map(r => ({ ...r, category: 'immediate' })),
    ...recommendations.thisVisit.map(r => ({ ...r, category: 'thisVisit' })),
    ...recommendations.nextVisit.map(r => ({ ...r, category: 'nextVisit' })),
    ...recommendations.longTerm.map(r => ({ ...r, category: 'longTerm' })),
  ];
  
  if (allRecs.length === 0) {
    return '';
  }
  
  const categoryLabels: Record<string, string> = {
    immediate: 'Immediate',
    thisVisit: 'This Visit',
    nextVisit: 'Next Visit',
    longTerm: 'Long Term',
  };
  
  return `
    <div class="section">
      <div class="section-title">Recommendations</div>
      ${allRecs.map(rec => `
        <div class="recommendation-card">
          <span class="recommendation-priority priority-${escapeHtml(rec.category)}">
            ${escapeHtml(categoryLabels[rec.category])}
          </span>
          <strong>${escapeHtml(rec.action)}</strong>
          <p style="color: #6b7280; margin-top: 8px; font-size: 14px;">${escapeHtml(rec.reason)}</p>
          ${rec.dosage ? `<p style="font-size: 14px; margin-top: 4px;"><strong>Dosage:</strong> ${escapeHtml(rec.dosage)}</p>` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

function generateCostSection(costAnalysis: CostAnalysis): string {
  return `
    <div class="section page-break">
      <div class="section-title">Cost Projections</div>
      <div class="cost-grid">
        <div class="cost-card">
          <div class="cost-value">$${costAnalysis.annualEstimate.low.toFixed(0)}</div>
          <div class="cost-label">Low Estimate (Annual)</div>
        </div>
        <div class="cost-card">
          <div class="cost-value">$${costAnalysis.annualEstimate.expected.toFixed(0)}</div>
          <div class="cost-label">Expected (Annual)</div>
        </div>
        <div class="cost-card">
          <div class="cost-value">$${costAnalysis.annualEstimate.high.toFixed(0)}</div>
          <div class="cost-label">High Estimate (Annual)</div>
        </div>
      </div>
      <div style="margin-bottom: 16px;">
        <strong>Cost Trend:</strong> ${costAnalysis.costTrend}
        ${costAnalysis.highMaintenanceFlag ? '<span style="color: #dc2626; margin-left: 16px;">⚠️ High Maintenance Pool</span>' : ''}
      </div>
      ${costAnalysis.savingsOpportunities.length > 0 ? `
        <div style="background: #f0fdf4; padding: 16px; border-radius: 8px;">
          <strong style="color: #059669;">Savings Opportunities:</strong>
          <ul style="margin-top: 8px; padding-left: 20px;">
            ${costAnalysis.savingsOpportunities.map(opp => `<li>${opp}</li>`).join('')}
          </ul>
        </div>
      ` : ''}
    </div>
  `;
}

function generateCustomerReportSection(customerReport: CustomerReport): string {
  return `
    <div class="section">
      <div class="section-title">Customer Report (Shareable)</div>
      <div class="customer-report-box">
        <p style="font-weight: 600; margin-bottom: 12px;">${escapeHtml(customerReport.greeting)}</p>
        <p style="margin-bottom: 12px;">${escapeHtml(customerReport.healthSummary)}</p>
        ${customerReport.whatWeDid.length > 0 ? `
          <p style="font-weight: 600; margin-top: 16px;">What We Did:</p>
          <ul style="padding-left: 20px; margin-bottom: 12px;">
            ${customerReport.whatWeDid.map(item => `<li>${escapeHtml(item)}</li>`).join('')}
          </ul>
        ` : ''}
        <p style="margin-bottom: 12px;">${escapeHtml(customerReport.whatToExpect)}</p>
        <p style="font-style: italic; color: #059669;">${escapeHtml(customerReport.closingNote)}</p>
      </div>
      <div style="margin-top: 16px; padding: 12px; background: #f3f4f6; border-radius: 8px;">
        <strong>Shareable Text (SMS/Email):</strong>
        <p style="margin-top: 8px; font-family: monospace; font-size: 13px; white-space: pre-wrap;">${escapeHtml(customerReport.shareableText)}</p>
      </div>
    </div>
  `;
}

function generateReportFooter(analysis: PoolAnalysisResult): string {
  return `
    <div class="footer">
      <p>Report generated on ${formatDateTime(analysis.generatedAt)}</p>
      <p>Data range: ${formatDate(analysis.dataRange.start)} - ${formatDate(analysis.dataRange.end)} | ${analysis.totalServices} services analyzed</p>
      <p>Data quality: ${analysis.dataQuality} | Confidence: ${analysis.confidence}%</p>
    </div>
  `;
}

export function generateFleetCsv(insights: FleetInsights): string {
  const headers = [
    'customerId',
    'customerName',
    'healthScore',
    'urgency',
    'primaryIssue',
    'serviceDay',
    'lastService',
    'daysSinceService',
  ];
  
  return arrayToCsv(insights.priorityPools as unknown as Record<string, unknown>[], headers);
}

export function generateDetailedFleetCsv(pools: FleetPool[]): string {
  const headers = [
    'customerId',
    'customerName',
    'healthScore',
    'urgency',
    'primaryIssue',
    'serviceDay',
    'lastService',
    'daysSinceService',
  ];
  
  return arrayToCsv(pools as unknown as Record<string, unknown>[], headers);
}

export function generateServiceDayStatsCsv(insights: FleetInsights): string {
  const headers = ['day', 'poolCount', 'averageHealth', 'estimatedTime'];
  return arrayToCsv(insights.byServiceDay as unknown as Record<string, unknown>[], headers);
}

export function generateProblemClustersCsv(insights: FleetInsights): string {
  const data = insights.problemClusters.map(cluster => ({
    issue: cluster.issue,
    poolCount: cluster.pools.length,
    pools: cluster.pools.join('; '),
    suggestedAction: cluster.suggestedBatchAction,
  }));
  
  const headers = ['issue', 'poolCount', 'pools', 'suggestedAction'];
  return arrayToCsv(data, headers);
}

export function generatePoolAnalysisJson(analysis: PoolAnalysisResult): string {
  return JSON.stringify(analysis, null, 2);
}

export function generateFleetInsightsJson(insights: FleetInsights): string {
  return JSON.stringify(insights, null, 2);
}

export function exportPoolAnalysis(
  analysis: PoolAnalysisResult,
  options: Partial<ExportOptions> = {}
): ExportResult {
  const generatedAt = getCurrentTimestamp();
  const format = options.format || 'pdf';
  const branding = options.branding || DEFAULT_BRANDING;
  const dateRange = options.dateRange || analysis.dataRange;
  
  let data: Blob | string;
  let filename: string;
  
  switch (format) {
    case 'pdf':
      const html = generatePoolAnalysisHTML(analysis, branding);
      data = new Blob([html], { type: 'text/html' });
      filename = `pool-analysis-${analysis.customerId}-${generatedAt.split('T')[0]}.html`;
      break;
      
    case 'csv':
      const csvData = [
        {
          customerId: analysis.customerId,
          customerName: analysis.customerName,
          healthScore: analysis.healthScore.score,
          grade: analysis.healthScore.grade,
          trend: analysis.healthScore.trend,
          confidence: analysis.healthScore.confidence,
          dataQuality: analysis.dataQuality,
          totalServices: analysis.totalServices,
          analysisDate: analysis.analysisDate,
        },
      ];
      const headers = Object.keys(csvData[0]);
      data = arrayToCsv(csvData, headers);
      filename = `pool-analysis-${analysis.customerId}-${generatedAt.split('T')[0]}.csv`;
      break;
      
    case 'json':
      data = generatePoolAnalysisJson(analysis);
      filename = `pool-analysis-${analysis.customerId}-${generatedAt.split('T')[0]}.json`;
      break;
      
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
  
  return {
    format,
    filename,
    data,
    generatedAt,
    dataRange: dateRange,
  };
}

/**
 * Exports fleet insights in the specified format
 * 
 * Requirements:
 * - 10.4: Provide CSV format for spreadsheet analysis
 * - 10.5: Include generation timestamp and data range covered
 */
export function exportFleetInsights(
  insights: FleetInsights,
  options: Partial<ExportOptions> = {}
): ExportResult {
  const generatedAt = getCurrentTimestamp();
  const format = options.format || 'csv';
  const dateRange = options.dateRange || { start: '', end: '' };
  
  let data: Blob | string;
  let filename: string;
  
  switch (format) {
    case 'csv':
      data = generateFleetCsv(insights);
      filename = `fleet-insights-${generatedAt.split('T')[0]}.csv`;
      break;
      
    case 'json':
      data = generateFleetInsightsJson(insights);
      filename = `fleet-insights-${generatedAt.split('T')[0]}.json`;
      break;
      
    case 'pdf':
      const html = generateFleetReportHTML(insights, options.branding || DEFAULT_BRANDING, generatedAt);
      data = new Blob([html], { type: 'text/html' });
      filename = `fleet-report-${generatedAt.split('T')[0]}.html`;
      break;
      
    default:
      throw new Error(`Unsupported export format: ${format}`);
  }
  
  return {
    format,
    filename,
    data,
    generatedAt,
    dataRange: dateRange,
  };
}
function generateFleetReportHTML(
  insights: FleetInsights,
  branding: ExportBranding,
  generatedAt: string
): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Fleet Analysis Report</title>
      <style>
        ${getReportStyles(branding)}
        .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
        .stat-card { background: #f9fafb; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-value { font-size: 32px; font-weight: bold; color: ${branding.primaryColor}; }
        .stat-label { font-size: 14px; color: #6b7280; margin-top: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
        th { background: #f3f4f6; font-weight: 600; }
        .urgency-critical { color: #dc2626; font-weight: 600; }
        .urgency-high { color: #ea580c; font-weight: 600; }
        .urgency-medium { color: #d97706; }
        .urgency-low { color: #65a30d; }
        .urgency-none { color: #059669; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">${branding.companyName}</div>
        <div class="report-info">
          <div class="report-title">Fleet Analysis Report</div>
          <div class="report-date">Generated: ${formatDateTime(generatedAt)}</div>
        </div>
      </div>
      
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value">${insights.totalPools}</div>
          <div class="stat-label">Total Pools</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${insights.averageHealthScore.toFixed(1)}</div>
          <div class="stat-label">Avg Health Score</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${insights.healthDistribution.excellent + insights.healthDistribution.good}</div>
          <div class="stat-label">Healthy Pools</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${insights.alerts.length}</div>
          <div class="stat-label">Active Alerts</div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">Health Distribution</div>
        <div style="display: flex; gap: 16px;">
          <div style="flex: 1; padding: 12px; background: #d1fae5; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${insights.healthDistribution.excellent}</div>
            <div>Excellent (80-100)</div>
          </div>
          <div style="flex: 1; padding: 12px; background: #dbeafe; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${insights.healthDistribution.good}</div>
            <div>Good (60-79)</div>
          </div>
          <div style="flex: 1; padding: 12px; background: #fef3c7; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${insights.healthDistribution.fair}</div>
            <div>Fair (40-59)</div>
          </div>
          <div style="flex: 1; padding: 12px; background: #fee2e2; border-radius: 8px; text-align: center;">
            <div style="font-size: 24px; font-weight: bold;">${insights.healthDistribution.poor}</div>
            <div>Poor (0-39)</div>
          </div>
        </div>
      </div>
      
      <div class="section">
        <div class="section-title">Priority Pools (Top ${insights.priorityPools.length})</div>
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Health Score</th>
              <th>Urgency</th>
              <th>Primary Issue</th>
              <th>Days Since Service</th>
            </tr>
          </thead>
          <tbody>
            ${insights.priorityPools.map(pool => `
              <tr>
                <td>${pool.customerName}</td>
                <td>${pool.healthScore}</td>
                <td class="urgency-${pool.urgency}">${pool.urgency}</td>
                <td>${pool.primaryIssue || '-'}</td>
                <td>${pool.daysSinceService}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      ${insights.problemClusters.length > 0 ? `
        <div class="section">
          <div class="section-title">Problem Clusters</div>
          ${insights.problemClusters.map(cluster => `
            <div style="margin-bottom: 16px; padding: 16px; background: #f9fafb; border-radius: 8px;">
              <div style="font-weight: 600; margin-bottom: 8px;">${cluster.issue} (${cluster.pools.length} pools)</div>
              <div style="color: #6b7280; font-size: 14px; margin-bottom: 8px;">
                Affected: ${cluster.pools.join(', ')}
              </div>
              <div style="color: #059669; font-size: 14px;">
                <strong>Suggested Action:</strong> ${cluster.suggestedBatchAction}
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <div class="section">
        <div class="section-title">Service Day Breakdown</div>
        <table>
          <thead>
            <tr>
              <th>Day</th>
              <th>Pool Count</th>
              <th>Avg Health</th>
              <th>Est. Time (min)</th>
            </tr>
          </thead>
          <tbody>
            ${insights.byServiceDay.map(day => `
              <tr>
                <td>${day.day}</td>
                <td>${day.poolCount}</td>
                <td>${day.averageHealth.toFixed(1)}</td>
                <td>${day.estimatedTime}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      
      ${insights.alerts.length > 0 ? `
        <div class="section">
          <div class="section-title">Active Alerts</div>
          ${insights.alerts.map(alert => `
            <div style="margin-bottom: 8px; padding: 12px; background: #fef2f2; border-left: 4px solid #dc2626; border-radius: 4px;">
              <strong>${alert.type}:</strong> ${alert.message}
            </div>
          `).join('')}
        </div>
      ` : ''}
      
      <div class="footer">
        <p>Report generated on ${formatDateTime(generatedAt)}</p>
        <p>Total pools analyzed: ${insights.totalPools}</p>
      </div>
    </body>
    </html>
  `;
}


export function downloadExport(result: ExportResult): void {
  const blob = result.data instanceof Blob 
    ? result.data 
    : new Blob([result.data], { type: getContentType(result.format) });
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = result.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const PRINT_WINDOW_LOAD_TIMEOUT_MS = 500;

export function openForPrint(result: ExportResult): Promise<void> {
  return new Promise((resolve, reject) => {
    if (result.format !== 'pdf' || !(result.data instanceof Blob)) {
      reject(new Error('openForPrint only supports PDF/HTML exports'));
      return;
    }
    
    const reader = new FileReader();
    
    reader.onerror = () => {
      reject(new Error('Failed to read export data for printing'));
    };
    
    reader.onload = () => {
      try {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
          reject(new Error('Failed to open print window. Please check if popups are blocked.'));
          return;
        }
        
        printWindow.document.write(reader.result as string);
        printWindow.document.close();
        
        setTimeout(() => {
          try {
            printWindow.print();
            resolve();
          } catch (printError) {
            reject(new Error('Failed to trigger print dialog'));
          }
        }, PRINT_WINDOW_LOAD_TIMEOUT_MS);
      } catch (error) {
        reject(new Error('Failed to prepare print window'));
      }
    };
    
    reader.readAsText(result.data);
  });
}

function getContentType(format: string): string {
  switch (format) {
    case 'pdf':
      return 'text/html';
    case 'csv':
      return 'text/csv';
    case 'json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}

export function validateExportResult(result: ExportResult): boolean {
  return (
    typeof result.format === 'string' &&
    typeof result.filename === 'string' &&
    (typeof result.data === 'string' || result.data instanceof Blob) &&
    typeof result.generatedAt === 'string' &&
    typeof result.dataRange === 'object' &&
    typeof result.dataRange.start === 'string' &&
    typeof result.dataRange.end === 'string'
  );
}

export function validateExportTimestamp(result: ExportResult, toleranceMs: number = 60000): boolean {
  return isTimestampAccurate(result.generatedAt, toleranceMs);
}
