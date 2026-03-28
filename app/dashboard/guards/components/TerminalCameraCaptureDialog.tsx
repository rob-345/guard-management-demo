"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Camera, Check, Loader2, Move, RotateCcw, ScanFace, Slash } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { getApiErrorMessage } from "@/lib/http";
import type { Terminal } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terminals: Terminal[];
  initialTerminalId?: string | null;
  onUsePhoto: (file: File, terminal: Terminal) => void;
}

const TARGET_ASPECT_RATIO = 4 / 5;
const MAX_OUTPUT_WIDTH = 720;
const EDITOR_VIEWPORT_WIDTH = 320;

type CaptureState = "idle" | "capturing" | "capture_busy" | "capture_ready" | "failed";
type ProcessedCapture = {
  file: File;
  originalSize: number;
  processedSize: number;
  originalWidth: number;
  originalHeight: number;
  outputWidth: number;
  outputHeight: number;
};

function terminalLabel(terminal: Terminal) {
  const parts = [terminal.name];
  if (terminal.ip_address) {
    parts.push(terminal.ip_address);
  }
  return parts.join(" · ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseCaptureFileName(terminal: Terminal, headers: Headers, contentType: string) {
  const disposition = headers.get("content-disposition") || "";
  const match = disposition.match(/filename="?([^"]+)"?/i);
  if (match?.[1]) {
    return match[1];
  }

  const ext = contentType.includes("png") ? "png" : "jpg";
  return `${slugify(terminal.name) || "terminal"}-capture-${Date.now()}.${ext}`;
}

function terminalCaptureReason(terminal: Terminal) {
  if (terminal.status !== "online") {
    return "The terminal is offline. Probe it again before capturing a face.";
  }

  if (terminal.activation_status && terminal.activation_status !== "activated") {
    return "The terminal must be activated before it can capture a guard face.";
  }

  return null;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Failed to create cropped image"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      quality
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Failed to load captured face image"));
    };

    image.src = objectUrl;
  });
}

async function processCapturedFile(
  file: File,
  zoom: number,
  offsetX: number,
  offsetY: number,
  terminal: Terminal | null
): Promise<ProcessedCapture> {
  const image = await loadImage(file);
  const originalWidth = image.naturalWidth || image.width;
  const originalHeight = image.naturalHeight || image.height;

  if (!originalWidth || !originalHeight) {
    throw new Error("Captured face image has invalid dimensions");
  }

  const maxCropWidth = Math.min(originalWidth, originalHeight * TARGET_ASPECT_RATIO);
  const cropWidth = maxCropWidth / zoom;
  const cropHeight = cropWidth / TARGET_ASPECT_RATIO;
  const maxOffsetX = Math.max(0, originalWidth - cropWidth);
  const maxOffsetY = Math.max(0, originalHeight - cropHeight);
  const sourceX = maxOffsetX * (offsetX / 100);
  const sourceY = maxOffsetY * (offsetY / 100);

  let outputWidth = Math.min(Math.round(cropWidth), MAX_OUTPUT_WIDTH);
  let outputHeight = Math.round(outputWidth / TARGET_ASPECT_RATIO);

  if (outputWidth < 1 || outputHeight < 1) {
    throw new Error("Crop area is too small");
  }

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Image processing is unavailable in this browser");
  }

  const draw = (width: number, height: number) => {
    canvas.width = width;
    canvas.height = height;
    context.clearRect(0, 0, width, height);
    context.drawImage(image, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height);
  };

  draw(outputWidth, outputHeight);

  const blob = await canvasToBlob(canvas, 1);

  const baseName = slugify(terminal?.name || "terminal") || "terminal";
  const processedFile = new File([blob], `${baseName}-capture-${Date.now()}.jpg`, {
    type: "image/jpeg"
  });

  return {
    file: processedFile,
    originalSize: file.size,
    processedSize: processedFile.size,
    originalWidth,
    originalHeight,
    outputWidth,
    outputHeight
  };
}

export function TerminalCameraCaptureDialog({
  open,
  onOpenChange,
  terminals,
  initialTerminalId,
  onUsePhoto
}: Props) {
  const cropViewportRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originOffsetX: number;
    originOffsetY: number;
    width: number;
    height: number;
  } | null>(null);

  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);
  const [capturedDimensions, setCapturedDimensions] = useState<{ width: number; height: number } | null>(null);
  const [processedCapture, setProcessedCapture] = useState<ProcessedCapture | null>(null);
  const [processedPreviewUrl, setProcessedPreviewUrl] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [captureMessage, setCaptureMessage] = useState<string | null>(null);
  const [cancellingCapture, setCancellingCapture] = useState(false);
  const [cropZoom, setCropZoom] = useState(1.15);
  const [cropOffsetX, setCropOffsetX] = useState(50);
  const [cropOffsetY, setCropOffsetY] = useState(50);
  const [draggingCrop, setDraggingCrop] = useState(false);

  useEffect(() => {
    if (!open) {
      setCapturedFile(null);
      setCapturedPreviewUrl(null);
      setCapturedDimensions(null);
      setProcessedCapture(null);
      setProcessedPreviewUrl(null);
      setProcessing(false);
      setCaptureState("idle");
      setCaptureMessage(null);
      setCropZoom(1.15);
      setCropOffsetX(50);
      setCropOffsetY(50);
      setDraggingCrop(false);
      dragStateRef.current = null;
      return;
    }

    const resolvedTerminalId =
      (initialTerminalId && terminals.some((terminal) => terminal.id === initialTerminalId)
        ? initialTerminalId
        : terminals[0]?.id) || "";

    setSelectedTerminalId(resolvedTerminalId);
    setCapturedFile(null);
    setCapturedPreviewUrl(null);
    setCapturedDimensions(null);
    setProcessedCapture(null);
    setProcessedPreviewUrl(null);
    setCaptureState("idle");
    setCaptureMessage(null);
    setCropZoom(1.15);
    setCropOffsetX(50);
    setCropOffsetY(50);
    setDraggingCrop(false);
  }, [open, initialTerminalId, terminals]);

  useEffect(() => {
    if (!capturedFile) {
      setCapturedPreviewUrl(null);
      setCapturedDimensions(null);
      return;
    }

    const objectUrl = URL.createObjectURL(capturedFile);
    setCapturedPreviewUrl(objectUrl);
    void loadImage(capturedFile)
      .then((image) => {
        setCapturedDimensions({
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height
        });
      })
      .catch(() => {
        setCapturedDimensions(null);
      });

    return () => URL.revokeObjectURL(objectUrl);
  }, [capturedFile]);

  useEffect(() => {
    if (!processedCapture) {
      setProcessedPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(processedCapture.file);
    setProcessedPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [processedCapture]);

  const selectedTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === selectedTerminalId) || null,
    [selectedTerminalId, terminals]
  );
  const captureBlockedReason = selectedTerminal ? terminalCaptureReason(selectedTerminal) : null;
  const readyCapture = processedCapture;
  const canUseProcessedPhoto = Boolean(readyCapture);

  useEffect(() => {
    if (!capturedFile) {
      setProcessedCapture(null);
      return;
    }

    let active = true;
    setProcessing(true);

    const timer = window.setTimeout(() => {
      void processCapturedFile(capturedFile, cropZoom, cropOffsetX, cropOffsetY, selectedTerminal)
        .then((nextCapture) => {
          if (!active) return;
          setProcessedCapture(nextCapture);
        })
        .catch((error) => {
          if (!active) return;
          setProcessedCapture(null);
          toast.error(
            `Failed to prepare captured photo: ${error instanceof Error ? error.message : String(error)}`
          );
        })
        .finally(() => {
          if (!active) return;
          setProcessing(false);
        });
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [capturedFile, cropZoom, cropOffsetX, cropOffsetY, selectedTerminal]);

  const cropPreviewMetrics = useMemo(() => {
    if (!capturedDimensions) {
      return null;
    }

    const viewportWidth = EDITOR_VIEWPORT_WIDTH;
    const viewportHeight = Math.round(viewportWidth / TARGET_ASPECT_RATIO);
    const imageAspect = capturedDimensions.width / capturedDimensions.height;

    let baseWidth = viewportWidth;
    let baseHeight = viewportHeight;

    if (imageAspect > TARGET_ASPECT_RATIO) {
      baseHeight = viewportHeight;
      baseWidth = baseHeight * imageAspect;
    } else {
      baseWidth = viewportWidth;
      baseHeight = baseWidth / imageAspect;
    }

    const displayWidth = baseWidth * cropZoom;
    const displayHeight = baseHeight * cropZoom;
    const translateX = -Math.max(0, displayWidth - viewportWidth) * (cropOffsetX / 100);
    const translateY = -Math.max(0, displayHeight - viewportHeight) * (cropOffsetY / 100);

    return {
      viewportWidth,
      viewportHeight,
      displayWidth,
      displayHeight,
      translateX,
      translateY
    };
  }, [capturedDimensions, cropOffsetX, cropOffsetY, cropZoom]);

  function resetCapture() {
    setCapturedFile(null);
    setProcessedCapture(null);
    setCaptureState("idle");
    setCaptureMessage(null);
    setCropZoom(1.15);
    setCropOffsetX(50);
    setCropOffsetY(50);
  }

  async function captureFromTerminal() {
    if (!selectedTerminal) {
      toast.error("Choose a terminal before capturing a face");
      return;
    }

    if (captureBlockedReason) {
      toast.error(captureBlockedReason);
      return;
    }

    setCaptureState("capturing");
    setCaptureMessage("Look straight at the terminal camera while it captures the guard face.");

    try {
      const res = await fetch(`/api/terminals/${selectedTerminal.id}/capture-face`, {
        method: "POST"
      });

      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        setCaptureState("capture_busy");
        setCaptureMessage(
          typeof data?.error === "string" && data.error.trim()
            ? data.error
            : "The terminal is busy capturing another face. Cancel the session and retry."
        );
        return;
      }

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to capture face from terminal"));
      }

      const blob = await res.blob();
      const contentType = blob.type || res.headers.get("content-type") || "image/jpeg";
      const file = new File([blob], parseCaptureFileName(selectedTerminal, res.headers, contentType), {
        type: contentType
      });

      setCapturedFile(file);
      setProcessedCapture(null);
      setCropZoom(1.15);
      setCropOffsetX(50);
      setCropOffsetY(50);
      setCaptureState("capture_ready");
      setCaptureMessage("Face captured from the terminal. Drag the image to center the face, then confirm.");
    } catch (error) {
      setCaptureState("failed");
      setCaptureMessage(error instanceof Error ? error.message : String(error));
      toast.error(
        `Failed to capture face from terminal: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async function cancelCaptureSession() {
    if (!selectedTerminal) {
      return;
    }

    setCancellingCapture(true);
    try {
      const res = await fetch(`/api/terminals/${selectedTerminal.id}/capture-face/cancel`, {
        method: "POST"
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to cancel terminal capture"));
      }

      setCaptureState(capturedFile ? "capture_ready" : "idle");
      setCaptureMessage(capturedFile ? captureMessage : "The terminal capture session was cancelled.");
      toast.success("Terminal capture session cleared");
    } catch (error) {
      toast.error(
        `Failed to cancel terminal capture: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setCancellingCapture(false);
    }
  }

  function handleCropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropViewportRef.current || !capturedFile) {
      return;
    }

    const rect = cropViewportRef.current.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originOffsetX: cropOffsetX,
      originOffsetY: cropOffsetY,
      width: rect.width,
      height: rect.height
    };
    setDraggingCrop(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleCropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const nextOffsetX = drag.originOffsetX - ((event.clientX - drag.startX) / drag.width) * 100;
    const nextOffsetY = drag.originOffsetY - ((event.clientY - drag.startY) / drag.height) * 100;
    setCropOffsetX(clamp(nextOffsetX, 0, 100));
    setCropOffsetY(clamp(nextOffsetY, 0, 100));
  }

  function handleCropPointerEnd(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragStateRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    setDraggingCrop(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Capture Guard Face From Terminal</DialogTitle>
          <DialogDescription>
            This uses Hikvision&apos;s device-side face capture flow, then lets you crop
            the photo before the guard is saved and synced back to the terminal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Source Terminal</p>
              {selectedTerminal ? (
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{selectedTerminal.status}</Badge>
                  <Badge variant="outline">{selectedTerminal.activation_status || "unknown"}</Badge>
                </div>
              ) : null}
            </div>
            <Select
              value={selectedTerminalId}
              onValueChange={(value) => {
                setSelectedTerminalId(value);
                resetCapture();
              }}
              disabled={terminals.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a terminal" />
              </SelectTrigger>
              <SelectContent>
                {terminals.map((terminal) => (
                  <SelectItem
                    key={terminal.id}
                    value={terminal.id}
                    disabled={Boolean(terminalCaptureReason(terminal))}>
                    {terminalLabel(terminal)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {terminals.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Register a terminal before using the terminal-camera capture flow.
              </p>
            ) : null}
            {captureBlockedReason ? (
              <p className="text-xs text-amber-700">{captureBlockedReason}</p>
            ) : null}
          </div>

          <div className="rounded-xl border bg-muted/20 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Terminal Capture Session</p>
                <p className="text-xs text-muted-foreground">
                  Capture uses the terminal camera directly. Once a face comes back, we crop it to a
                  portrait image before saving.
                </p>
              </div>
              <Badge variant="outline">{captureState.replaceAll("_", " ")}</Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => void captureFromTerminal()}
                disabled={!selectedTerminal || Boolean(captureBlockedReason) || captureState === "capturing"}>
                {captureState === "capturing" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="mr-2 h-4 w-4" />
                )}
                Capture From Terminal
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void cancelCaptureSession()}
                disabled={!selectedTerminal || cancellingCapture || captureState === "idle"}>
                {cancellingCapture ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Slash className="mr-2 h-4 w-4" />
                )}
                Cancel Session
              </Button>
              {capturedFile ? (
                <Button type="button" variant="ghost" onClick={resetCapture}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Retake
                </Button>
              ) : null}
            </div>

            <div className="mt-3 rounded-lg border bg-background/80 p-3 text-sm text-muted-foreground">
              {captureMessage || "When you are ready, ask the guard to look straight into the terminal and trigger capture."}
            </div>
          </div>

          {capturedFile ? (
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="space-y-3">
                <div className="rounded-lg border bg-background p-3">
                  <div className="mb-3 flex items-center gap-2">
                    <Move className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Crop Editor</p>
                      <p className="text-xs text-muted-foreground">
                        Drag the image inside the portrait frame to center the face. Fine-tune with the
                        sliders if you need a more precise crop.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div
                      ref={cropViewportRef}
                      className="relative mx-auto w-full max-w-xs overflow-hidden rounded-lg border bg-muted/20"
                      style={{
                        aspectRatio: `${TARGET_ASPECT_RATIO}`,
                        touchAction: "none",
                        cursor: capturedPreviewUrl ? (draggingCrop ? "grabbing" : "grab") : "default"
                      }}
                      onPointerDown={handleCropPointerDown}
                      onPointerMove={handleCropPointerMove}
                      onPointerUp={handleCropPointerEnd}
                      onPointerCancel={handleCropPointerEnd}
                      onPointerLeave={handleCropPointerEnd}>
                      {capturedPreviewUrl && cropPreviewMetrics ? (
                        <img
                          src={capturedPreviewUrl}
                          alt="Captured guard face"
                          className="absolute left-0 top-0 max-w-none select-none"
                          draggable={false}
                          style={{
                            width: `${cropPreviewMetrics.displayWidth}px`,
                            height: `${cropPreviewMetrics.displayHeight}px`,
                            transform: `translate(${cropPreviewMetrics.translateX}px, ${cropPreviewMetrics.translateY}px)`
                          }}
                        />
                      ) : null}
                      <div className="pointer-events-none absolute inset-0 border border-white/70" />
                      <div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/40" />
                      <div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/25" />
                      <div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/25" />
                      <div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/25" />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Zoom</span>
                        <span>{cropZoom.toFixed(2)}x</span>
                      </div>
                      <Slider
                        value={[cropZoom]}
                        min={1}
                        max={2.5}
                        step={0.05}
                        onValueChange={(values) => setCropZoom(clamp(values[0] ?? 1.15, 1, 2.5))}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Horizontal</span>
                        <span>{Math.round(cropOffsetX)}%</span>
                      </div>
                      <Slider
                        value={[cropOffsetX]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(values) => setCropOffsetX(clamp(values[0] ?? 50, 0, 100))}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Vertical</span>
                        <span>{Math.round(cropOffsetY)}%</span>
                      </div>
                      <Slider
                        value={[cropOffsetY]}
                        min={0}
                        max={100}
                        step={1}
                        onValueChange={(values) => setCropOffsetY(clamp(values[0] ?? 50, 0, 100))}
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-background p-3 text-sm">
                  <div className="mb-2 flex items-center gap-2">
                    <ScanFace className="h-4 w-4 text-muted-foreground" />
                    <p className="font-medium">Face Quality Checklist</p>
                  </div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    <li>One face only, looking straight at the camera.</li>
                    <li>Eyes, nose, and mouth should stay fully visible.</li>
                    <li>Use even lighting and avoid motion blur.</li>
                    <li>Avoid hats, masks, sunglasses, and heavy shadows.</li>
                    <li>Keep the face centered with head and shoulders in frame.</li>
                  </ul>
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Processed Portrait
                    </p>
                      {processedCapture ? (
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{formatBytes(processedCapture.processedSize)}</Badge>
                          <Badge variant="outline">
                            {processedCapture.outputWidth}×{processedCapture.outputHeight}
                          </Badge>
                        </div>
                      ) : null}
                  </div>

                  <div className="relative mx-auto w-full max-w-xs overflow-hidden rounded-lg border bg-background">
                    <div className="aspect-[4/5]">
                      {processedPreviewUrl ? (
                        <img
                          src={processedPreviewUrl}
                          alt="Processed guard portrait"
                          className="h-full w-full object-cover"
                        />
                      ) : null}
                    </div>
                    {processing ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : null}
                  </div>
                </div>

                {processedCapture ? (
                  <div className="rounded-lg border bg-background p-3 text-xs text-muted-foreground">
                    <p>
                      Original: {processedCapture.originalWidth}×{processedCapture.originalHeight} ·{" "}
                      {formatBytes(processedCapture.originalSize)}
                    </p>
                    <p>
                      Ready to save: {processedCapture.outputWidth}×{processedCapture.outputHeight} ·{" "}
                      {formatBytes(processedCapture.processedSize)}
                    </p>
                    <p className="mt-2 text-foreground">
                      This processed portrait will be saved to GridFS and used for immediate terminal sync.
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="flex min-h-56 items-center justify-center rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
              <div className="space-y-2 text-center">
                <Camera className="mx-auto h-8 w-8 opacity-30" />
                <p>Capture a guard face from the terminal to begin editing.</p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!selectedTerminal || !readyCapture || processing || !canUseProcessedPhoto}
            onClick={() => {
              if (!readyCapture || !selectedTerminal) return;
              onUsePhoto(readyCapture.file, selectedTerminal);
              toast.success("Captured face added to guard registration");
              onOpenChange(false);
            }}>
            <Check className="mr-2 h-4 w-4" />
            Use This Photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
