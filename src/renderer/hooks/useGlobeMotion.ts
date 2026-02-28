import type {
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clamp, isInteractivePointerTarget } from '../utils/gallery';

type GlobeMotionOptions = {
  enabled: boolean;
  syncToken: unknown;
  onRender: (rotationDeg: number, zoomDepth: number) => void;
  dragRotationPerPixel: number;
  zoomMin: number;
  zoomMax: number;
  zoomPerWheel: number;
  resetOnDisable?: boolean;
};

type GlobeMotionBindings = {
  isDragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLElement>) => void;
  consumeDragClick: () => boolean;
};

export default function useGlobeMotion({
  enabled,
  syncToken,
  onRender,
  dragRotationPerPixel,
  zoomMin,
  zoomMax,
  zoomPerWheel,
  resetOnDisable = false,
}: GlobeMotionOptions): GlobeMotionBindings {
  const [isDragging, setIsDragging] = useState(false);
  const motion = useRef({
    dragging: false,
    pointerId: -1,
    lastX: 0,
    lastPointerTime: 0,
    lastFrameTime: 0,
    position: 0,
    target: 0,
    velocity: 0,
    zoom: 0,
    zoomTarget: 0,
    didDragSincePointerDown: false,
    rafId: 0,
  });

  const runFrame = useCallback(
    (timestamp: number) => {
      const currentMotion = motion.current;

      if (currentMotion.lastFrameTime === 0) {
        currentMotion.lastFrameTime = timestamp;
      }

      const elapsed = clamp(timestamp - currentMotion.lastFrameTime, 8, 34);
      currentMotion.lastFrameTime = timestamp;
      const frameFactor = elapsed / 16.667;

      if (!currentMotion.dragging) {
        currentMotion.target += currentMotion.velocity * elapsed;
        currentMotion.velocity *= 0.9 ** frameFactor;
      }

      const zoomFollow = 1 - 0.2 ** frameFactor;
      currentMotion.zoom +=
        (currentMotion.zoomTarget - currentMotion.zoom) * zoomFollow;

      const rotationFollow = 1 - 0.2 ** frameFactor;
      currentMotion.position +=
        (currentMotion.target - currentMotion.position) * rotationFollow;

      if (Math.abs(currentMotion.position) > 1080) {
        const turns = Math.trunc(currentMotion.position / 360);
        const normalizedOffset = turns * 360;
        currentMotion.position -= normalizedOffset;
        currentMotion.target -= normalizedOffset;
      }

      onRender(currentMotion.position, currentMotion.zoom);

      const shouldContinue =
        currentMotion.dragging ||
        Math.abs(currentMotion.target - currentMotion.position) > 0.04 ||
        Math.abs(currentMotion.velocity) > 0.002 ||
        Math.abs(currentMotion.zoomTarget - currentMotion.zoom) > 0.08;

      if (shouldContinue) {
        currentMotion.rafId = window.requestAnimationFrame(runFrame);
        return;
      }

      currentMotion.target = currentMotion.position;
      currentMotion.zoom = currentMotion.zoomTarget;
      currentMotion.velocity = 0;
      currentMotion.lastFrameTime = 0;
      currentMotion.rafId = 0;
      onRender(currentMotion.position, currentMotion.zoom);
    },
    [onRender],
  );

  const startAnimation = useCallback(() => {
    const currentMotion = motion.current;

    if (currentMotion.rafId !== 0) {
      return;
    }

    currentMotion.rafId = window.requestAnimationFrame(runFrame);
  }, [runFrame]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      if (isInteractivePointerTarget(event.target)) {
        return;
      }

      const currentMotion = motion.current;
      currentMotion.dragging = true;
      currentMotion.pointerId = event.pointerId;
      currentMotion.lastX = event.clientX;
      currentMotion.lastPointerTime = event.timeStamp;
      currentMotion.velocity = 0;
      currentMotion.didDragSincePointerDown = false;
      setIsDragging(true);
      event.currentTarget.setPointerCapture(event.pointerId);
      startAnimation();
    },
    [enabled, startAnimation],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }

      const currentMotion = motion.current;

      if (
        !currentMotion.dragging ||
        currentMotion.pointerId !== event.pointerId
      ) {
        return;
      }

      const deltaX = event.clientX - currentMotion.lastX;
      const elapsedPointer = clamp(
        event.timeStamp - currentMotion.lastPointerTime,
        8,
        42,
      );
      const deltaRotation = deltaX * dragRotationPerPixel;

      currentMotion.lastX = event.clientX;
      currentMotion.lastPointerTime = event.timeStamp;
      currentMotion.target += deltaRotation;
      currentMotion.velocity = deltaRotation / elapsedPointer;

      if (Math.abs(deltaX) > 2) {
        currentMotion.didDragSincePointerDown = true;
      }

      startAnimation();
    },
    [dragRotationPerPixel, enabled, startAnimation],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }

      const currentMotion = motion.current;

      if (currentMotion.pointerId !== event.pointerId) {
        return;
      }

      currentMotion.dragging = false;
      currentMotion.pointerId = -1;
      setIsDragging(false);
      startAnimation();

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [enabled, startAnimation],
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<HTMLElement>) => {
      if (!enabled) {
        return;
      }

      event.preventDefault();
      const currentMotion = motion.current;
      currentMotion.zoomTarget = clamp(
        currentMotion.zoomTarget - event.deltaY * zoomPerWheel,
        zoomMin,
        zoomMax,
      );
      startAnimation();
    },
    [enabled, startAnimation, zoomMax, zoomMin, zoomPerWheel],
  );

  const consumeDragClick = useCallback(() => {
    const currentMotion = motion.current;

    if (!currentMotion.didDragSincePointerDown) {
      return false;
    }

    currentMotion.didDragSincePointerDown = false;
    return true;
  }, []);

  useEffect(() => {
    let rafId = 0;

    if (!enabled) {
      const currentMotion = motion.current;
      currentMotion.dragging = false;
      currentMotion.pointerId = -1;
      setIsDragging(false);

      if (currentMotion.rafId !== 0) {
        window.cancelAnimationFrame(currentMotion.rafId);
        currentMotion.rafId = 0;
      }

      if (resetOnDisable) {
        currentMotion.lastX = 0;
        currentMotion.lastPointerTime = 0;
        currentMotion.lastFrameTime = 0;
        currentMotion.position = 0;
        currentMotion.target = 0;
        currentMotion.velocity = 0;
        currentMotion.zoom = 0;
        currentMotion.zoomTarget = 0;
        currentMotion.didDragSincePointerDown = false;
        onRender(0, 0);
      }
    } else {
      rafId = window.requestAnimationFrame(() => {
        const currentMotion = motion.current;
        onRender(currentMotion.position, currentMotion.zoom);
      });
    }

    return () => {
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [enabled, onRender, resetOnDisable, syncToken]);

  useEffect(() => {
    const currentMotion = motion.current;

    return () => {
      if (currentMotion.rafId !== 0) {
        window.cancelAnimationFrame(currentMotion.rafId);
      }
    };
  }, []);

  return {
    isDragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onWheel,
    consumeDragClick,
  };
}
