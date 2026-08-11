import argparse
import math
import sys

def write_obj(filename, vertices, faces):
    with open(filename, 'w') as f:
        for v in vertices:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for face in faces:
            if len(face) == 3:
                f.write(f"f {face[0]+1} {face[1]+1} {face[2]+1}\n")
            else:
                f.write(f"f {' '.join(str(i+1) for i in face)}\n")

def cube(size):
    s = size / 2
    v = [
        (-s,-s,-s), ( s,-s,-s), ( s, s,-s), (-s, s,-s),
        (-s,-s, s), ( s,-s, s), ( s, s, s), (-s, s, s)
    ]
    f = [
        (0,1,2), (0,2,3),
        (4,5,6), (4,6,7),
        (0,1,5), (0,5,4),
        (2,3,7), (2,7,6),
        (0,3,7), (0,7,4),
        (1,2,6), (1,6,5)
    ]
    return v, f

def sphere(radius, segments=16):
    verts = []
    faces = []
    for i in range(segments+1):
        theta = i * math.pi / segments
        for j in range(segments+1):
            phi = j * 2 * math.pi / segments
            x = radius * math.sin(theta) * math.cos(phi)
            y = radius * math.cos(theta)
            z = radius * math.sin(theta) * math.sin(phi)
            verts.append((x,y,z))
    for i in range(segments):
        for j in range(segments):
            a = i * (segments+1) + j
            b = a + 1
            c = (i+1) * (segments+1) + j
            d = c + 1
            faces.append((a,b,d))
            faces.append((a,d,c))
    return verts, faces

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--type", default="cube", choices=["cube","sphere"])
    p.add_argument("--size", type=float, default=1.0)
    p.add_argument("--segments", type=int, default=16)
    p.add_argument("--output", default="model.obj")
    args = p.parse_args()
    if args.type == "cube":
        v,f = cube(args.size)
    elif args.type == "sphere":
        v,f = sphere(args.size, args.segments)
    else:
        print("Unsupported", file=sys.stderr)
        sys.exit(1)
    write_obj(args.output, v, f)
    print(f"Generated {args.output} with {len(v)} vertices and {len(f)} faces")

if __name__ == "__main__":
    main()
