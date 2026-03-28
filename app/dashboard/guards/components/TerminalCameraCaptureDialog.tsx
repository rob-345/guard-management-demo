"use client";

import { useEffect, useMemo, useState } from "react";
import { Camera, RotateCcw, Check } from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { TerminalSnapshotCard } from "@/app/dashboard/terminals/components/TerminalSnapshotCard";
import type { Terminal } from "@/lib/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  terminals: Terminal[];
  initialTerminalId?: string | null;
  onUsePhoto: (file: File, terminal: Terminal) => void;
}

function terminalLabel(terminal: Terminal) {
  const parts = [terminal.name];
  if (terminal.ip_address) {
    parts.push(terminal.ip_address);
  }
  return parts.join(" · ");
}

export function TerminalCameraCaptureDialog({
  open,
  onOpenChange,
  terminals,
  initialTerminalId,
  onUsePhoto
}: Props) {
  const [selectedTerminalId, setSelectedTerminalId] = useState<string>("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [capturedPreviewUrl, setCapturedPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCapturedFile(null);
      setCapturedPreviewUrl(null);
      return;
    }

    const resolvedTerminalId =
      (initialTerminalId && terminals.some((terminal) => terminal.id === initialTerminalId)
        ? initialTerminalId
        : terminals[0]?.id) || "";

    setSelectedTerminalId(resolvedTerminalId);
    setCapturedFile(null);
    setCapturedPreviewUrl(null);
  }, [open, initialTerminalId, terminals]);

  useEffect(() => {
    if (!capturedFile) {
      setCapturedPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(capturedFile);
    setCapturedPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [capturedFile]);

  const selectedTerminal = useMemo(
    () => terminals.find((terminal) => terminal.id === selectedTerminalId) || null,
    [selectedTerminalId, terminals]
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Capture Guard Photo From Terminal</DialogTitle>
          <DialogDescription>
            The terminal snapshot is fetched through the app, then you can confirm it as the guard photo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Source Terminal</p>
              {selectedTerminal ? (
                <Badge variant="outline">{selectedTerminal.activation_status || "unknown"}</Badge>
              ) : null}
            </div>
            <Select
              value={selectedTerminalId}
              onValueChange={(value) => {
                setSelectedTerminalId(value);
                setCapturedFile(null);
              }}
              disabled={terminals.length === 0}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a terminal" />
              </SelectTrigger>
              <SelectContent>
                {terminals.map((terminal) => (
                  <SelectItem key={terminal.id} value={terminal.id}>
                    {terminalLabel(terminal)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {terminals.length === 0 ? (
              <p className="text-xs text-muted-foreground">Register a terminal before using the camera capture flow.</p>
            ) : null}
          </div>

          {selectedTerminal ? (
            <TerminalSnapshotCard
              terminal={selectedTerminal}
              title="Camera Preview"
              description="Refresh the terminal snapshot, then capture the current frame."
              captureLabel="Take Snapshot"
              onCapture={(file) => {
                setCapturedFile(file);
              }}
            />
          ) : (
            <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/20 text-sm text-muted-foreground">
              <div className="space-y-2 text-center">
                <Camera className="mx-auto h-8 w-8 opacity-30" />
                <p>Select a terminal to start the live preview.</p>
              </div>
            </div>
          )}

          {capturedFile ? (
            <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Captured frame</p>
                  <p className="text-xs text-muted-foreground">{capturedFile.name}</p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setCapturedFile(null)}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Retake
                </Button>
              </div>
              {capturedPreviewUrl ? (
                <img
                  src={capturedPreviewUrl}
                  alt="Captured guard frame"
                  className="max-h-72 w-full rounded-lg border object-cover"
                />
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Capture a snapshot from the terminal, then confirm it to use for the guard registration.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!capturedFile || !selectedTerminal}
            onClick={() => {
              if (!capturedFile || !selectedTerminal) return;
              onUsePhoto(capturedFile, selectedTerminal);
            }}>
            <Check className="mr-2 h-4 w-4" />
            Use This Photo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
