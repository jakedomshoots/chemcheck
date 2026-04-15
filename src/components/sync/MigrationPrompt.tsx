import React, { useEffect, useState } from 'react';
import { MigrationDialog } from './MigrationDialog';
import { useMigrationCheck } from '@/hooks/useMigration';
import { migrationService } from '@/lib/sync/MigrationService';
import { useConvex } from 'convex/react';

interface MigrationPromptProps {
  children: React.ReactNode;
}

/**
 * Component that checks for migration requirements and shows migration dialog
 * Should be placed high in the component tree after authentication
 */
export function MigrationPrompt({ children }: MigrationPromptProps) {
  const convex = useConvex();
  const { isRequired, loading } = useMigrationCheck();
  const [showDialog, setShowDialog] = useState(false);
  const [hasChecked, setHasChecked] = useState(false);

  // Initialize migration service with Convex client
  useEffect(() => {
    if (convex) {
      migrationService.initialize(convex);
    }
  }, [convex]);

  // Show migration dialog if required
  useEffect(() => {
    if (!loading && isRequired && !hasChecked) {
      setShowDialog(true);
      setHasChecked(true);
    }
  }, [loading, isRequired, hasChecked]);

  const handleMigrationComplete = () => {
    setShowDialog(false);
    setHasChecked(true); // Only set hasChecked when migration is actually completed
  };

  const handleOpenChange = (open: boolean) => {
    if (!open && isRequired && !hasChecked) {
      // Prevent dismissal of required migrations that haven't been completed
      return;
    }
    setShowDialog(open);
  };

  return (
    <>
      {children}
      <MigrationDialog
        open={showDialog}
        onOpenChange={handleOpenChange}
        onComplete={handleMigrationComplete}
      />
    </>
  );
}