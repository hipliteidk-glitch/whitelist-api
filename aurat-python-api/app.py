from flask import Flask, request, jsonify
from PIL import Image
import numpy as np, os
app = Flask(__name__)
ZONES = {
 "head": (0.30,0.05,0.40,0.20),
 "neck": (0.35,0.25,0.30,0.10),
 "torso": (0.25,0.35,0.50,0.25),
 "arms": (0.00,0.35,0.20,0.35),
 "legs": (0.25,0.60,0.50,0.35),
}
THRESHOLD = 0.12
def is_skin(rgb):
 r,g,b = rgb
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
 pixels = np.array(roi).reshape(-1,3)
 skin = 0
 for p in pixels:
  if is_skin(p):
   skin += 1
 return skin / len(pixels)
def scan_image(p):
 img = Image.open(p).convert('RGB')
 w,h = img.size
 res = {}
 for n, (xr,yr,wr,hr) in ZONES.items():
  x = int(xr*w)
  y = int(yr*h)
  xw = int(wr*w)
  yh = int(hr*h)
  roi = img.crop((x,y,x+xw,y+yh))
  ratio = skin_ratio(roi)
  res[n] = {"ratio": round(ratio,3), "status": "covered" if ratio < THRESHOLD else "exposed"}
 return res
with open('index.html','r') as f:
 HTML_PAGE = f.read()
@app.route('/')
def index():
 return HTML_PAGE
@app.route('/realtime')
def realtime():
 return HTML_PAGE
@app.route('/health')
def health():
 return jsonify({"status":"online"})
@app.route('/scan', methods=['POST'])
def scan():
 if 'image' not in request.files:
  return jsonify({"error":"No image file"}),400
 f = request.files['image']
 if f.filename == '':
  return jsonify({"error":"Empty filename"}),400
 p = '/tmp/upload.jpg'
 f.save(p)
 return jsonify(scan_image(p))
if __name__ == '__main__':
 app.run(host='0.0.0.0', port=int(os.environ.get('PORT',5000)))
