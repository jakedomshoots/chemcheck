/**
 * Natural Language Generator
 * 
 * Transforms structured pool analysis data into human-readable summaries.
 * Generates professional summaries for technicians and customer-friendly reports
 * for pool owners.
 * 
 * Requirements: 1.1, 4.1, 4.2, 4.3, 4.5
 */

import type {
  GeneratedSummary,
  CustomerReport,
  SummaryOptions,
  SummaryTone,
  PoolHealthScore,
  ChemicalTrend,
  PoolProblem,
  Recommendation,
  CategorizedRecommendations,
  RootCauseAnalysis,
  PredictiveInsights,
  CostAnalysis,
  WeatherImpact,
  HealthGrade,
} from './types';

export interface LanguageGeneratorInput {
  customerName: string;
  healthScore: PoolHealthScore;
  chemicalTrends: ChemicalTrend[];
  problems: PoolProblem[];
  recommendations: CategorizedRecommendations;
  rootCauseAnalysis?: RootCauseAnalysis;
  predictiveInsights?: PredictiveInsights;
  costAnalysis?: CostAnalysis;
  weatherImpact?: WeatherImpact;
  recentActions?: string[];
}

/**
 * Determines the appropriate tone based on health score
 * Requirement 4.2, 4.3: Use friendly, reassuring tone while remaining accurate
 */
export function determineTone(healthScore: number): SummaryTone {
  if (healthScore >= 80) return 'positive';
  if (healthScore >= 60) return 'neutral';
  if (healthScore >= 40) return 'concerned';
  return 'urgent';
}

/**
 * Gets a grade description for professional summaries
 */
function getGradeDescription(grade: HealthGrade): string {
  const descriptions: Record<HealthGrade, string> = {
    'A': 'excellent condition',
    'B': 'good condition',
    'C': 'fair condition requiring attention',
    'D': 'poor condition requiring immediate attention',
    'F': 'critical condition requiring urgent intervention',
  };
  return descriptions[grade];
}

/**
 * Gets a customer-friendly grade description
 */
function getCustomerGradeDescription(grade: HealthGrade): string {
  const descriptions: Record<HealthGrade, string> = {
    'A': 'Your pool is in great shape',
    'B': 'Your pool is doing well',
    'C': 'Your pool needs some attention',
    'D': 'Your pool needs care soon',
    'F': 'Your pool needs immediate attention',
  };
  return descriptions[grade];
}

/**
 * Generates a one-line headline summarizing pool status
 * Requirement 1.1: Generate natural language summary within 2 seconds
 */
export function generateHeadline(input: LanguageGeneratorInput): string {
  const { healthScore, problems } = input;
  const score = healthScore.score;
  const grade = healthScore.grade;
  
  const criticalProblems = problems.filter(p => p.severity === 'critical');
  if (criticalProblems.length > 0) {
    const chemical = criticalProblems[0].chemical;
    return `Critical: ${formatChemicalName(chemical)} requires immediate attention (Score: ${score}/100)`;
  }
  
  const highProblems = problems.filter(p => p.severity === 'high');
  if (highProblems.length > 0) {
    return `Attention Needed: Pool health score ${score}/100 (Grade ${grade}) - ${highProblems.length} issue(s) detected`;
  }
  
  if (grade === 'A') {
    return `Excellent: Pool in optimal condition with health score ${score}/100`;
  }
  if (grade === 'B') {
    return `Good: Pool health score ${score}/100 - Minor adjustments recommended`;
  }
  if (grade === 'C') {
    return `Fair: Pool health score ${score}/100 - Attention recommended`;
  }
  if (grade === 'D') {
    return `Poor: Pool health score ${score}/100 - Intervention required`;
  }
  
  return `Critical: Pool health score ${score}/100 - Urgent action required`;
}

/**
 * Formats chemical name for display
 */
function formatChemicalName(chemical: string): string {
  const names: Record<string, string> = {
    'ph': 'pH',
    'chlorine': 'Chlorine',
    'alkalinity': 'Alkalinity',
    'stabilizer': 'Stabilizer',
    'salt': 'Salt',
  };
  return names[chemical.toLowerCase()] || chemical;
}

/**
 * Generates a full narrative paragraph describing pool status
 * Requirement 1.1, 1.4: Use pool-industry terminology appropriate for professionals
 */
export function generateParagraph(input: LanguageGeneratorInput): string {
  const { healthScore, problems, rootCauseAnalysis } = input;
  const parts: string[] = [];
  
  parts.push(
    `This pool is currently in ${getGradeDescription(healthScore.grade)} ` +
    `with a health score of ${healthScore.score}/100.`
  );
  
  if (healthScore.trend === 'improving') {
    parts.push('Chemical levels show an improving trend over recent services.');
  } else if (healthScore.trend === 'declining') {
    parts.push('Chemical levels show a declining trend that warrants monitoring.');
  } else {
    parts.push('Chemical levels have remained stable.');
  }
  
  const criticalCount = problems.filter(p => p.severity === 'critical').length;
  const highCount = problems.filter(p => p.severity === 'high').length;
  
  if (criticalCount > 0 || highCount > 0) {
    const issueDescriptions: string[] = [];
    if (criticalCount > 0) {
      issueDescriptions.push(`${criticalCount} critical`);
    }
    if (highCount > 0) {
      issueDescriptions.push(`${highCount} high-priority`);
    }
    parts.push(`Analysis identified ${issueDescriptions.join(' and ')} issue(s) requiring attention.`);
    
    const topProblems = problems
      .filter(p => p.severity === 'critical' || p.severity === 'high')
      .slice(0, 3);
    
    for (const problem of topProblems) {
      parts.push(`${formatChemicalName(problem.chemical)}: ${problem.description}.`);
    }
  } else if (problems.length > 0) {
    parts.push(`${problems.length} minor issue(s) noted for monitoring.`);
  } else {
    parts.push('No significant issues detected.');
  }
  
  if (rootCauseAnalysis && rootCauseAnalysis.chronicIssues.length > 0) {
    const chronic = rootCauseAnalysis.chronicIssues[0];
    parts.push(
      `Chronic pattern detected: ${formatChemicalName(chronic.chemical)} ` +
      `has shown ${chronic.pattern} across ${chronic.occurrences} services.`
    );
  }
  
  if (healthScore.confidence < 50) {
    parts.push('Note: Limited service history available; confidence in analysis is reduced.');
  }
  
  return parts.join(' ');
}

/**
 * Generates key takeaway bullet points
 * Requirement 1.1: Include key takeaways
 */
export function generateBulletPoints(input: LanguageGeneratorInput): string[] {
  const { healthScore, problems, recommendations, chemicalTrends } = input;
  const bullets: string[] = [];
  
  bullets.push(`Health Score: ${healthScore.score}/100 (Grade ${healthScore.grade})`);
  
  const trendDescriptions: Record<string, string> = {
    'improving': 'Trend: Improving - chemical levels getting better',
    'stable': 'Trend: Stable - consistent chemical levels',
    'declining': 'Trend: Declining - monitor closely',
  };
  const trendDescription = trendDescriptions[healthScore.trend] ?? 'Trend: Unknown';
  bullets.push(trendDescription);
  
  const significantProblems = problems
    .filter(p => p.severity === 'critical' || p.severity === 'high')
    .slice(0, 3);
  
  for (const problem of significantProblems) {
    bullets.push(`${formatChemicalName(problem.chemical)}: ${problem.description}`);
  }
  
  const totalRecs = 
    recommendations.immediate.length +
    recommendations.thisVisit.length +
    recommendations.nextVisit.length +
    recommendations.longTerm.length;
  
  if (totalRecs > 0) {
    const immediateCount = recommendations.immediate.length;
    if (immediateCount > 0) {
      bullets.push(`${immediateCount} immediate action(s) recommended`);
    } else {
      bullets.push(`${totalRecs} recommendation(s) for optimal maintenance`);
    }
  }
  
  const decliningChemicals = chemicalTrends.filter(t => t.trend === 'declining');
  for (const trend of decliningChemicals.slice(0, 2)) {
    bullets.push(`${formatChemicalName(trend.chemical)} showing declining trend`);
  }
  
  return bullets;
}

/**
 * Generates appropriate call to action based on pool status
 */
export function generateCallToAction(input: LanguageGeneratorInput): string | null {
  const { healthScore, problems, recommendations } = input;

  const criticalProblems = problems.filter(p => p.severity === 'critical');
  if (criticalProblems.length > 0) {
    return 'Immediate intervention required. Address critical chemical imbalances before leaving site.';
  }
  
  if (recommendations.immediate.length > 0) {
    const action = recommendations.immediate[0];
    return `Priority: ${action.action}`;
  }
  
  if (healthScore.score < 40) {
    return 'Schedule follow-up service within 48 hours to verify chemical corrections.';
  }
  
  if (healthScore.score < 60) {
    return 'Monitor chemical levels closely at next scheduled service.';
  }
  
  return null;
}

/**
 * Generates a complete professional summary for technicians
 * Requirement 1.1: Generate natural language summary describing pool's current health status
 * Requirement 1.4: Use pool-industry terminology appropriate for professionals
 */
export function generateProfessionalSummary(
  input: LanguageGeneratorInput,
  _options?: Partial<SummaryOptions>
): GeneratedSummary {
  const tone = determineTone(input.healthScore.score);
  
  const headline = generateHeadline(input);
  const paragraph = generateParagraph(input);
  const bulletPoints = generateBulletPoints(input);
  const callToAction = generateCallToAction(input);
  
  return {
    headline,
    paragraph,
    bulletPoints,
    callToAction,
    tone,
  };
}

/**
 * Generates a greeting based on customer name and pool status
 * Requirement 4.2: Use friendly, reassuring tone
 */
function generateGreeting(customerName: string, healthScore: number): string {
  const firstName = customerName.split(' ')[0];

  if (healthScore >= 80) {
    return `Hi ${firstName}! Great news about your pool.`;
  }
  if (healthScore >= 60) {
    return `Hi ${firstName}! Here's your pool update.`;
  }
  if (healthScore >= 40) {
    return `Hi ${firstName}, we wanted to share some important information about your pool.`;
  }
  return `Hi ${firstName}, we need to discuss your pool's condition.`;
}

/**
 * Generates customer-friendly health summary
 * Requirement 4.1: Generate simplified, non-technical summary suitable for pool owners
 * Requirement 4.3: Explain problems in layman's terms
 */
function generateCustomerHealthSummary(
  healthScore: PoolHealthScore,
  problems: PoolProblem[]
): string {
  const parts: string[] = [];
  
  parts.push(getCustomerGradeDescription(healthScore.grade) + '!');

  if (healthScore.score >= 80) {
    parts.push(
      `We scored your pool at ${healthScore.score} out of 100, ` +
      `which means the water chemistry is well-balanced and safe for swimming.`
    );
  } else if (healthScore.score >= 60) {
    parts.push(
      `Your pool scored ${healthScore.score} out of 100. ` +
      `The water is safe, but we noticed a few things that could be improved.`
    );
  } else if (healthScore.score >= 40) {
    parts.push(
      `Your pool scored ${healthScore.score} out of 100. ` +
      `We found some issues that need attention to keep your pool healthy.`
    );
  } else {
    parts.push(
      `Your pool scored ${healthScore.score} out of 100. ` +
      `We found some important issues that need to be addressed soon.`
    );
  }
  
  const significantProblems = problems.filter(
    p => p.severity === 'critical' || p.severity === 'high'
  );
  
  if (significantProblems.length > 0) {
    parts.push(getCustomerProblemExplanation(significantProblems));
  }
  
  return parts.join(' ');
}

/**
 * Explains problems in customer-friendly language
 * Requirement 4.3: Explain problems in layman's terms with clear next steps
 */
function getCustomerProblemExplanation(problems: PoolProblem[]): string {
  const explanations: string[] = [];
  
  for (const problem of problems.slice(0, 2)) {
    const chemical = problem.chemical.toLowerCase();
    
    if (chemical === 'ph') {
      if (problem.description.toLowerCase().includes('low')) {
        explanations.push(
          'The pH level is a bit low, which can cause eye irritation and affect how well chlorine works.'
        );
      } else {
        explanations.push(
          'The pH level is a bit high, which can make the water cloudy and reduce chlorine effectiveness.'
        );
      }
    } else if (chemical === 'chlorine') {
      if (problem.description.toLowerCase().includes('low')) {
        explanations.push(
          'Chlorine levels are low, which means the water may not be properly sanitized.'
        );
      } else {
        explanations.push(
          'Chlorine levels are high, which can cause skin and eye irritation.'
        );
      }
    } else if (chemical === 'alkalinity') {
      explanations.push(
        'The alkalinity needs adjustment to help keep the pH stable.'
      );
    } else if (chemical === 'stabilizer') {
      explanations.push(
        'The stabilizer level needs attention to help protect chlorine from sunlight.'
      );
    } else {
      explanations.push(`The ${formatChemicalName(chemical)} level needs adjustment.`);
    }
  }
  
  return explanations.join(' ');
}

/**
 * Generates what we did section from recent actions
 */
function generateWhatWeDid(
  recommendations: CategorizedRecommendations,
  recentActions?: string[]
): string[] {
  if (recentActions && recentActions.length > 0) {
    return recentActions.map(action => `✓ ${action}`);
  }
  
  const actions: string[] = [];

  for (const rec of recommendations.immediate.slice(0, 2)) {
    actions.push(`✓ ${rec.action}`);
  }
  
  for (const rec of recommendations.thisVisit.slice(0, 2)) {
    actions.push(`✓ ${rec.action}`);
  }
  
  if (actions.length === 0) {
    actions.push('✓ Tested all chemical levels');
    actions.push('✓ Inspected pool equipment');
  }
  
  return actions;
}

/**
 * Generates what to expect section
 * Requirement 4.4: Reinforce value of regular service when pool is healthy
 */
function generateWhatToExpect(healthScore: PoolHealthScore): string {
  if (healthScore.score >= 80) {
    return (
      'Your pool should stay in great condition with regular maintenance. ' +
      'We recommend continuing your current service schedule to keep everything balanced.'
    );
  }
  if (healthScore.score >= 60) {
    return (
      'With the adjustments we made today, you should see improvement by your next service. ' +
      'The water will be fully balanced within 24-48 hours.'
    );
  }
  if (healthScore.score >= 40) {
    return (
      'We\'ve started addressing the issues we found. ' +
      'You may notice the water clearing up over the next few days. ' +
      'We\'ll check progress at your next service.'
    );
  }
  return (
    'We\'ve taken steps to address the urgent issues. ' +
    'Please avoid swimming until we confirm the water is safe at our follow-up visit. ' +
    'We\'ll be back soon to check on things.'
  );
}

/**
 * Generates customer-friendly recommendations
 */
function generateCustomerRecommendations(
  recommendations: CategorizedRecommendations,
  healthScore: number
): string[] {
  const customerRecs: string[] = [];
  
  for (const rec of recommendations.immediate.slice(0, 2)) {
    customerRecs.push(simplifyRecommendation(rec));
  }
  
  for (const rec of recommendations.nextVisit.slice(0, 2)) {
    customerRecs.push(`At next visit: ${simplifyRecommendation(rec)}`);
  }
  
  if (healthScore >= 80) {
    customerRecs.push('Keep up the great work with regular maintenance!');
  } else if (healthScore < 60) {
    customerRecs.push('Consider running the pump a bit longer each day');
  }
  
  return customerRecs;
}

/**
 * Simplifies technical recommendation for customers
 */
function simplifyRecommendation(rec: Recommendation): string {
  let simplified = rec.action;

  simplified = simplified
    .replace(/^Add /i, 'We\'ll add ')
    .replace(/^Adjust /i, 'We\'ll adjust ')
    .replace(/^Check /i, 'We\'ll check ')
    .replace(/^Test /i, 'We\'ll test ');
  
  return simplified;
}

/**
 * Generates closing note based on pool status
 */
function generateClosingNote(healthScore: number, customerName: string): string {
  const firstName = customerName.split(' ')[0];

  if (healthScore >= 80) {
    return `Thanks for trusting us with your pool care, ${firstName}! Enjoy your swim!`;
  }
  if (healthScore >= 60) {
    return `Thanks for your patience, ${firstName}. Your pool will be perfect in no time!`;
  }
  if (healthScore >= 40) {
    return `We're on it, ${firstName}. Don't hesitate to reach out if you have questions.`;
  }
  return `We're taking care of this, ${firstName}. We'll follow up soon with an update.`;
}


/**
 * Generates shareable text for SMS/email
 * Requirement 4.5: Format output for easy sharing via email or text message
 */
function generateShareableText(
  customerName: string,
  healthScore: PoolHealthScore,
  problems: PoolProblem[]
): string {
  const firstName = customerName.split(' ')[0];
  const lines: string[] = [];
  
  lines.push(`Pool Update for ${firstName}`);
  lines.push(`Score: ${healthScore.score}/100 (${healthScore.grade})`);
  
  if (healthScore.score >= 80) {
    lines.push('Status: Looking great! ✓');
  } else if (healthScore.score >= 60) {
    lines.push('Status: Good, minor adjustments made');
  } else if (healthScore.score >= 40) {
    lines.push('Status: Needs attention - we\'re on it');
  } else {
    lines.push('Status: Urgent - follow-up scheduled');
  }
  
  const topProblem = problems.find(p => p.severity === 'critical' || p.severity === 'high');
  if (topProblem) {
    lines.push(`Note: ${formatChemicalName(topProblem.chemical)} adjusted`);
  }
  
  lines.push('Questions? Reply to this message.');
  
  return lines.join('\n');
}

/**
 * Generates a complete customer report
 * Requirement 4.1: Generate simplified, non-technical summary suitable for pool owners
 * Requirement 4.2: Use friendly, reassuring tone while remaining accurate
 * Requirement 4.3: Explain problems in layman's terms with clear next steps
 * Requirement 4.5: Format output for easy sharing via email or text message
 */
export function generateCustomerReport(input: LanguageGeneratorInput): CustomerReport {
  const { customerName, healthScore, problems, recommendations, recentActions } = input;
  
  return {
    greeting: generateGreeting(customerName, healthScore.score),
    healthSummary: generateCustomerHealthSummary(healthScore, problems),
    whatWeDid: generateWhatWeDid(recommendations, recentActions),
    whatToExpect: generateWhatToExpect(healthScore),
    recommendations: generateCustomerRecommendations(recommendations, healthScore.score),
    closingNote: generateClosingNote(healthScore.score, customerName),
    shareableText: generateShareableText(customerName, healthScore, problems),
  };
}

export interface GenerateSummaryResult {
  professionalSummary: GeneratedSummary;
  customerReport: CustomerReport;
}

/**
 * Main function to generate both professional and customer summaries
 * Requirement 1.1: Generate natural language summary within 2 seconds
 */
export function generateSummaries(input: LanguageGeneratorInput): GenerateSummaryResult {
  return {
    professionalSummary: generateProfessionalSummary(input),
    customerReport: generateCustomerReport(input),
  };
}

/**
 * Validates that a generated summary is complete
 * Used for Property 10: Summary Generation Completeness
 */
export function isCompleteSummary(summary: GeneratedSummary): boolean {
  return (
    typeof summary.headline === 'string' &&
    summary.headline.length > 0 &&
    typeof summary.paragraph === 'string' &&
    summary.paragraph.length > 0 &&
    Array.isArray(summary.bulletPoints) &&
    summary.bulletPoints.length >= 1 &&
    summary.bulletPoints.every(bp => typeof bp === 'string' && bp.length > 0)
  );
}

/**
 * Validates that customer report tone is appropriate for health score
 * Used for Property 11: Customer Report Tone Appropriateness
 */
export function isToneAppropriate(healthScore: number, tone: SummaryTone): boolean {
  if (healthScore < 40) {
    // For low scores, tone should be 'concerned' or 'urgent'
    return tone === 'concerned' || tone === 'urgent';
  }
  // For higher scores, any tone is acceptable
  return true;
}
