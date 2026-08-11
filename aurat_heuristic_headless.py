import cv2
import numpy as np
import sys

# ─── Zone definitions (relative to frame size) ───
ZONES = {
    "head":   (0.30, 0.05, 0.40, 0.20),
    "neck":   (0.35, 0.25, 0.30, 0.10),
    "torso":  (0.25, 0.35, 0.50, 0.25),
    "arms":   (0.00, 0.35, 0.20, 0.35),  # left arm; right will be mirrored
    "legs":   (0.25, 0.60, 0.50, 0.35),
}
THRESHOLD = 0.12  # skin ratio above this = "exposed"

def is_skin(bgr):
    """Simple BGR skin detection."""
    b, g, r = bgr
    if r < 60 or g < 40 or b < 20:
        return False
    if r <= g or g <= b:
        return False
    if r > 250 or g > 200 or b > 170:
        return False
    return True

def skin_ratio(roi):
    if roi.size == 0:
        return 0.0
    skin_pixels = 0
    for row in roi:
        for bgr in row:
            if is_skin(bgr):
                skin_pixels += 1
    return skin_pixels / roi.size

def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("❌ Cannot open webcam (camera 0).")
        sys.exit(1)

    ret, frame = cap.read()
    if not ret:
        print("❌ Failed to capture frame.")
        cap.release()
        sys.exit(1)

    cap.release()

    # Mirror horizontally
    frame = cv2.flip(frame, 1)
    h, w = frame.shape[:2]

    results = {}
    annotated = frame.copy()

    for name, (xr, yr, wr, hr) in ZONES.items():
        x = int(xr * w)
        y = int(yr * h)
        xw = int(wr * w)
        yh = int(hr * h)
        roi = frame[y:y+yh, x:x+xw]
        ratio = skin_ratio(roi)
        status = "covered" if ratio < THRESHOLD else "exposed"
        results[name] = (ratio, status)

        # Draw rectangle
        color = (0, 255, 0) if ratio < THRESHOLD else (0, 0, 255)
        cv2.rectangle(annotated, (x, y), (x+xw, y+yh), color, 2)
        cv2.putText(annotated, f"{name}: {ratio:.2f}", (x, y-5),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255,255,255), 1)

    # Summary
    summary = ", ".join([f"{k}={v[1]}({v[0]:.2f})" for k, v in results.items()])
    print("🕌 Aurat Heuristic Results:")
    print(summary)

    # Save annotated image
    cv2.imwrite("aurat_scan_result.jpg", annotated)
    print("📸 Annotated image saved as 'aurat_scan_result.jpg'.")

if __name__ == "__main__":
    main()
