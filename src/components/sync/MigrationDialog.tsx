import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CheckCircle, AlertCircle, Clock, Database } from 'lucide-react';
import { useMigration } from '@/hooks/useMigration';
import { MigrationResult } from '@/lib/sync/MigrationService';

interface MigrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete?: (result: MigrationResult) => void;
}

/**
 * Dialog component for handling initial data migration from Dexie to Convex
 * Shows migration prompt, progress, and results
 */
export function MigrationDialog({ open, onOpenChange, onComplete }: MigrationDialogProps) {
  const {
    status,
    startMigration,
    resumeMigration,
    verifyDataIntegrity,
    cancelMigration,
    isMigrationInProgress,
  } = useMigration();

  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);
  const [verificationResult, setVerificationResult] = useState<{ success: boolean; discrepancies: string[] } | null>(null);
  const [currentStep, setCurrentStep] = useState<'prompt' | 'migrating' | 'complete' | 'error'>('prompt');

  const handleStartMigration = async () => {
    try {
      setCurrentStep('migrating');
      setMigrationResult(null);
      setVerificationResult(null);

      const result = await startMigration();
      setMigrationResult(result);

      if (result.success) {
        // Verify data integrity after successful migration
        const verification = await verifyDataIntegrity();
        setVerificationResult(verification);
        setCurrentStep('complete');
      } else {
        setCurrentStep('error');
      }

      onComplete?.(result);
    } catch (error) {
      console.error('Migration failed:', error);
      const errorResult: MigrationResult = {
        success: false,
        totalRecords: status.totalRecords,
        migratedRecords: status.migratedRecords,
        failedRecords: status.totalRecords - status.migratedRecords,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      setMigrationResult(errorResult);
      setCurrentStep('error');
      onComplete?.(errorResult);
    }
  };

  const handleResumeMigration = async () => {
    try {
      setCurrentStep('migrating');
      setMigrationResult(null);
      setVerificationResult(null);
      
      const result = await resumeMigration();
      setMigrationResult(result);

      if (result.success) {
        const verification = await verifyDataIntegrity();
        setVerificationResult(verification);
        setCurrentStep('complete');
      } else {
        setCurrentStep('error');
      }

      onComplete?.(result);
    } catch (error) {
      console.error('Migration resume failed:', error);
      const errorResult: MigrationResult = {
        success: false,
        totalRecords: status.totalRecords,
        migratedRecords: status.migratedRecords,
        failedRecords: status.totalRecords - status.migratedRecords,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
      setMigrationResult(errorResult);
      setCurrentStep('error');
      onComplete?.(errorResult);
    }
  };

  const handleCancel = () => {
    if (isMigrationInProgress) {
      cancelMigration();
    }
    onOpenChange(false);
  };

  const formatTimeRemaining = (ms: number): string => {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) {
      return `${seconds} seconds`;
    }
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minutes`;
  };

  const renderPromptStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Database className="h-5 w-5" />
          Migrate Your Data to Cloud
        </DialogTitle>
        <DialogDescription>
          We found {status.totalRecords} records in your local database that haven't been synced to the cloud yet.
          Would you like to migrate them now? This will enable features like SMS/Email report sending.
        </DialogDescription>
      </DialogHeader>

      <div className="py-4">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Migration will sync your existing customers, service logs, chemical usage records, and notes to the cloud.
            This process may take a few minutes depending on the amount of data.
          </AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleCancel}>
          Skip for Now
        </Button>
        <Button onClick={handleStartMigration}>
          Start Migration
        </Button>
      </DialogFooter>
    </>
  );

  const renderMigratingStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 animate-spin" />
          Migrating Data...
        </DialogTitle>
        <DialogDescription>
          Please wait while we sync your data to the cloud. Do not close this window.
        </DialogDescription>
      </DialogHeader>

      <div className="py-6 space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>Progress</span>
            <span>{status.migratedRecords} of {status.totalRecords} records</span>
          </div>
          <Progress value={status.progress} className="w-full" />
        </div>

        {status.estimatedTimeRemaining && status.estimatedTimeRemaining > 0 && (
          <div className="text-sm text-muted-foreground text-center">
            Estimated time remaining: {formatTimeRemaining(status.estimatedTimeRemaining)}
          </div>
        )}

        {status.error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{status.error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={handleCancel} disabled={!isMigrationInProgress}>
          Cancel
        </Button>
        {status.error && (
          <Button onClick={handleResumeMigration}>
            Resume Migration
          </Button>
        )}
      </DialogFooter>
    </>
  );

  const renderCompleteStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle className="h-5 w-5 text-green-600" />
          Migration Complete
        </DialogTitle>
        <DialogDescription>
          Your data has been successfully migrated to the cloud.
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {migrationResult && (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="font-medium">Total Records:</span>
              <div>{migrationResult.totalRecords}</div>
            </div>
            <div>
              <span className="font-medium">Migrated:</span>
              <div className="text-green-600">{migrationResult.migratedRecords}</div>
            </div>
            {migrationResult.failedRecords > 0 && (
              <div>
                <span className="font-medium">Failed:</span>
                <div className="text-red-600">{migrationResult.failedRecords}</div>
              </div>
            )}
          </div>
        )}

        {verificationResult && (
          <Alert variant={verificationResult.success ? "default" : "destructive"}>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {verificationResult.success ? (
                "Data integrity verification passed. All records were migrated successfully."
              ) : (
                <div>
                  <div>Data integrity issues detected:</div>
                  <ul className="list-disc list-inside mt-2">
                    {verificationResult.discrepancies.map((discrepancy, index) => (
                      <li key={index}>{discrepancy}</li>
                    ))}
                  </ul>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>
          Close
        </Button>
      </DialogFooter>
    </>
  );

  const renderErrorStep = () => (
    <>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-red-600" />
          Migration Failed
        </DialogTitle>
        <DialogDescription>
          There was an error during the migration process.
        </DialogDescription>
      </DialogHeader>

      <div className="py-4 space-y-4">
        {migrationResult && (
          <>
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {migrationResult.error || 'Unknown error occurred during migration'}
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">Total Records:</span>
                <div>{migrationResult.totalRecords}</div>
              </div>
              <div>
                <span className="font-medium">Migrated:</span>
                <div className="text-green-600">{migrationResult.migratedRecords}</div>
              </div>
              <div>
                <span className="font-medium">Failed:</span>
                <div className="text-red-600">{migrationResult.failedRecords}</div>
              </div>
            </div>
          </>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button onClick={handleResumeMigration}>
          Retry Migration
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {currentStep === 'prompt' && renderPromptStep()}
        {currentStep === 'migrating' && renderMigratingStep()}
        {currentStep === 'complete' && renderCompleteStep()}
        {currentStep === 'error' && renderErrorStep()}
      </DialogContent>
    </Dialog>
  );
}