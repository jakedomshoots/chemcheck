import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  BarChart3,
  Users,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Calendar,
  Clock,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Download,
  RefreshCw,
  Activity,
  Target,
  Layers
} from 'lucide-react';
import { analyzeFleetPools, exportFleetInsights, downloadExport } from '@/lib/ai-summarizer';
import { format, parseISO } from 'date-fns';

const urgencyColors = {
  none: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  low: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  high: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  critical: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' }
};

const alertTypeIcons = {
  'score-drop': TrendingDown,
  'overdue': Clock,
  'chronic-issue': AlertTriangle
};

const alertTypeColors = {
  'score-drop': 'bg-red-50 border-red-200 text-red-800',
  'overdue': 'bg-yellow-50 border-yellow-200 text-yellow-800',
  'chronic-issue': 'bg-orange-50 border-orange-200 text-orange-800'
};

export default function FleetDashboard({ customers, serviceLogs, onSelectPool, onClose }) {
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedSections, setExpandedSections] = useState({
    overview: true,
    priority: true,
    problems: true,
    serviceDay: true,
    alerts: true
  });

  useEffect(() => {
    generateFleetAnalysis();
  }, [customers, serviceLogs]);

  const generateFleetAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!customers || customers.length === 0) {
        throw new Error('No customers available for fleet analysis');
      }

      // Prepare pool data for fleet analysis
      const pools = customers.map(customer => {
        const customerLogs = serviceLogs?.filter(log => 
          log.customer_id === customer._id || log.customerId === customer._id
        ) || [];

        // Determine service day from customer data or default
        const serviceDay = customer.service_day || 'Monday';

        return {
          customerId: customer._id,
          customerName: customer.full_name,
          serviceLogs: customerLogs.map(log => ({
            id: log._id || log.id,
            service_date: log.service_date,
            // Only include chemistry values if they exist - don't mask missing data
            ph: log.ph,
            chlorine: log.chlorine,
            alkalinity: log.alkalinity,
            stabilizer: log.stabilizer,
            salt: log.salt,
            notes: log.notes
          })),
          serviceDay,
          previousHealthScore: customer.previousHealthScore
        };
      });

      const result = analyzeFleetPools({ pools });
      setInsights(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleExportCSV = () => {
    if (!insights) return;
    const result = exportFleetInsights(insights, { format: 'csv' });
    downloadExport(result);
  };

  const handleExportPDF = () => {
    if (!insights) return;
    const result = exportFleetInsights(insights, { format: 'pdf' });
    downloadExport(result);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-md p-6 text-center">
          <div className="w-12 h-12 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Analyzing Fleet</h3>
          <p className="text-sm text-slate-600">Generating insights across all pools...</p>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
        <Card className="w-full max-w-md p-6 text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">Analysis Error</h3>
          <p className="text-sm text-slate-600 mb-4">{error}</p>
          <Button onClick={onClose} variant="outline" className="w-full">
            Close
          </Button>
        </Card>
      </div>
    );
  }

  if (!insights) return null;

  const { totalPools, averageHealthScore, healthDistribution, priorityPools, problemClusters, byServiceDay, alerts } = insights;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <Card className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl">
                <Layers className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-slate-900">Fleet Dashboard</h2>
                <p className="text-sm text-slate-600">{totalPools} pools analyzed</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={generateFleetAnalysis} variant="outline" size="sm" className="gap-1">
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
              <Button onClick={handleExportCSV} variant="outline" size="sm" className="gap-1">
                <Download className="w-4 h-4" />
                CSV
              </Button>
              <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1">
                <Download className="w-4 h-4" />
                PDF
              </Button>
              <Button onClick={onClose} variant="outline" size="sm">
                Close
              </Button>
            </div>
          </div>

          {/* Fleet Health Overview - Requirement 7.1 */}
          <Card className="mb-6 border-2">
            <div 
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
              onClick={() => toggleSection('overview')}
            >
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-slate-900">Fleet Health Overview</h3>
              </div>
              {expandedSections.overview ? 
                <ChevronUp className="w-5 h-5 text-slate-400" /> : 
                <ChevronDown className="w-5 h-5 text-slate-400" />
              }
            </div>
            
            {expandedSections.overview && (
              <div className="px-4 pb-4">
                {/* Stats Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  <div className="bg-slate-50 p-4 rounded-lg text-center">
                    <Users className="w-6 h-6 text-slate-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-slate-900">{totalPools}</div>
                    <div className="text-xs text-slate-600">Total Pools</div>
                  </div>
                  <div className="bg-purple-50 p-4 rounded-lg text-center">
                    <Activity className="w-6 h-6 text-purple-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-purple-700">{averageHealthScore.toFixed(1)}</div>
                    <div className="text-xs text-slate-600">Avg Health Score</div>
                  </div>
                  <div className="bg-green-50 p-4 rounded-lg text-center">
                    <CheckCircle2 className="w-6 h-6 text-green-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-green-700">{healthDistribution.excellent + healthDistribution.good}</div>
                    <div className="text-xs text-slate-600">Healthy Pools</div>
                  </div>
                  <div className="bg-red-50 p-4 rounded-lg text-center">
                    <AlertTriangle className="w-6 h-6 text-red-600 mx-auto mb-2" />
                    <div className="text-2xl font-bold text-red-700">{alerts.length}</div>
                    <div className="text-xs text-slate-600">Active Alerts</div>
                  </div>
                </div>

                {/* Health Distribution */}
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-slate-700 mb-3">Health Distribution</h4>
                  <div className="grid grid-cols-4 gap-2">
                    <div className="bg-green-100 p-3 rounded-lg text-center border border-green-200">
                      <div className="text-xl font-bold text-green-700">{healthDistribution.excellent}</div>
                      <div className="text-xs text-green-600">Excellent (80-100)</div>
                    </div>
                    <div className="bg-blue-100 p-3 rounded-lg text-center border border-blue-200">
                      <div className="text-xl font-bold text-blue-700">{healthDistribution.good}</div>
                      <div className="text-xs text-blue-600">Good (60-79)</div>
                    </div>
                    <div className="bg-yellow-100 p-3 rounded-lg text-center border border-yellow-200">
                      <div className="text-xl font-bold text-yellow-700">{healthDistribution.fair}</div>
                      <div className="text-xs text-yellow-600">Fair (40-59)</div>
                    </div>
                    <div className="bg-red-100 p-3 rounded-lg text-center border border-red-200">
                      <div className="text-xl font-bold text-red-700">{healthDistribution.poor}</div>
                      <div className="text-xs text-red-600">Poor (0-39)</div>
                    </div>
                  </div>
                </div>

                {/* Health Bar */}
                <div className="h-4 rounded-full overflow-hidden flex bg-slate-200">
                  {totalPools > 0 && (
                    <>
                      <div 
                        className="bg-green-500 transition-all" 
                        style={{ width: `${(healthDistribution.excellent / totalPools) * 100}%` }}
                      />
                      <div 
                        className="bg-blue-500 transition-all" 
                        style={{ width: `${(healthDistribution.good / totalPools) * 100}%` }}
                      />
                      <div 
                        className="bg-yellow-500 transition-all" 
                        style={{ width: `${(healthDistribution.fair / totalPools) * 100}%` }}
                      />
                      <div 
                        className="bg-red-500 transition-all" 
                        style={{ width: `${(healthDistribution.poor / totalPools) * 100}%` }}
                      />
                    </>
                  )}
                </div>
              </div>
            )}
          </Card>

          {/* Priority Pools - Requirement 7.3 */}
          {priorityPools && priorityPools.length > 0 && (
            <Card className="mb-6 border-2 border-orange-200">
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('priority')}
              >
                <div className="flex items-center gap-2">
                  <Target className="w-5 h-5 text-orange-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Priority Pools</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
                    Top {priorityPools.length} needing attention
                  </span>
                </div>
                {expandedSections.priority ? 
                  <ChevronUp className="w-5 h-5 text-slate-400" /> : 
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>
              
              {expandedSections.priority && (
                <div className="px-4 pb-4">
                  <div className="space-y-2">
                    {priorityPools.map((pool, idx) => {
                      const urgencyStyle = urgencyColors[pool.urgency] || urgencyColors.medium;
                      
                      return (
                        <div 
                          key={pool.customerId}
                          className={`p-4 rounded-lg border ${urgencyStyle.bg} ${urgencyStyle.border} cursor-pointer hover:opacity-90 transition-opacity`}
                          onClick={() => onSelectPool?.(pool.customerId)}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${urgencyStyle.bg} border ${urgencyStyle.border}`}>
                                <span className={`text-sm font-bold ${urgencyStyle.text}`}>{idx + 1}</span>
                              </div>
                              <div>
                                <div className="font-medium text-slate-900">{pool.customerName}</div>
                                <div className="text-xs text-slate-600">
                                  {pool.serviceDay} • {pool.daysSinceService} days since service
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`text-xl font-bold ${urgencyStyle.text}`}>{pool.healthScore}</div>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${urgencyStyle.bg} ${urgencyStyle.text} border ${urgencyStyle.border}`}>
                                {pool.urgency}
                              </span>
                            </div>
                          </div>
                          {pool.primaryIssue && (
                            <div className="mt-2 text-sm text-slate-700">
                              <span className="font-medium">Issue:</span> {pool.primaryIssue}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Problem Clusters - Requirement 7.2 */}
          {problemClusters && problemClusters.length > 0 && (
            <Card className="mb-6 border-2">
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('problems')}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Problem Clusters</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-700">
                    {problemClusters.length} issue types
                  </span>
                </div>
                {expandedSections.problems ? 
                  <ChevronUp className="w-5 h-5 text-slate-400" /> : 
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>
              
              {expandedSections.problems && (
                <div className="px-4 pb-4 space-y-3">
                  {problemClusters.map((cluster, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-yellow-600" />
                          <span className="font-medium text-slate-900">{cluster.issue}</span>
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                          {cluster.pools.length} pools
                        </span>
                      </div>
                      <div className="text-sm text-slate-600 mb-2">
                        <span className="font-medium">Affected:</span> {cluster.pools.join(', ')}
                      </div>
                      <div className="text-sm text-green-700 bg-green-50 p-2 rounded border border-green-200">
                        <span className="font-medium">Suggested Action:</span> {cluster.suggestedBatchAction}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Service Day Breakdown - Requirement 7.4 */}
          {byServiceDay && byServiceDay.length > 0 && (
            <Card className="mb-6 border-2">
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('serviceDay')}
              >
                <div className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Service Day Breakdown</h3>
                </div>
                {expandedSections.serviceDay ? 
                  <ChevronUp className="w-5 h-5 text-slate-400" /> : 
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>
              
              {expandedSections.serviceDay && (
                <div className="px-4 pb-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left py-2 px-3 font-medium text-slate-700">Day</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-700">Pools</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-700">Avg Health</th>
                          <th className="text-center py-2 px-3 font-medium text-slate-700">Est. Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {byServiceDay.map((day) => (
                          <tr key={day.day} className="border-b border-slate-100 hover:bg-slate-50">
                            <td className="py-3 px-3 font-medium text-slate-900">{day.day}</td>
                            <td className="py-3 px-3 text-center">{day.poolCount}</td>
                            <td className="py-3 px-3 text-center">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                                day.averageHealth >= 80 ? 'bg-green-100 text-green-700' :
                                day.averageHealth >= 60 ? 'bg-blue-100 text-blue-700' :
                                day.averageHealth >= 40 ? 'bg-yellow-100 text-yellow-700' :
                                'bg-red-100 text-red-700'
                              }`}>
                                {day.averageHealth.toFixed(1)}
                              </span>
                            </td>
                            <td className="py-3 px-3 text-center text-slate-600">
                              {Math.floor(day.estimatedTime / 60)}h {day.estimatedTime % 60}m
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Alerts */}
          {alerts && alerts.length > 0 && (
            <Card className="border-2 border-red-200">
              <div 
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('alerts')}
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Active Alerts</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                    {alerts.length} alerts
                  </span>
                </div>
                {expandedSections.alerts ? 
                  <ChevronUp className="w-5 h-5 text-slate-400" /> : 
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>
              
              {expandedSections.alerts && (
                <div className="px-4 pb-4 space-y-2">
                  {alerts.map((alert, idx) => {
                    const AlertIcon = alertTypeIcons[alert.type] || AlertCircle;
                    const colorClass = alertTypeColors[alert.type] || alertTypeColors['chronic-issue'];
                    
                    return (
                      <div 
                        key={idx}
                        className={`p-3 rounded-lg border ${colorClass} flex items-start gap-3`}
                      >
                        <AlertIcon className="w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium uppercase">
                              {alert.type.replace('-', ' ')}
                            </span>
                          </div>
                          <p className="text-sm">{alert.message}</p>
                        </div>
                        {onSelectPool && (
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => onSelectPool?.(alert.poolId)}
                            className="flex-shrink-0"
                          >
                            View
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* No Alerts Message */}
          {(!alerts || alerts.length === 0) && (
            <Card className="border-2 border-green-200">
              <div className="p-6 text-center">
                <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-3" />
                <h3 className="text-lg font-semibold text-slate-900 mb-1">All Clear!</h3>
                <p className="text-sm text-slate-600">No active alerts. Your fleet is in good shape.</p>
              </div>
            </Card>
          )}
        </Card>
      </div>
    </div>
  );
}
