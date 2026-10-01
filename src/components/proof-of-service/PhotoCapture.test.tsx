import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cameraMock = vi.hoisted(() => ({
  isNativeCameraAvailable: vi.fn(() => false),
  isNativeMultiPickAvailable: vi.fn(() => false),
  pickNativePhotos: vi.fn(),
  takeNativePhoto: vi.fn(),
}));

const proofMock = vi.hoisted(() => ({
  compressImage: vi.fn(async (dataUrl: string) => ({
    dataUrl: `${dataUrl}#compressed`,
    originalSize: 1000,
    compressedSize: 400,
    compressionRatio: 0.4,
    width: 1920,
    height: 1080,
  })),
  getCurrentLocation: vi.fn(async () => ({ success: false, location: null, error: 'denied' })),
  savePhoto: vi.fn(async () => undefined),
}));

vi.mock('@/lib/native/camera', () => cameraMock);
vi.mock('@/lib/proof-of-service', async () => {
  const actual = await vi.importActual<typeof import('@/lib/proof-of-service')>('@/lib/proof-of-service');
  return {
    ...actual,
    compressImage: proofMock.compressImage,
    getCurrentLocation: proofMock.getCurrentLocation,
    savePhoto: proofMock.savePhoto,
  };
});

import { BURST_INTERVAL_MS, BURST_MAX_FRAMES, HOLD_TO_BURST_MS, PhotoCapture } from './PhotoCapture';

let frameCounter = 0;

function installWebCamera() {
  const track = { stop: vi.fn(), getCapabilities: () => ({}), applyConstraints: vi.fn() };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => stream),
      enumerateDevices: vi.fn(async () => [{ kind: 'videoinput' }]),
    },
  });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => undefined);
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => {
    frameCounter += 1;
    return `data:image/jpeg;base64,frame${frameCounter}`;
  });
  return { track };
}

async function openWebCamera(category: 'before' | 'after' = 'after') {
  fireEvent.click(screen.getByRole('button', { name: `Capture ${category} photo` }));
  await screen.findByTestId('shutter-button');
  await waitFor(() => expect(screen.getByTestId('shutter-button')).toBeEnabled());
}

describe('PhotoCapture burst mode', () => {
  const onPhotoCapture = vi.fn();

  beforeEach(() => {
    frameCounter = 0;
    vi.clearAllMocks();
    cameraMock.isNativeCameraAvailable.mockReturnValue(false);
    cameraMock.isNativeMultiPickAvailable.mockReturnValue(false);
    installWebCamera();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('captures a five-frame burst from the web stream, lets frames be deselected, and attaches the rest', async () => {
    render(<PhotoCapture serviceLogId={null} customerId="c1" category="after" onPhotoCapture={onPhotoCapture} />);
    await openWebCamera();

    const burstToggle = screen.getByTestId('burst-toggle');
    expect(burstToggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(burstToggle);
    expect(burstToggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('shutter-button')).toHaveAccessibleName('Capture after burst');

    fireEvent.click(screen.getByTestId('shutter-button'));

    const review = await screen.findByTestId('burst-review', undefined, { timeout: 4000 });
    const frames = within(review).getAllByRole('button', { name: /^Frame \d/ });
    expect(frames).toHaveLength(BURST_MAX_FRAMES);
    expect(proofMock.compressImage).toHaveBeenCalledTimes(BURST_MAX_FRAMES);
    expect(proofMock.compressImage).toHaveBeenCalledWith(
      expect.stringContaining('data:image/jpeg'),
      { quality: 0.85, maxWidth: 1920, maxHeight: 1080, format: 'jpeg' }
    );
    expect(within(review).getByText('5 after frames captured')).toBeInTheDocument();
    expect(within(review).getByText(/5 selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('burst-frame-2'));
    expect(screen.getByTestId('burst-frame-2')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('burst-frame-2')).toHaveAccessibleName('Frame 2, not selected');
    expect(within(review).getByText(/4 selected/)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('burst-attach'));

    await waitFor(() => expect(onPhotoCapture).toHaveBeenCalledTimes(4));
    expect(proofMock.savePhoto).toHaveBeenCalledTimes(4);
    expect(proofMock.getCurrentLocation).toHaveBeenCalledTimes(1);
    for (const [photo] of onPhotoCapture.mock.calls) {
      expect(photo).toMatchObject({ category: 'after', location: null });
      expect(photo.dataUrl).toContain('#compressed');
      expect(photo.dataUrl).not.toContain('frame2#');
    }
    expect(await screen.findByText('4 captured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add more/ })).toBeInTheDocument();
  });

  it('discards a burst without attaching anything', async () => {
    render(<PhotoCapture serviceLogId={null} customerId="c1" category="before" onPhotoCapture={onPhotoCapture} />);
    await openWebCamera('before');
    fireEvent.click(screen.getByTestId('burst-toggle'));
    fireEvent.click(screen.getByTestId('shutter-button'));
    await screen.findByTestId('burst-review', undefined, { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: 'Discard all frames' }));
    expect(screen.queryByTestId('burst-review')).not.toBeInTheDocument();
    expect(onPhotoCapture).not.toHaveBeenCalled();
    expect(proofMock.savePhoto).not.toHaveBeenCalled();
  });

  it('disables attach when every frame is deselected', async () => {
    render(<PhotoCapture serviceLogId={null} customerId="c1" category="before" onPhotoCapture={onPhotoCapture} />);
    await openWebCamera('before');
    fireEvent.click(screen.getByTestId('burst-toggle'));
    fireEvent.click(screen.getByTestId('shutter-button'));
    await screen.findByTestId('burst-review', undefined, { timeout: 4000 });

    for (let index = 1; index <= BURST_MAX_FRAMES; index += 1) {
      fireEvent.click(screen.getByTestId(`burst-frame-${index}`));
    }
    expect(screen.getByTestId('burst-attach')).toBeDisabled();
  });

  it('starts a burst on tap-and-hold and keeps a short tap as a single capture', async () => {
    render(<PhotoCapture serviceLogId={null} customerId="c1" category="after" onPhotoCapture={onPhotoCapture} />);
    await openWebCamera();
    const shutter = screen.getByTestId('shutter-button');

    // Short tap: single capture, no review strip.
    fireEvent.pointerDown(shutter);
    fireEvent.pointerUp(shutter);
    fireEvent.click(shutter);
    await waitFor(() => expect(onPhotoCapture).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('burst-review')).not.toBeInTheDocument();
    // Single capture hands the photo to the parent and releases the camera.
    expect(await screen.findByRole('button', { name: 'Capture after photo' })).toBeInTheDocument();

    // Hold: burst.
    await openWebCamera();
    const shutterAgain = screen.getByTestId('shutter-button');
    fireEvent.pointerDown(shutterAgain);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, HOLD_TO_BURST_MS + 50));
    });
    fireEvent.pointerUp(shutterAgain);
    fireEvent.click(shutterAgain);

    const review = await screen.findByTestId('burst-review', undefined, { timeout: 4000 });
    expect(within(review).getAllByRole('button', { name: /^Frame \d/ }).length).toBeGreaterThanOrEqual(1);
    expect(onPhotoCapture).toHaveBeenCalledTimes(1);
  });

  it('offers gallery multi-select on native and reviews the picked photos', async () => {
    cameraMock.isNativeCameraAvailable.mockReturnValue(true);
    cameraMock.isNativeMultiPickAvailable.mockReturnValue(true);
    cameraMock.pickNativePhotos.mockResolvedValue([
      { dataUrl: 'data:image/jpeg;base64,g1', format: 'jpeg' },
      { dataUrl: 'data:image/jpeg;base64,g2', format: 'jpeg' },
      { dataUrl: 'data:image/jpeg;base64,g3', format: 'jpeg' },
    ]);

    render(<PhotoCapture serviceLogId="log-9" customerId="c1" category="before" onPhotoCapture={onPhotoCapture} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose up to 5 before photos from your library' }));
    expect(cameraMock.pickNativePhotos).toHaveBeenCalledWith(BURST_MAX_FRAMES);

    const review = await screen.findByTestId('burst-review');
    expect(within(review).getAllByRole('button', { name: /^Frame \d/ })).toHaveLength(3);
    expect(proofMock.compressImage).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByTestId('burst-attach'));
    await waitFor(() => expect(onPhotoCapture).toHaveBeenCalledTimes(3));
    expect(proofMock.savePhoto).toHaveBeenCalledWith(expect.objectContaining({ category: 'before' }), 'c1', 'log-9');
  });

  it('stays quiet when the native picker is cancelled', async () => {
    cameraMock.isNativeCameraAvailable.mockReturnValue(true);
    cameraMock.isNativeMultiPickAvailable.mockReturnValue(true);
    cameraMock.pickNativePhotos.mockRejectedValue(new Error('User cancelled photos app'));

    render(<PhotoCapture serviceLogId={null} customerId="c1" category="before" onPhotoCapture={onPhotoCapture} />);
    fireEvent.click(screen.getByRole('button', { name: /Choose up to 5/ }));

    await waitFor(() => expect(cameraMock.pickNativePhotos).toHaveBeenCalled());
    expect(screen.queryByTestId('burst-review')).not.toBeInTheDocument();
    expect(screen.queryByTestId('camera-error-message')).not.toBeInTheDocument();
  });

  it('labels every camera control', async () => {
    render(<PhotoCapture serviceLogId={null} customerId="c1" category="after" onPhotoCapture={onPhotoCapture} />);
    await openWebCamera();
    expect(screen.getByRole('button', { name: 'Toggle grid' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close camera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Burst mode off' })).toHaveClass('h-11', 'w-11');
    expect(BURST_INTERVAL_MS).toBeGreaterThan(0);
  });
});
