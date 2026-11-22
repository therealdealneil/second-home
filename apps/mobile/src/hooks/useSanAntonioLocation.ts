import {
  clampLocalAdjustment,
  haversineDistanceMeters,
  inferSanAntonioNeighborhood,
  validateCapturedGpsFix,
  type ConfirmedNeighborhood,
  type LatLng,
} from "@second-home/shared";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useCallback, useEffect, useRef, useState } from "react";

export type LocationCaptureStatus =
  "idle" | "locating" | "snapped" | "permission_denied" | "mock_gps" | "error";

type UseSanAntonioLocationOptions = {
  existingNeighborhood: ConfirmedNeighborhood | null;
  onSnapped: (neighborhood: ConfirmedNeighborhood) => void;
  onOutsideSanAntonio: () => void;
};

type LocationHookState = {
  status: LocationCaptureStatus;
  explicitIdle: boolean;
  anchor: LatLng | null;
  candidate: ConfirmedNeighborhood | null;
  offsetMiles: number | null;
  errorMessage: string | null;
};

const INITIAL_STATE: LocationHookState = {
  status: "idle",
  explicitIdle: false,
  anchor: null,
  candidate: null,
  offsetMiles: null,
  errorMessage: null,
};

export function useSanAntonioLocation({
  existingNeighborhood,
  onSnapped,
  onOutsideSanAntonio,
}: UseSanAntonioLocationOptions) {
  const [hookState, setHookState] = useState<LocationHookState>(INITIAL_STATE);
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, []);

  const canFallbackToExisting = !hookState.explicitIdle && existingNeighborhood !== null;
  const effectiveAnchor =
    hookState.anchor ?? (canFallbackToExisting ? existingNeighborhood.fuzzedCenter : null);
  const effectiveCandidate =
    hookState.candidate ?? (canFallbackToExisting ? existingNeighborhood : null);
  const effectiveStatus: LocationCaptureStatus =
    hookState.status === "idle" && canFallbackToExisting ? "snapped" : hookState.status;

  const anchorRef = useRef<LatLng | null>(effectiveAnchor);
  useEffect(() => {
    anchorRef.current = effectiveAnchor;
  }, [effectiveAnchor]);

  const processRawFix = useCallback(
    (input: { lat: number; lng: number; mocked?: boolean }) => {
      const validation = validateCapturedGpsFix(input);
      if (!validation.ok) {
        if (validation.reason === "mock_gps") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setHookState({
            status: "mock_gps",
            explicitIdle: true,
            anchor: null,
            candidate: null,
            offsetMiles: null,
            errorMessage:
              "Mock GPS providers are blocked. Please disable location spoofing apps and try again.",
          });
          return;
        }
        if (validation.reason === "outside_san_antonio") {
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          setHookState({
            ...INITIAL_STATE,
            explicitIdle: true,
          });
          onOutsideSanAntonio();
          return;
        }
        setHookState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: "Unable to verify GPS coordinates. Please try again.",
        }));
        return;
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setHookState({
        status: "snapped",
        explicitIdle: false,
        anchor: validation.neighborhood.fuzzedCenter,
        candidate: validation.neighborhood,
        offsetMiles: validation.offsetMiles,
        errorMessage: null,
      });
      onSnapped(validation.neighborhood);
    },
    [onOutsideSanAntonio, onSnapped],
  );

  const captureHardwareGps = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setHookState((prev) => ({
      ...prev,
      status: "locating",
      explicitIdle: false,
      errorMessage: null,
    }));

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (requestId !== requestIdRef.current) {
        return;
      }
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setHookState((prev) => ({
          ...prev,
          status: "permission_denied",
          errorMessage:
            "Location permission is needed to place your ~1 mi privacy pin in San Antonio. Your exact address is never shared.",
        }));
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (requestId !== requestIdRef.current) {
        return;
      }

      processRawFix({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        mocked: position.mocked,
      });
    } catch {
      if (requestId !== requestIdRef.current) {
        return;
      }
      setHookState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: "Could not obtain a GPS fix right now. Ensure location services are on.",
      }));
    }
  }, [processRawFix]);

  const adjustCandidateCenter = useCallback(
    (mapCenter: LatLng) => {
      const anchor = anchorRef.current;
      if (!anchor) {
        return;
      }
      const clamped = clampLocalAdjustment(anchor, mapCenter);
      const nextCandidate: ConfirmedNeighborhood = {
        label: inferSanAntonioNeighborhood(clamped),
        fuzzedCenter: clamped,
      };
      setHookState((prev) => ({
        ...prev,
        status: "snapped",
        explicitIdle: false,
        anchor,
        candidate: nextCandidate,
      }));
      if (haversineDistanceMeters(clamped, mapCenter) > 10) {
        onSnapped(nextCandidate);
      }
    },
    [onSnapped],
  );

  const recenterToAnchor = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) {
      return;
    }
    const restored: ConfirmedNeighborhood = {
      label: inferSanAntonioNeighborhood(anchor),
      fuzzedCenter: anchor,
    };
    setHookState((prev) => ({
      ...prev,
      status: "snapped",
      explicitIdle: false,
      anchor,
      candidate: restored,
    }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSnapped(restored);
  }, [onSnapped]);

  const resetLocationCapture = useCallback(() => {
    requestIdRef.current += 1;
    setHookState({
      ...INITIAL_STATE,
      explicitIdle: true,
    });
  }, []);

  const simulateGpsFix = useCallback(
    (rawPoint: LatLng) => {
      if (!__DEV__) {
        return;
      }
      requestIdRef.current += 1;
      processRawFix({ lat: rawPoint.lat, lng: rawPoint.lng, mocked: false });
    },
    [processRawFix],
  );

  return {
    status: effectiveStatus,
    anchor: effectiveAnchor,
    candidate: effectiveCandidate,
    offsetMiles: hookState.offsetMiles,
    errorMessage: hookState.errorMessage,
    captureHardwareGps,
    adjustCandidateCenter,
    recenterToAnchor,
    resetLocationCapture,
    simulateGpsFix,
  };
}
