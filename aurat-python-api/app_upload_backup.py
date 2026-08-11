from flask import Flask, request, jsonify, render_template_string
from PIL import Image
import numpy as np
import os

app = Flask(__name__)

ZONES = {
    "head":   (0.30, 0.05, 0.40, 0.20),
    "neck":   (0.35, 0.25, 0.30, 0.10),
    "torso":  (0.25, 0.35, 0.50, 0.25),
    "arms":   (0.00, 0.35, 0.20, 0.35),
    "legs":   (0.25, 0.60, 0.50, 0.35),
}
THRESHOLD = 0.12

def is_skin(rgb):
    r, g, b = rgb
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
    pixels = np.array(roi).reshape(-1, 3)
    skin = sum(1 for p in pixels if is_skin(p))
    return skin / len(pixels)

def scan_image(image_path):
    img = Image.open(image_path).convert('RGB')
    w, h = img.size
    results = {}
    for name, (xr, yr, wr, hr) in ZONES.items():
        x = int(xr * w)
        y = int(yr * h)
        xw = int(wr * w)
        yh = int(hr * h)
        roi = img.crop((x, y, x+xw, y+yh))
        ratio = skin_ratio(roi)
        status = "covered" if ratio < THRESHOLD else "exposed"
        results[name] = {"ratio": round(ratio, 3), "status": status}
    return results

HTML = '''
<!doctype html>
<html>
<head><title>Aurat Scanner</title></head>
<body>
<h2>Upload an image to scan</h2>
<form method="post" enctype="multipart/form-data" action="/scan">
  <input type="file" name="image" accept="image/*">
  <input type="submit" value="Scan">
</form>
</body>
</html>
'''

@app.route('/')
def index():
    return render_template_string(HTML)

@app.route('/scan', methods=['POST'])
def scan():
    if 'image' not in request.files:
        return jsonify({"error": "No image file"}), 400
    file = request.files['image']
    if file.filename == '':
        return jsonify({"error": "Empty filename"}), 400
    temp_path = "/tmp/upload.jpg"
    file.save(temp_path)
    results = scan_image(temp_path)
    if results is None:
        return jsonify({"error": "Invalid image"}), 400
    return jsonify(results)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
