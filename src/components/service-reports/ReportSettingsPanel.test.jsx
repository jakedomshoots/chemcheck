/**
 * Tests for ReportSettingsPanel Component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportSettingsPanel } from './ReportSettingsPanel';

describe('ReportSettingsPanel', () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();

  const defaultSettings: ReportSettings = {
    show_chemical_readings: true,
    show_photos: true,
    show_service_notes: true,
    show_technician_name: true,
    show_service_duration: true,
    show_overall_status: true,
  };

  const defaultProps = {
    isOpen: true,
    onClose: mockOnClose,
    onSave: mockOnSave,
    customerName: 'John Doe',
    currentSettings: defaultSettings,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders dialog when open', () => {
      render(<ReportSettingsPanel {...defaultProps} />);
      expect(screen.getByText('Report Settings')).toBeInTheDocument();
    });

    it('displays all setting options', () => {
      render(<ReportSettingsPanel {...defaultProps} />);
      expect(screen.getByText('Overall Pool Status')).toBeInTheDocument();
      expect(screen.getByText('Chemical Readings')).toBeInTheDocument();
      expect(screen.getByText('Before/After Photos')).toBeInTheDocument();
      expect(screen.getByText('Service Notes')).toBeInTheDocument();
      expect(screen.getByText('Technician Name')).toBeInTheDocument();
      expect(screen.getByText('Service Duration')).toBeInTheDocument();
    });

    it('shows customer name in description', () => {
      render(<ReportSettingsPanel {...defaultProps} />);
      expect(screen.getByText(/Customize what John Doe sees/)).toBeInTheDocument();
    });
  });

  describe('Toggle Settings', () => {
    it('toggles setting when checkbox clicked', () => {
      render(<ReportSettingsPanel {...defaultProps} />);
      const checkbox = screen.getByTestId('setting-show_chemical_readings');
      expect(checkbox).toBeChecked();

      fireEvent.click(checkbox);
      expect(checkbox).not.toBeChecked();
    });

    it('toggles multiple settings independently', () => {
      render(<ReportSettingsPanel {...defaultProps} />);
      const chemicalCheckbox = screen.getByTestId('setting-show_chemical_readings');
      const photosCheckbox = screen.getByTestId('setting-show_photos');

      fireEvent.click(chemicalCheckbox);
      expect(chemicalCheckbox).not.toBeChecked();
      expect(photosCheckbox).toBeChecked();
    });
  });

  describe('Quick Actions', () => {
    it('resets to default settings', () => {
      const customSettings: ReportSettings = {
        show_chemical_readings: false,
        show_photos: false,
        show_service_notes: true,
        show_technician_name: true,
        show_service_duration: true,
        show_overall_status: true,
      };

      render(
        <ReportSettingsPanel
          {...defaultProps}
          currentSettings={customSettings}
        />
      );

      const resetButton = screen.getByText('Reset to Default');
      fireEvent.click(resetButton);

      const chemicalCheckbox = screen.getByTestId('setting-show_chemical_readings');
      const photosCheckbox = screen.getByTestId('setting-show_photos');

      expect(chemicalCheckbox).toBeChecked();
      expect(photosCheckbox).toBeChecked();
    });

    it('shows all settings when "Show All" clicked', () => {
      const customSettings: ReportSettings = {
        show_chemical_readings: false,
        show_photos: false,
        show_service_notes: false,
        show_technician_name: false,
        show_service_duration: false,
        show_overall_status: false,
      };

      render(
        <ReportSettingsPanel
          {...defaultProps}
          currentSettings={customSettings}
        />
      );

      const showAllButton = screen.getByText('Show All');
      fireEvent.click(showAllButton);

      const chemicalCheckbox = screen.getByTestId('setting-show_chemical_readings');
      expect(chemicalCheckbox).toBeChecked();
    });

    it('hides all settings when "Hide All" clicked', () => {
      render(<ReportSettingsPanel {...defaultProps} />);

      const hideAllButton = screen.getByText('Hide All');
      fireEvent.click(hideAllButton);

      const chemicalCheckbox = screen.getByTestId('setting-show_chemical_readings');
      expect(chemicalCheckbox).not.toBeChecked();
    });

    it('disables "Show All" when all already shown', () => {
      render(<ReportSettingsPanel {...defaultProps} />);
      const showAllButton = screen.getByText('Show All');
      expect(showAllButton).toBeDisabled();
    });

    it('disables "Hide All" when all already hidden', () => {
      const allHidden: ReportSettings = {
        show_chemical_readings: false,
        show_photos: false,
        show_service_notes: false,
        show_technician_name: false,
        show_service_duration: false,
        show_overall_status: false,
      };

      render(
        <ReportSettingsPanel
          {...defaultProps}
          currentSettings={allHidden}
        />
      );

      const hideAllButton = screen.getByText('Hide All');
      expect(hideAllButton).toBeDisabled();
    });
  });

  describe('Save Functionality', () => {
    it('calls onSave with updated settings', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<ReportSettingsPanel {...defaultProps} />);

      const checkbox = screen.getByTestId('setting-show_chemical_readings');
      fireEvent.click(checkbox);

      const saveButton = screen.getByTestId('save-settings-button');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnSave).toHaveBeenCalledWith(
          expect.objectContaining({
            show_chemical_readings: false,
          })
        );
      });
    });

    it('shows loading state during save', async () => {
      mockOnSave.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ReportSettingsPanel {...defaultProps} />);

      const saveButton = screen.getByTestId('save-settings-button');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Saving...')).toBeInTheDocument();
      });
    });

    it('shows success message after save', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<ReportSettingsPanel {...defaultProps} />);

      const saveButton = screen.getByTestId('save-settings-button');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Settings saved successfully!')).toBeInTheDocument();
      });
    });

    it('closes dialog after successful save', async () => {
      mockOnSave.mockResolvedValue(undefined);

      render(<ReportSettingsPanel {...defaultProps} />);

      const saveButton = screen.getByTestId('save-settings-button');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mockOnClose).toHaveBeenCalled();
      }, { timeout: 2000 });
    });

    it('displays error message on save failure', async () => {
      mockOnSave.mockRejectedValue(new Error('Save failed'));

      render(<ReportSettingsPanel {...defaultProps} />);

      const saveButton = screen.getByTestId('save-settings-button');
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(screen.getByText('Save failed')).toBeInTheDocument();
      });
    });

    it('disables buttons during save', async () => {
      mockOnSave.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ReportSettingsPanel {...defaultProps} />);

      const saveButton = screen.getByTestId('save-settings-button');
      const cancelButton = screen.getByText('Cancel');

      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(saveButton).toBeDisabled();
        expect(cancelButton).toBeDisabled();
      });
    });
  });

  describe('Close Functionality', () => {
    it('calls onClose when cancel clicked', () => {
      render(<ReportSettingsPanel {...defaultProps} />);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnClose).toHaveBeenCalled();
    });

    it('does not close during save', async () => {
      mockOnSave.mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 100))
      );

      render(<ReportSettingsPanel {...defaultProps} />);

      const saveButton = screen.getByTestId('save-settings-button');
      fireEvent.click(saveButton);

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnClose).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('displays error prop', () => {
      render(
        <ReportSettingsPanel
          {...defaultProps}
          error="Custom error message"
        />
      );

      expect(screen.getByText('Custom error message')).toBeInTheDocument();
    });

    it('displays loading state', () => {
      render(
        <ReportSettingsPanel
          {...defaultProps}
          isLoading={true}
        />
      );

      // Component should still render normally
      expect(screen.getByText('Report Settings')).toBeInTheDocument();
    });
  });
});
