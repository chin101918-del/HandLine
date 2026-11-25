/**
 * Apple Pencil Palm Rejection & Input Protection Layer
 *
 * Platform Note:
 * JavaScript cannot directly control iPadOS hardware-level palm rejection.
 * This module works as a software-level protection layer on top of native iPadOS
 * palm rejection by filtering Pointer Events via pointerType, pointerId,
 * contact dimensions (width/height), multi-pointer concurrency, and micro-tap
 * dot suppression, while preserving Apple Pencil pressure, tiltX, and tiltY.
 */

export type InputMode = 'pencil_only' | 'finger_drawing';

export interface PointerLikeEvent {
  pointerId: number;
  pointerType: string; // 'pen' | 'touch' | 'mouse' | ''
  clientX: number;
  clientY: number;
  width?: number;
  height?: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  isPrimary?: boolean;
  timeStamp?: number;
}

export interface InputProtectionOptions {
  mode: InputMode;
  maxTouchContactPx?: number; // contacts wider than this are treated as palm
  minTouchTravelPx?: number; // minimum movement before committing a touch dot
  penCooldownMs?: number; // suppress stray touch contacts right after pen lift
}

export class PointerInputGuard {
  private mode: InputMode;
  private maxTouchContactPx: number;
  private minTouchTravelPx: number;
  private penCooldownMs: number;

  private activePointerId: number | null = null;
  private activePointerType: string | null = null;
  private lastPenTimestamp = 0;
  private pendingTouchStart: { x: number; y: number; time: number } | null = null;
  private touchCommitted = false;

  constructor(opts: InputProtectionOptions) {
    this.mode = opts.mode;
    this.maxTouchContactPx = opts.maxTouchContactPx ?? 24;
    this.minTouchTravelPx = opts.minTouchTravelPx ?? 2.2;
    this.penCooldownMs = opts.penCooldownMs ?? 450;
  }

  setMode(mode: InputMode) {
    this.mode = mode;
    this.reset();
  }

  getMode(): InputMode {
    return this.mode;
  }

  reset() {
    this.activePointerId = null;
    this.activePointerType = null;
    this.pendingTouchStart = null;
    this.touchCommitted = false;
  }

  private isPalmSizedTouch(e: PointerLikeEvent): boolean {
    const w = e.width ?? 1;
    const h = e.height ?? 1;
    return Math.max(w, h) >= this.maxTouchContactPx;
  }

  /**
   * Evaluates pointerdown. Returns 'accept', 'defer_touch' (wait for movement so
   * accidental palm/finger taps don't leave dots), or 'reject'.
   */
  onPointerDown(e: PointerLikeEvent): 'accept' | 'defer_touch' | 'reject' {
    const now = e.timeStamp ?? Date.now();
    const pType = e.pointerType || 'mouse';

    // Always allow Apple Pencil / stylus; preempt any stray touch
    if (pType === 'pen') {
      this.activePointerId = e.pointerId;
      this.activePointerType = 'pen';
      this.lastPenTimestamp = now;
      this.pendingTouchStart = null;
      this.touchCommitted = true;
      return 'accept';
    }

    // Desktop mouse / trackpad always accepted when no pen is active
    if (pType === 'mouse') {
      if (this.activePointerId !== null && this.activePointerType === 'pen') {
        return 'reject';
      }
      this.activePointerId = e.pointerId;
      this.activePointerType = 'mouse';
      this.touchCommitted = true;
      return 'accept';
    }

    // Touch handling
    if (pType === 'touch') {
      if (this.mode === 'pencil_only') {
        return 'reject';
      }
      // Reject simultaneous touch while another pointer or pen is active
      if (this.activePointerId !== null) {
        return 'reject';
      }
      // Reject stray touch immediately after lifting Apple Pencil
      if (this.lastPenTimestamp > 0 && now - this.lastPenTimestamp < this.penCooldownMs) {
        return 'reject';
      }
      // Reject wide palm-sized touch contacts
      if (this.isPalmSizedTouch(e)) {
        return 'reject';
      }
      // Defer committing a touch stroke until it moves past minTouchTravelPx
      this.activePointerId = e.pointerId;
      this.activePointerType = 'touch';
      this.pendingTouchStart = { x: e.clientX, y: e.clientY, time: now };
      this.touchCommitted = false;
      return 'defer_touch';
    }

    return 'reject';
  }

  onPointerMove(e: PointerLikeEvent): 'accept' | 'commit_deferred' | 'reject' {
    if (this.activePointerId !== e.pointerId) {
      return 'reject';
    }
    if (this.activePointerType === 'pen') {
      this.lastPenTimestamp = e.timeStamp ?? Date.now();
      return 'accept';
    }
    if (this.activePointerType === 'touch') {
      if (this.isPalmSizedTouch(e)) {
        this.reset();
        return 'reject';
      }
      if (!this.touchCommitted && this.pendingTouchStart) {
        const dist = Math.hypot(
          e.clientX - this.pendingTouchStart.x,
          e.clientY - this.pendingTouchStart.y
        );
        if (dist < this.minTouchTravelPx) {
          return 'reject';
        }
        this.touchCommitted = true;
        return 'commit_deferred';
      }
    }
    return 'accept';
  }

  onPointerEndOrCancel(e: PointerLikeEvent): boolean {
    if (this.activePointerId !== e.pointerId) {
      return false;
    }
    const wasCommitted = this.touchCommitted;
    if (this.activePointerType === 'pen') {
      this.lastPenTimestamp = e.timeStamp ?? Date.now();
    }
    this.reset();
    return wasCommitted;
  }
}
