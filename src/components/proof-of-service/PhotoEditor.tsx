/**
 * PhotoEditor Component
 * 
 * Provides photo editing capabilities including:
 * - Crop (freeform and preset aspect ratios)
 * - Rotate (90° increments)
 * - Filters (brightness, contrast, saturation)
 * - Non-destructive editing with undo/redo
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import {
    X,
    RotateCcw,
    RotateCw,
    Crop,
    Sun,
    Contrast,
    Palette,
    Undo2,
    Redo2,
    Check,
    RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

// ============================================
// Types
// ============================================

export interface PhotoEditorProps {
    imageDataUrl: string;
    onSave: (editedDataUrl: string) => void | Promise<void>;
    onCancel: () => void;
}

export interface ImageFilters {
    brightness: number; // 0-200, default 100
    contrast: number;   // 0-200, default 100
    saturation: number; // 0-200, default 100
}

interface EditState {
    rotation: number;   // 0, 90, 180, 270
    filters: ImageFilters;
    cropArea: CropArea | null;
}

interface CropArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

const DEFAULT_FILTERS: ImageFilters = {
    brightness: 100,
    contrast: 100,
    saturation: 100,
};

const DEFAULT_EDIT_STATE: EditState = {
    rotation: 0,
    filters: { ...DEFAULT_FILTERS },
    cropArea: null,
};

// ============================================
// Component
// ============================================

export function PhotoEditor({
    imageDataUrl,
    onSave,
    onCancel,
}: PhotoEditorProps) {
    // State
    const [editState, setEditState] = useState<EditState>(DEFAULT_EDIT_STATE);
    const [history, setHistory] = useState<EditState[]>([DEFAULT_EDIT_STATE]);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [activeTab, setActiveTab] = useState<'filters' | 'crop' | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [previewFilters, setPreviewFilters] = useState<ImageFilters | null>(null);

    // Refs
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const imageRef = useRef<HTMLImageElement | null>(null);
    const renderCanvasRef = useRef<(() => void) | null>(null);

    // Load image on mount
    useEffect(() => {
        const img = new Image();
        img.onload = () => {
            imageRef.current = img;
            renderCanvasRef.current?.();
        };
        img.onerror = () => {
            console.error('Failed to load image');
        };
        img.src = imageDataUrl;
    }, [imageDataUrl]);

    // Re-render canvas when edit state or preview filters change
    useEffect(() => {
        renderCanvasRef.current?.();
    }, [editState, previewFilters]);

    /**
     * Render the edited image to canvas
     */
    const renderCanvas = useCallback(() => {
        const img = imageRef.current;
        const canvas = canvasRef.current;
        if (!img || !canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Calculate canvas dimensions based on rotation
        const isRotated90 = editState.rotation === 90 || editState.rotation === 270;
        const width = isRotated90 ? img.height : img.width;
        const height = isRotated90 ? img.width : img.height;

        // Set canvas size
        canvas.width = width;
        canvas.height = height;

        // Clear and set up context
        ctx.clearRect(0, 0, width, height);
        ctx.save();

        // Apply rotation
        ctx.translate(width / 2, height / 2);
        ctx.rotate((editState.rotation * Math.PI) / 180);

        if (isRotated90) {
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
        } else {
            ctx.drawImage(img, -width / 2, -height / 2);
        }

        ctx.restore();

        // Apply filters using CSS filter (redrawn)
        const filters = previewFilters ?? editState.filters;
        const { brightness, contrast, saturation } = filters;
        ctx.filter = `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;

        // Redraw with filters
        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate((editState.rotation * Math.PI) / 180);

        if (isRotated90) {
            ctx.drawImage(img, -img.width / 2, -img.height / 2);
        } else {
            ctx.drawImage(img, -width / 2, -height / 2);
        }

        ctx.restore();
        ctx.filter = 'none';
    }, [editState, previewFilters]);

    // Update ref whenever renderCanvas changes
    useEffect(() => {
        renderCanvasRef.current = renderCanvas;
    }, [renderCanvas]);

    /**
     * Push new state to history
     */
    const pushHistory = useCallback((newState: EditState) => {
        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(newState);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        setEditState(newState);
    }, [history, historyIndex]);

    /**
     * Undo last edit
     */
    const undo = useCallback(() => {
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setEditState(history[newIndex]);
        }
    }, [history, historyIndex]);

    /**
     * Redo last undone edit
     */
    const redo = useCallback(() => {
        if (historyIndex < history.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            setEditState(history[newIndex]);
        }
    }, [history, historyIndex]);

    /**
     * Rotate image 90° clockwise
     */
    const rotateRight = useCallback(() => {
        const newRotation = ((editState.rotation + 90) % 360) as 0 | 90 | 180 | 270;
        pushHistory({
            ...editState,
            rotation: newRotation,
        });
    }, [editState, pushHistory]);

    /**
     * Rotate image 90° counter-clockwise
     */
    const rotateLeft = useCallback(() => {
        const newRotation = ((editState.rotation - 90 + 360) % 360) as 0 | 90 | 180 | 270;
        pushHistory({
            ...editState,
            rotation: newRotation,
        });
    }, [editState, pushHistory]);

    /**
     * Update a filter value
     */
    const updateFilter = useCallback((key: keyof ImageFilters, value: number) => {
        pushHistory({
            ...editState,
            filters: {
                ...editState.filters,
                [key]: value,
            },
        });
    }, [editState, pushHistory]);

    /**
     * Handle filter preview (real-time updates without history)
     */
    const handleFilterPreview = useCallback((key: keyof ImageFilters, value: number) => {
        setPreviewFilters(prev => ({
            ...(prev ?? editState.filters),
            [key]: value,
        }));
    }, [editState.filters]);

    /**
     * Commit filter changes to history
     */
    const commitFilterChange = useCallback(() => {
        if (previewFilters) {
            pushHistory({
                ...editState,
                filters: previewFilters,
            });
            setPreviewFilters(null);
        }
    }, [editState, previewFilters, pushHistory]);

    /**
     * Reset all filters to default
     */
    const resetFilters = useCallback(() => {
        pushHistory({
            ...editState,
            filters: { ...DEFAULT_FILTERS },
        });
    }, [editState, pushHistory]);

    /**
     * Reset all edits
     */
    const resetAll = useCallback(() => {
        pushHistory(DEFAULT_EDIT_STATE);
    }, [pushHistory]);

    /**
     * Save the edited image
     */
    const handleSave = useCallback(async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        setIsSaving(true);
        setSaveError(null);

        try {
            // Get the edited image as data URL
            const editedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
            await onSave(editedDataUrl);
        } catch (error) {
            console.error('Failed to save edited image:', error);
            setSaveError('Failed to save image. Please try again.');
        } finally {
            setIsSaving(false);
        }
    }, [onSave]);

    const canUndo = historyIndex > 0;
    const canRedo = historyIndex < history.length - 1;
    const hasChanges = historyIndex > 0;

    return (
        <Card className="p-4 bg-slate-900">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">Edit Photo</h3>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={undo}
                        disabled={!canUndo}
                        className="p-2 text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Undo"
                        aria-label="Undo"
                    >
                        <Undo2 className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={redo}
                        disabled={!canRedo}
                        className="p-2 text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Redo"
                        aria-label="Redo"
                    >
                        <Redo2 className="w-5 h-5" />
                    </button>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="p-2 text-white/60 hover:text-white"
                        aria-label="Close editor"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Canvas Preview */}
            <div className="relative bg-black rounded-lg overflow-hidden mb-4 flex items-center justify-center min-h-[300px]">
                <canvas
                    ref={canvasRef}
                    className="max-w-full max-h-[400px] object-contain"
                />
            </div>

            {/* Tool Tabs */}
            <div className="flex gap-2 mb-4">
                <button
                    type="button"
                    onClick={() => setActiveTab(activeTab === 'filters' ? null : 'filters')}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg transition-colors ${activeTab === 'filters'
                        ? 'bg-cyan-500 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                >
                    <Sun className="w-4 h-4" />
                    Adjust
                </button>
                <button
                    type="button"
                    onClick={rotateLeft}
                    className="flex items-center justify-center gap-2 p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                    title="Rotate left"
                >
                    <RotateCcw className="w-4 h-4" />
                </button>
                <button
                    type="button"
                    onClick={rotateRight}
                    className="flex items-center justify-center gap-2 p-3 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 transition-colors"
                    title="Rotate right"
                >
                    <RotateCw className="w-4 h-4" />
                </button>
            </div>

            {/* Filter Controls */}
            {activeTab === 'filters' && (
                <div className="space-y-4 p-4 bg-slate-800 rounded-lg mb-4">
                    {/* Brightness */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label htmlFor="brightness-slider" className="text-sm text-slate-300 flex items-center gap-2">
                                <Sun className="w-4 h-4" />
                                Brightness
                            </label>
                            <span className="text-sm text-slate-400">{previewFilters?.brightness ?? editState.filters.brightness}%</span>
                        </div>
                        <input
                            id="brightness-slider"
                            type="range"
                            min={0}
                            max={200}
                            value={previewFilters?.brightness ?? editState.filters.brightness}
                            onChange={(e) => handleFilterPreview('brightness', parseInt(e.target.value))}
                            onPointerUp={commitFilterChange}
                            onTouchEnd={commitFilterChange}
                            className="w-full h-2 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                        />
                    </div>

                    {/* Contrast */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label htmlFor="contrast-slider" className="text-sm text-slate-300 flex items-center gap-2">
                                <Contrast className="w-4 h-4" />
                                Contrast
                            </label>
                            <span className="text-sm text-slate-400">{previewFilters?.contrast ?? editState.filters.contrast}%</span>
                        </div>
                        <input
                            id="contrast-slider"
                            type="range"
                            min={0}
                            max={200}
                            value={previewFilters?.contrast ?? editState.filters.contrast}
                            onChange={(e) => handleFilterPreview('contrast', parseInt(e.target.value))}
                            onPointerUp={commitFilterChange}
                            onTouchEnd={commitFilterChange}
                            className="w-full h-2 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                        />
                    </div>

                    {/* Saturation */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label htmlFor="saturation-slider" className="text-sm text-slate-300 flex items-center gap-2">
                                <Palette className="w-4 h-4" />
                                Saturation
                            </label>
                            <span className="text-sm text-slate-400">{previewFilters?.saturation ?? editState.filters.saturation}%</span>
                        </div>
                        <input
                            id="saturation-slider"
                            type="range"
                            min={0}
                            max={200}
                            value={previewFilters?.saturation ?? editState.filters.saturation}
                            onChange={(e) => handleFilterPreview('saturation', parseInt(e.target.value))}
                            onPointerUp={commitFilterChange}
                            onTouchEnd={commitFilterChange}
                            className="w-full h-2 bg-slate-700 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-cyan-500 [&::-webkit-slider-thumb]:rounded-full"
                        />
                    </div>

                    {/* Reset Filters Button */}
                    <button
                        type="button"
                        onClick={resetFilters}
                        className="w-full flex items-center justify-center gap-2 p-2 text-sm text-slate-400 hover:text-white transition-colors"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Reset Adjustments
                    </button>
                </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3">
                <Button
                    type="button"
                    variant="outline"
                    onClick={onCancel}
                    className="flex-1 border-slate-600 text-slate-300 hover:bg-slate-800"
                >
                    Cancel
                </Button>
                <Button
                    type="button"
                    variant="outline"
                    onClick={resetAll}
                    disabled={!hasChanges}
                    className="border-slate-600 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    aria-label="Reset all edits"
                    title="Reset all edits"
                >
                    <RefreshCw className="w-4 h-4" />
                </Button>
                <Button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="flex-1 bg-cyan-500 hover:bg-cyan-600 text-white"
                >
                    {isSaving ? (
                        <>
                            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Saving...
                        </>
                    ) : (
                        <>
                            <Check className="w-4 h-4" />
                            Save Changes
                        </>
                    )}
                </Button>
            </div>
            {saveError && (
                <p className="text-red-400 text-sm mt-2 text-center">{saveError}</p>
            )}
        </Card>
    );
}

export default PhotoEditor;
