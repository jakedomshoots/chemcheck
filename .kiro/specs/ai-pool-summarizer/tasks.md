# Implementation Plan

- [x] 1. Set up core types and interfaces
  - [x] 1.1 Create TypeScript interfaces for all data models
    - Create `src/lib/ai-summarizer/types.ts` with PoolHealthScore, Prediction, RootCause, GeneratedSummary, CostProjection, FleetInsights, and all supporting interfaces
    - _Requirements: 1.2, 2.4, 3.1, 5.4, 7.1_
  - [x] 1.2 Write property test for health score bounds
    - **Property 1: Health Score Bounds**
    - **Validates: Requirements 1.2**
  - [x] 1.3 Write property test for prediction confidence bounds
    - **Property 3: Prediction Confidence Bounds**
    - **Validates: Requirements 2.4**
  - [x] 1.4 Write property test for cost projection range ordering
    - **Property 7: Cost Projection Range Ordering**
    - **Validates: Requirements 5.4**

- [x] 2. Implement PoolHealthScorer
  - [x] 2.1 Create health score calculation engine
    - Create `src/lib/ai-summarizer/healthScorer.ts`
    - Implement weighted scoring algorithm with configurable weights for each chemical
    - Calculate grade (A-F) based on score ranges
    - Include trend impact on final score
    - _Requirements: 1.2, 1.3_
  - [x] 2.2 Write property test for health score monotonicity
    - **Property 2: Health Score Monotonicity with Chemical Quality**
    - **Validates: Requirements 1.2, 1.3**
  - [x] 2.3 Write property test for insufficient data detection
    - **Property 4: Insufficient Data Detection**
    - **Validates: Requirements 1.5**

- [x] 3. Implement PredictiveAnalyzer
  - [x] 3.1 Create prediction engine
    - Create `src/lib/ai-summarizer/predictiveAnalyzer.ts`
    - Implement trend extrapolation for each chemical
    - Calculate days until critical threshold
    - Generate confidence scores based on data quality and variance
    - _Requirements: 2.1, 2.2, 2.4, 2.5_
  - [x] 3.2 Write property test for prediction minimum data requirement
    - **Property 5: Prediction Requires Minimum Data**
    - **Validates: Requirements 2.1, 2.5**

- [x] 4. Implement RootCauseAnalyzer
  - [x] 4.1 Create correlation detection engine
    - Create `src/lib/ai-summarizer/rootCauseAnalyzer.ts`
    - Implement chemical correlation detection (pH-alkalinity, chlorine-stabilizer)
    - Detect chronic issues (>3 occurrences)
    - Generate root cause hypotheses with evidence
    - _Requirements: 3.1, 3.2, 3.3_
  - [x] 4.2 Write property test for chronic issue detection threshold
    - **Property 6: Chronic Issue Detection Threshold**
    - **Validates: Requirements 3.2**
  - [x] 4.3 Write property test for chemical correlation symmetry
    - **Property 13: Chemical Correlation Symmetry**
    - **Validates: Requirements 3.1**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement NaturalLanguageGenerator
  - [x] 6.1 Create summary generation engine
    - Create `src/lib/ai-summarizer/languageGenerator.ts`
    - Implement professional summary generation with headline, paragraph, bullet points
    - Implement customer report generation with friendly tone
    - Generate shareable text for SMS/email
    - _Requirements: 1.1, 4.1, 4.2, 4.3, 4.5_
  - [x] 6.2 Write property test for summary generation completeness
    - **Property 10: Summary Generation Completeness**
    - **Validates: Requirements 1.1, 4.1**
  - [x] 6.3 Write property test for customer report tone appropriateness
    - **Property 11: Customer Report Tone Appropriateness**
    - **Validates: Requirements 4.2, 4.3**

- [x] 7. Implement RecommendationEngine
  - [x] 7.1 Create prioritized recommendation generator
    - Create `src/lib/ai-summarizer/recommendationEngine.ts`
    - Categorize recommendations (immediate, this-visit, next-visit, long-term)
    - Calculate dosages based on pool gallons
    - Link recommendations to issues they address
    - _Requirements: 6.1, 6.2, 6.3, 6.5_
  - [x] 7.2 Write property test for recommendation priority ordering
    - **Property 8: Recommendation Priority Ordering**
    - **Validates: Requirements 6.1, 6.2**

- [x] 8. Implement CostProjector
  - [x] 8.1 Create cost projection engine
    - Create `src/lib/ai-summarizer/costProjector.ts`
    - Calculate monthly projections with low/expected/high ranges
    - Detect high-maintenance pools
    - Identify savings opportunities
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

- [x] 9. Implement FleetAnalyzer
  - [x] 9.1 Create fleet aggregation engine
    - Create `src/lib/ai-summarizer/fleetAnalyzer.ts`
    - Rank pools by health score
    - Group pools by problem type
    - Calculate averages by service day
    - Generate alerts for score drops
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [x] 9.2 Write property test for fleet health score consistency
    - **Property 9: Fleet Health Score Consistency**
    - **Validates: Requirements 7.1**

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement LearningEngine
  - [x] 11.1 Create intervention tracking system
    - Create `src/lib/ai-summarizer/learningEngine.ts`
    - Parse service notes for actions taken
    - Track before/after readings
    - Calculate success rates for interventions
    - Generate recommendation adjustments
    - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - [x] 11.2 Write property test for learning engine outcome tracking
    - **Property 14: Learning Engine Outcome Tracking**
    - **Validates: Requirements 8.1**

- [x] 12. Implement WeatherAnalyzer
  - [x] 12.1 Create weather impact analyzer
    - Create `src/lib/ai-summarizer/weatherAnalyzer.ts`
    - Define weather impact rules (rain → pH dilution, heat → chlorine demand)
    - Generate preemptive action recommendations
    - Handle graceful degradation when weather unavailable
    - _Requirements: 9.1, 9.2, 9.3, 9.5_
  - [x] 12.2 Write property test for weather graceful degradation
    - **Property 15: Weather Impact Graceful Degradation**
    - **Validates: Requirements 9.5**

- [x] 13. Implement ExportEngine
  - [x] 13.1 Create export generation system
    - Create `src/lib/ai-summarizer/exportEngine.ts`
    - Implement PDF report generation with charts
    - Implement CSV export for fleet data
    - Include timestamps and data ranges
    - _Requirements: 10.1, 10.4, 10.5_
  - [x] 13.2 Write property test for export timestamp accuracy
    - **Property 12: Export Timestamp Accuracy**
    - **Validates: Requirements 10.5**

- [x] 14. Create main AIPoolSummarizer orchestrator
  - [x] 14.1 Implement main analysis pipeline
    - Create `src/lib/ai-summarizer/index.ts`
    - Wire all components together in correct order
    - Implement single pool analysis function
    - Implement fleet analysis function
    - Handle errors gracefully at each stage
    - _Requirements: 1.1, 1.5, 2.1_

- [x] 15. Update UI components
  - [x] 15.1 Enhance PoolAnalysisPanel with new features
    - Update `src/components/PoolAnalysisPanel.jsx` to use new AIPoolSummarizer
    - Add health score display with grade
    - Add predictive insights section
    - Add customer report generation button
    - Add export buttons (PDF, share)
    - _Requirements: 1.1, 1.2, 4.1, 10.1_
  - [x] 15.2 Create FleetDashboard component
    - Create `src/components/FleetDashboard.jsx`
    - Display fleet health overview
    - Show priority pools list
    - Display problem clusters
    - Show service day breakdown
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 16. Final Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
