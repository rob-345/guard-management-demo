"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Camera, Loader2, Pause, Play, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/http";
import type { Terminal } from "@/lib/types";

interface Props {
  terminal: Terminal;
  title?: string;
  description?: string;
  className?: string;
  actions?: ReactNode;
  onCapture?: (file: File) => void | Promise<void>;
  captureLabel?: string;
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function snapshotFileName(terminal: Terminal, contentType: string) {
  const base = slugify(terminal.name) || "terminal";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return `${base}-snapshot-${Date.now()}.${ext}`;
}

export function TerminalSnapshotCard({
  terminal,
  title = "Camera Snapshot",
  description = "A server-proxied snapshot fetched from the Hikvision terminal.",
  className,
  actions,
  onCapture,
  captureLabel = "Capture Snapshot",
  autoRefresh = true,
  refreshIntervalMs = 1200
}: Props) {
  const [refreshTick, setRefreshTick] = useState(0);
  const [paused, setPaused] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);
  const [imageError, setImageError] = useState(false);
  const [captureLoading, setCaptureLoading] = useState(false);

  const snapshotUrl = useMemo(
    () => `/api/terminals/${terminal.id}/snapshot?ts=${refreshTick}`,
    [refreshTick, terminal.id]
  );

  useEffect(() => {
    if (!autoRefresh || paused) {
      return;
    }

    const timer = window.setInterval(() => {
      setRefreshTick((current) => current + 1);
    }, refreshIntervalMs);

    return () => window.clearInterval(timer);
  }, [autoRefresh, paused, refreshIntervalMs]);

  function refreshSnapshot() {
    setImageLoading(true);
    setImageError(false);
    setRefreshTick((current) => current + 1);
  }

  async function captureSnapshot() {
    if (!onCapture) return;

    setCaptureLoading(true);
    try {
      const res = await fetch(`/api/terminals/${terminal.id}/snapshot?ts=${Date.now()}`, {
        cache: "no-store"
      });

      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, "Failed to capture snapshot"));
      }

      const blob = await res.blob();
      const contentType = blob.type || res.headers.get("content-type") || "image/jpeg";
      const file = new File([blob], snapshotFileName(terminal, contentType), {
        type: contentType
      });
      await onCapture(file);
    } catch (error) {
      toast.error(
        `Failed to capture snapshot: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      setCaptureLoading(false);
    }
  }

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="border-b bg-muted/20 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            <CardDescription className="text-xs">{description}</CardDescription>
          </div>
          <Badge variant="outline" className={paused ? "border-amber-500/30 text-amber-700" : ""}>
            {paused ? "Paused" : "Live"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        <div className="overflow-hidden rounded-xl border bg-muted/20">
          {imageError ? (
            <div className="flex min-h-64 items-center justify-center px-6 py-12 text-center text-sm text-muted-foreground">
              <div className="space-y-2">
                <Camera className="mx-auto h-8 w-8 opacity-30" />
                <p>Snapshot unavailable.</p>
                <p className="text-xs">Check terminal connectivity or refresh the preview.</p>
              </div>
            </div>
          ) : (
            <div className="relative">
              <img
                key={snapshotUrl}
                src={snapshotUrl}
                alt={`${terminal.name} camera snapshot`}
                className="block h-64 w-full object-cover"
                onLoad={() => {
                  setImageLoading(false);
                  setImageError(false);
                }}
                onError={() => {
                  setImageLoading(false);
                  setImageError(true);
                }}
              />
              {imageLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={refreshSnapshot}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh snapshot
          </Button>
          <Button type="button" variant="outline" onClick={() => setPaused((value) => !value)}>
            {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
            {paused ? "Resume" : "Pause"}
          </Button>
          {onCapture ? (
            <Button type="button" onClick={captureSnapshot} disabled={captureLoading}>
              {captureLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
              {captureLabel}
            </Button>
          ) : null}
          {actions}
        </div>
      </CardContent>
    </Card>
  );
}
