import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { PoolAnalysisSkeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Lightbulb,
  Calendar,
  BarChart3,
  Target,
  Clock,
  Zap,
  ChevronDown,
  ChevronUp,
  Activity,
  Download,
  Share2,
  FileText,
  Star,
  Eye,
  Copy,
  Check,
  RefreshCw,
  Mail,
  Edit,
  Save
} from 'lucide-react';
import { analyzePool, exportPoolAnalysis, downloadExport } from '@/lib/ai-summarizer';
import { format, parseISO } from 'date-fns';

const trendIcons = {
  improving: { icon: TrendingUp, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200' },
  declining: { icon: TrendingDown, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' },
  stable: { icon: Minus, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  erratic: { icon: Activity, color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' }
};

const severityConfig = {
  low: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50' },
  medium: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50' },
  high: { icon: AlertCircle, color: 'text-orange-600', bg: 'bg-orange-50' },
  critical: { icon: XCircle, color: 'text-red-600', bg: 'bg-red-50' }
};

const gradeColors = {
  A: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  B: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  C: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  D: { bg: 'bg-orange-100', text: 'text-orange-700', border: 'border-orange-300' },
  F: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' }
};

// Simple cache for analysis results (persists during session)
const analysisCache = new Map();

// Sparkline component for chemical trends
function ChemicalSparkline({ readings, color = '#0ea5e9' }) {
  if (!readings || readings.length < 2) return null;

  const width = 60;
  const height = 24;
  const padding = 2;

  // Normalize readings to 0-100 scale
  const normalizedReadings = readings.map(r => {
    if (r === 'good') return 100;
    if (r === 'low' || r === 'high') return 50;
    if (r === 'critical') return 0;
    return 50;
  });

  const points = normalizedReadings.slice(-8).map((val, i, arr) => {
    const x = padding + (i / (arr.length - 1)) * (width - padding * 2);
    const y = height - padding - (val / 100) * (height - padding * 2);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="inline-block mt-1">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Animated score ring component
function AnimatedScoreRing({ score, grade, gradeStyle }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const [strokeDashoffset, setStrokeDashoffset] = useState(352);
  const animationRef = useRef(null);

  useEffect(() => {
    const duration = 1200;
    const startTime = Date.now();
    const targetOffset = 352 - (score / 100) * 352;

    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);

      setAnimatedScore(Math.round(score * eased));
      setStrokeDashoffset(352 - (score / 100) * 352 * eased);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [score]);

  // Get stroke color based on grade
  const strokeColor = {
    A: '#22c55e',
    B: '#3b82f6',
    C: '#eab308',
    D: '#f97316',
    F: '#ef4444'
  }[grade] || '#0ea5e9';

  return (
    <div className="relative w-32 h-32">
      <svg className="w-32 h-32 -rotate-90" viewBox="0 0 128 128">
        {/* Background circle */}
        <circle
          cx="64"
          cy="64"
          r="56"
          fill="none"
          stroke="#e2e8f0"
          strokeWidth="8"
        />
        {/* Animated progress circle */}
        <circle
          cx="64"
          cy="64"
          r="56"
          fill="none"
          stroke={strokeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray="352"
          strokeDashoffset={strokeDashoffset}
          style={{ transition: 'stroke 0.3s ease' }}
        />
      </svg>
      {/* Score text overlay */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="text-center">
          <div className={`text-4xl font-bold ${gradeStyle.text}`}>{animatedScore}</div>
          <div className={`text-lg font-semibold ${gradeStyle.text}`}>Grade {grade}</div>
        </div>
      </div>
    </div>
  );
}

export default function PoolAnalysisPanel({ customer, serviceLogs, onClose }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCustomerReport, setShowCustomerReport] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    healthScore: true,
    predictions: true,
    trends: true,
    problems: true,
    recommendations: true,
    customerReport: false
  });
  const [isEditingReport, setIsEditingReport] = useState(false);
  const [editedReport, setEditedReport] = useState(null);

  // Cache key based on customer ID and log count/latest date
  const cacheKey = useMemo(() => {
    const latestLog = serviceLogs?.[0]?.service_date || '';
    return `${customer._id}-${serviceLogs?.length || 0}-${latestLog}`;
  }, [customer._id, serviceLogs]);

  useEffect(() => {
    // Check cache first
    if (analysisCache.has(cacheKey)) {
      setAnalysis(analysisCache.get(cacheKey));
      setLoading(false);
      return;
    }
    generateAnalysis();
  }, [customer, serviceLogs, cacheKey]);

  const generateAnalysis = async () => {
    try {
      setLoading(true);
      setError(null);

      if (!serviceLogs || serviceLogs.length === 0) {
        throw new Error('No service history available for analysis');
      }

      // Use the new AI Pool Summarizer
      const result = analyzePool({
        customerId: customer._id,
        customerName: customer.full_name,
        poolType: customer.pool_type || 'standard',
        poolGallons: customer.pool_gallons || null,
        serviceLogs: serviceLogs.map(log => ({
          id: log._id || log.id,
          service_date: log.service_date,
          ph: log.ph || 'good',
          chlorine: log.chlorine || 'good',
          alkalinity: log.alkalinity || 'good',
          stabilizer: log.stabilizer || 'good',
          salt: log.salt,
          notes: log.notes
        })),
        includeWeather: false,
        includeCosts: true,
        includeLearning: true
      });

      // Cache the result
      analysisCache.set(cacheKey, result);
      setAnalysis(result);
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

  const handleExportPDF = () => {
    if (!analysis) return;
    const result = exportPoolAnalysis(analysis, { format: 'pdf' });
    downloadExport(result);
  };

  const handleShare = async () => {
    if (!analysis?.customerReport?.shareableText) return;

    const shareText = analysis.customerReport.shareableText;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Pool Report - ${customer.full_name}`,
          text: shareText
        });
      } catch (err) {
        // User cancelled or share failed, fall back to copy
        copyToClipboard(shareText);
      }
    } else {
      copyToClipboard(shareText);
    }
  };

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  // Force refresh analysis (clears cache)
  const handleRefresh = () => {
    analysisCache.delete(cacheKey);
    setLoading(true);
    setAnalysis(null);
    generateAnalysis();
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
        <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
          <Card className="p-6">
            <PoolAnalysisSkeleton />
          </Card>
        </div>
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

  const { healthScore, predictiveInsights, chemicalTrends, problems, recommendations, customerReport, professionalSummary } = analysis || {};
  const gradeStyle = gradeColors[healthScore?.grade] || gradeColors.C;

  // Safe date parsing helper
  const safeFormatDate = (dateStr, formatStr) => {
    if (!dateStr) return 'N/A';
    try {
      return format(parseISO(dateStr), formatStr);
    } catch (e) {
      return 'Invalid date';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <Card className="p-6">
          {/* Header with Actions - Mobile Optimized */}
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-slate-800 rounded-lg flex-shrink-0">
                <BarChart3 className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 truncate">AI Pool Analysis</h2>
                <p className="text-xs sm:text-sm text-slate-500 truncate">{customer.full_name} • {analysis?.totalServices || 0} services analyzed</p>
              </div>
            </div>
            {/* Action buttons - separate row for mobile */}
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleExportPDF} variant="outline" size="sm" className="gap-1 h-9">
                <Download className="w-4 h-4" />
                PDF
              </Button>
              <Button onClick={handleShare} variant="outline" size="sm" className="gap-1 h-9">
                {copied ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {copied ? 'Copied!' : 'Share'}
              </Button>
              <Button onClick={handleRefresh} variant="outline" size="sm" className="gap-1 h-9">
                <RefreshCw className="w-4 h-4" />
                Refresh
              </Button>
              <Button onClick={onClose} variant="outline" size="sm" className="h-9">
                Close
              </Button>
            </div>
          </div>

          {/* Health Score Card - Requirement 1.2 */}
          <Card className="mb-6 border border-slate-200">
            <div
              className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
              onClick={() => toggleSection('healthScore')}
            >
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-cyan-600" />
                <h3 className="text-lg font-semibold text-slate-900">Pool Health Score</h3>
              </div>
              {expandedSections.healthScore ?
                <ChevronUp className="w-5 h-5 text-slate-400" /> :
                <ChevronDown className="w-5 h-5 text-slate-400" />
              }
            </div>

            {expandedSections.healthScore && healthScore && (
              <div className="px-4 pb-4">
                <div className="flex items-center justify-center gap-6 mb-4">
                  {/* Animated Score Ring */}
                  <AnimatedScoreRing
                    score={healthScore.score}
                    grade={healthScore.grade}
                    gradeStyle={gradeStyle}
                  />

                  {/* Score Details */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      {React.createElement(trendIcons[healthScore.trend]?.icon || Minus, {
                        className: `w-5 h-5 ${trendIcons[healthScore.trend]?.color || 'text-slate-600'}`
                      })}
                      <span className="text-sm font-medium capitalize">{healthScore.trend} Trend</span>
                    </div>
                    <div className="text-sm text-slate-600">
                      Confidence: {healthScore.confidence}%
                    </div>
                    <div className="text-sm text-slate-600">
                      Data Quality: <span className="capitalize">{analysis?.dataQuality}</span>
                    </div>
                  </div>
                </div>

                {/* Chemical Breakdown with Sparklines */}
                {healthScore.breakdown && healthScore.breakdown.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {healthScore.breakdown.map((item) => {
                      // Get readings history for this chemical from service logs
                      const readings = serviceLogs?.slice(0, 8).map(log => log[item.chemical]).reverse() || [];
                      const sparkColor = item.score >= 80 ? '#22c55e' : item.score >= 50 ? '#eab308' : '#ef4444';

                      return (
                        <div key={item.chemical} className="bg-slate-50 p-3 rounded-lg text-center">
                          <div className="text-xs text-slate-600 capitalize mb-1">{item.chemical}</div>
                          <div className="text-xl font-bold text-slate-900">{Math.round(item.score)}</div>
                          <ChemicalSparkline readings={readings} color={sparkColor} />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Predictive Insights - Requirement 2.1 */}
          {predictiveInsights && (
            <Card className="mb-6 border border-slate-200">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('predictions')}
              >
                <div className="flex items-center gap-2">
                  <Eye className="w-5 h-5 text-purple-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Predictive Insights</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${predictiveInsights.overallOutlook === 'stable' ? 'bg-slate-100 text-green-600' :
                    predictiveInsights.overallOutlook === 'attention-needed' ? 'bg-slate-100 text-yellow-600' :
                      'bg-slate-100 text-red-600'
                    }`}>
                    {predictiveInsights.overallOutlook.replace('-', ' ')}
                  </span>
                </div>
                {expandedSections.predictions ?
                  <ChevronUp className="w-5 h-5 text-slate-400" /> :
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>

              {expandedSections.predictions && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Next Service Recommendation */}
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-2 mb-2">
                      <Calendar className="w-4 h-4 text-slate-500" />
                      <span className="font-medium text-sm">Next Service</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${predictiveInsights.nextServiceRecommendation.urgency === 'urgent' ? 'bg-slate-100 text-red-600' :
                        predictiveInsights.nextServiceRecommendation.urgency === 'soon' ? 'bg-slate-100 text-yellow-600' :
                          'bg-slate-100 text-green-600'
                        }`}>
                        {predictiveInsights.nextServiceRecommendation.urgency}
                      </span>
                    </div>
                    <p className="text-sm text-slate-600">{predictiveInsights.nextServiceRecommendation.reason}</p>
                    <p className="text-sm font-medium text-slate-700 mt-1">
                      Suggested: {safeFormatDate(predictiveInsights.nextServiceRecommendation?.suggestedDate, 'MMM d, yyyy')}
                    </p>
                  </div>

                  {/* Chemical Predictions */}
                  {predictiveInsights.predictions && predictiveInsights.predictions.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-medium text-slate-900">Chemical Predictions</h4>
                      {predictiveInsights.predictions.map((pred, idx) => (
                        <div key={idx} className="p-3 bg-slate-50 rounded-lg">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium capitalize">{pred.chemical}</span>
                            <span className="text-xs text-slate-600">{pred.confidence}% confidence</span>
                          </div>
                          <div className="text-sm text-slate-700">
                            {pred.currentLevel} → {pred.predictedLevel}
                            {pred.daysUntilCritical && (
                              <span className="text-red-600 ml-2">
                                ({pred.daysUntilCritical} days until critical)
                              </span>
                            )}
                          </div>
                          {pred.recommendedAction && (
                            <p className="text-xs text-slate-600 mt-1">{pred.recommendedAction}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Seasonal Factors */}
                  {predictiveInsights.seasonalFactors && predictiveInsights.seasonalFactors.length > 0 && (
                    <div className="text-sm text-slate-600">
                      <span className="font-medium">Seasonal factors: </span>
                      {predictiveInsights.seasonalFactors.join(', ')}
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Chemical Trends */}
          {chemicalTrends && chemicalTrends.length > 0 && (
            <Card className="mb-6 border border-slate-200">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('trends')}
              >
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-cyan-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Chemical Trends</h3>
                </div>
                {expandedSections.trends ?
                  <ChevronUp className="w-5 h-5 text-slate-400" /> :
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>

              {expandedSections.trends && (
                <div className="px-4 pb-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                  {chemicalTrends.map((trend) => {
                    const config = trendIcons[trend.trend] || trendIcons.stable;
                    const TrendIcon = config.icon;

                    return (
                      <div key={trend.chemical} className={`p-3 rounded-lg border ${config.bg} ${config.border}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2">
                            <TrendIcon className={`w-4 h-4 ${config.color}`} />
                            <span className="font-medium text-slate-900 capitalize">{trend.chemical}</span>
                          </div>
                          <span className="text-xs text-slate-600">{Math.round(trend.confidence)}% confidence</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className={`capitalize ${trend.currentStatus === 'good' ? 'text-green-600' :
                            trend.currentStatus === 'critical' ? 'text-red-600' :
                              'text-yellow-600'
                            }`}>
                            Current: {trend.currentStatus}
                          </span>
                          <span className={`capitalize ${config.color}`}>{trend.trend}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Problems */}
          {problems && problems.length > 0 && (
            <Card className="mb-6 border border-slate-200">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('problems')}
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-orange-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Detected Issues</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-orange-600">
                    {problems.length} found
                  </span>
                </div>
                {expandedSections.problems ?
                  <ChevronUp className="w-5 h-5 text-slate-400" /> :
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>

              {expandedSections.problems && (
                <div className="px-4 pb-4 space-y-3">
                  {problems.map((problem) => {
                    const config = severityConfig[problem.severity] || severityConfig.low;
                    const SeverityIcon = config.icon;

                    return (
                      <div key={problem.id} className={`p-4 rounded-lg border ${config.bg}`}>
                        <div className="flex items-start gap-3">
                          <SeverityIcon className={`w-5 h-5 ${config.color} mt-0.5 flex-shrink-0`} />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium text-slate-900 capitalize">{problem.chemical}</h4>
                              <span className={`text-xs px-2 py-0.5 rounded-full ${config.bg} ${config.color} font-medium border`}>
                                {problem.severity}
                              </span>
                            </div>
                            <p className="text-sm text-slate-700 mb-2">{problem.description}</p>
                            <div className="text-xs text-slate-600">
                              Occurrences: {problem.occurrences || 0}
                              {problem.firstDetected && ` • First: ${safeFormatDate(problem.firstDetected, 'MMM d')}`}
                              {problem.lastDetected && ` • Last: ${safeFormatDate(problem.lastDetected, 'MMM d')}`}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          {/* Recommendations */}
          {recommendations && (
            <Card className="mb-6 border border-slate-200">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('recommendations')}
              >
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-yellow-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Recommendations</h3>
                </div>
                {expandedSections.recommendations ?
                  <ChevronUp className="w-5 h-5 text-slate-400" /> :
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>

              {expandedSections.recommendations && (
                <div className="px-4 pb-4 space-y-4">
                  {recommendations.immediate && recommendations.immediate.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Zap className="w-4 h-4 text-red-600" />
                        <h4 className="font-medium text-slate-900">Immediate Actions</h4>
                      </div>
                      <div className="space-y-2">
                        {recommendations.immediate.map((rec) => (
                          <div key={rec.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 border-l-2 border-l-red-500">
                            <p className="text-sm font-medium text-slate-900">{rec.action}</p>
                            <p className="text-xs text-slate-600 mt-1">{rec.reason}</p>
                            {rec.dosage && (
                              <p className="text-xs text-red-600 mt-1 font-medium">Dosage: {rec.dosage}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {recommendations.thisVisit && recommendations.thisVisit.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Target className="w-4 h-4 text-orange-600" />
                        <h4 className="font-medium text-slate-900">This Visit</h4>
                      </div>
                      <div className="space-y-2">
                        {recommendations.thisVisit.map((rec) => (
                          <div key={rec.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 border-l-2 border-l-orange-500">
                            <p className="text-sm font-medium text-slate-900">{rec.action}</p>
                            <p className="text-xs text-slate-600 mt-1">{rec.reason}</p>
                            {rec.dosage && (
                              <p className="text-xs text-orange-600 mt-1 font-medium">Dosage: {rec.dosage}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {recommendations.nextVisit && recommendations.nextVisit.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Calendar className="w-4 h-4 text-blue-600" />
                        <h4 className="font-medium text-slate-900">Next Visit</h4>
                      </div>
                      <div className="space-y-2">
                        {recommendations.nextVisit.map((rec) => (
                          <div key={rec.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 border-l-2 border-l-blue-500">
                            <p className="text-sm font-medium text-slate-900">{rec.action}</p>
                            <p className="text-xs text-slate-600 mt-1">{rec.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {recommendations.longTerm && recommendations.longTerm.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Clock className="w-4 h-4 text-slate-600" />
                        <h4 className="font-medium text-slate-900">Long Term</h4>
                      </div>
                      <div className="space-y-2">
                        {recommendations.longTerm.map((rec) => (
                          <div key={rec.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                            <p className="text-sm font-medium text-slate-900">{rec.action}</p>
                            <p className="text-xs text-slate-600 mt-1">{rec.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* Customer Report - Requirement 4.1 */}
          {customerReport && (
            <Card className="mb-6 border border-slate-200">
              <div
                className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-50"
                onClick={() => toggleSection('customerReport')}
              >
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-green-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Customer Report</h3>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-green-600">
                    Ready to share
                  </span>
                </div>
                {expandedSections.customerReport ?
                  <ChevronUp className="w-5 h-5 text-slate-400" /> :
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                }
              </div>

              {expandedSections.customerReport && (
                <div className="px-4 pb-4">
                  {/* Action Buttons */}
                  <div className="flex gap-2 mb-4">
                    {!isEditingReport ? (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditedReport({
                              greeting: customerReport.greeting,
                              healthSummary: customerReport.healthSummary,
                              whatWeDid: [...(customerReport.whatWeDid || [])],
                              whatToExpect: customerReport.whatToExpect,
                              recommendations: [...(customerReport.recommendations || [])],
                              closingNote: customerReport.closingNote
                            });
                            setIsEditingReport(true);
                          }}
                          className="gap-1"
                        >
                          <Edit className="w-3 h-3" />
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                          onClick={() => {
                            const subject = `Pool Service Report - ${customer.full_name}`;
                            const body = customerReport.shareableText;
                            window.location.href = `mailto:${customer.email || ''}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
                          }}
                        >
                          <Mail className="w-3 h-3" />
                          Email Report
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          className="gap-1 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700 text-white"
                          onClick={() => {
                            // Save changes back to analysis object
                            customerReport.greeting = editedReport.greeting;
                            customerReport.healthSummary = editedReport.healthSummary;
                            customerReport.whatWeDid = editedReport.whatWeDid;
                            customerReport.whatToExpect = editedReport.whatToExpect;
                            customerReport.recommendations = editedReport.recommendations;
                            customerReport.closingNote = editedReport.closingNote;
                            setIsEditingReport(false);
                          }}
                        >
                          <Save className="w-3 h-3" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setIsEditingReport(false);
                            setEditedReport(null);
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                  </div>

                  {/* Report Content */}
                  <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 mb-4">
                    {!isEditingReport ? (
                      <>
                        <p className="font-medium text-slate-900 mb-2">{customerReport.greeting}</p>
                        <p className="text-sm text-slate-700 mb-3">{customerReport.healthSummary}</p>

                        {customerReport.whatWeDid && customerReport.whatWeDid.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm font-medium text-slate-900 mb-1">What We Did:</p>
                            <ul className="text-sm text-slate-700 space-y-1">
                              {customerReport.whatWeDid.map((item, idx) => (
                                <li key={idx}>• {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <p className="text-sm text-slate-700 mb-3">{customerReport.whatToExpect}</p>

                        {customerReport.recommendations && customerReport.recommendations.length > 0 && (
                          <div className="mb-3">
                            <p className="text-sm font-medium text-slate-900 mb-1">Recommendations:</p>
                            <ul className="text-sm text-slate-700 space-y-1">
                              {customerReport.recommendations.map((rec, idx) => (
                                <li key={idx}>• {rec}</li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <p className="text-sm text-green-700 italic">{customerReport.closingNote}</p>
                      </>
                    ) : (
                      <>
                        <div className="mb-3">
                          <label className="text-xs font-medium text-slate-600 mb-1 block">Greeting</label>
                          <input
                            type="text"
                            value={editedReport.greeting}
                            onChange={(e) => setEditedReport({ ...editedReport, greeting: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </div>

                        <div className="mb-3">
                          <label className="text-xs font-medium text-slate-600 mb-1 block">Health Summary</label>
                          <textarea
                            value={editedReport.healthSummary}
                            onChange={(e) => setEditedReport({ ...editedReport, healthSummary: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </div>

                        <div className="mb-3">
                          <label className="text-xs font-medium text-slate-600 mb-1 block">What We Did (one per line)</label>
                          <textarea
                            value={editedReport.whatWeDid.join('\n')}
                            onChange={(e) => setEditedReport({ ...editedReport, whatWeDid: e.target.value.split('\n').filter(Boolean) })}
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </div>

                        <div className="mb-3">
                          <label className="text-xs font-medium text-slate-600 mb-1 block">What to Expect</label>
                          <textarea
                            value={editedReport.whatToExpect}
                            onChange={(e) => setEditedReport({ ...editedReport, whatToExpect: e.target.value })}
                            rows={2}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </div>

                        <div className="mb-3">
                          <label className="text-xs font-medium text-slate-600 mb-1 block">Recommendations (one per line)</label>
                          <textarea
                            value={editedReport.recommendations.join('\n')}
                            onChange={(e) => setEditedReport({ ...editedReport, recommendations: e.target.value.split('\n').filter(Boolean) })}
                            rows={3}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </div>

                        <div>
                          <label className="text-xs font-medium text-slate-600 mb-1 block">Closing Note</label>
                          <input
                            type="text"
                            value={editedReport.closingNote}
                            onChange={(e) => setEditedReport({ ...editedReport, closingNote: e.target.value })}
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-500"
                          />
                        </div>
                      </>
                    )}
                  </div>

                  {/* Shareable Text */}
                  <div className="bg-slate-100 p-4 rounded-lg">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-slate-700">Shareable Text (SMS/Email)</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(customerReport.shareableText)}
                        className="gap-1"
                      >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? 'Copied!' : 'Copy'}
                      </Button>
                    </div>
                    <p className="text-sm text-slate-600 whitespace-pre-wrap font-mono bg-white p-3 rounded border">
                      {customerReport.shareableText}
                    </p>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* Professional Summary */}
          {professionalSummary && (
            <Card className="border border-slate-200">
              <div className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="w-5 h-5 text-cyan-600" />
                  <h3 className="text-lg font-semibold text-slate-900">Summary</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${professionalSummary.tone === 'positive' ? 'bg-slate-100 text-green-600' :
                    professionalSummary.tone === 'neutral' ? 'bg-slate-100 text-slate-600' :
                      professionalSummary.tone === 'concerned' ? 'bg-slate-100 text-yellow-600' :
                        'bg-slate-100 text-red-600'
                    }`}>
                    {professionalSummary.tone}
                  </span>
                </div>

                <h4 className="font-medium text-slate-900 mb-2">{professionalSummary.headline}</h4>
                <p className="text-sm text-slate-700 mb-4">{professionalSummary.paragraph}</p>

                {professionalSummary.bulletPoints && professionalSummary.bulletPoints.length > 0 && (
                  <ul className="text-sm text-slate-700 space-y-1 mb-4">
                    {professionalSummary.bulletPoints.map((point, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 text-cyan-600 mt-0.5 flex-shrink-0" />
                        {point}
                      </li>
                    ))}
                  </ul>
                )}

                {professionalSummary.callToAction && (
                  <div className="p-3 bg-cyan-50 rounded-lg border border-cyan-200">
                    <p className="text-sm font-medium text-cyan-800">{professionalSummary.callToAction}</p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </Card>
      </div>
    </div >
  );
}
