"""The tuned Rube Goldberg machine (rube.py's defaults) as a scene of catalog items, part for part."""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rube  # noqa: E402

D2R = math.pi / 180


def rg_scene(params=None):
    doc, P = rube.build(params or {})
    S = {s["id"]: s for s in doc["solids"]}
    deg = lambda s: s.get("angle", 0.0) / D2R
    ball_key = {"rubber": "superball", "plastic": "plastic-ball", "clay": "clay-ball"}[P["ball_type"]]
    seesaw = S["seesaw"]
    items = [
        {"id": "table", "type": "table", "name": "Table", "x": S["floor"]["at"]["x"], "y": 0.0, "props": {"width": 3.7, "thickness": 0.15}},
        {"id": "wall-left", "type": "wall", "name": "Left wall", "x": S["wall-left"]["at"]["x"], "y": 0.0, "props": {"invisible_in_3d": True}},
        {"id": "wall-right", "type": "wall", "name": "Right wall", "x": S["wall-right"]["at"]["x"], "y": 0.0, "props": {"invisible_in_3d": True}},
        {"id": "ramp1", "type": "plank", "name": "Ramp 1", "x": S["ramp1"]["at"]["x"], "y": S["ramp1"]["at"]["y"], "angle": deg(S["ramp1"]),
         "props": {"length": S["ramp1"]["body"]["width"]}},
        {"id": "ramp2", "type": "plank", "name": "Ramp 2", "x": S["ramp2"]["at"]["x"], "y": S["ramp2"]["at"]["y"], "angle": deg(S["ramp2"]),
         "props": {"length": S["ramp2"]["body"]["width"]}},
        {"id": "dominoes", "type": "domino-row", "name": "Dominoes", "x": S["domino1"]["at"]["x"], "y": 0.0,
         "props": {"count": int(P["dominoes"]), "first_height": P["domino_height"], "growth": P["domino_growth"], "spacing": P["domino_spacing"]}},
        {"id": "seesaw", "type": "seesaw", "name": "Seesaw", "x": P["seesaw_x"], "y": 0.0,
         "props": {"length": P["seesaw_length"], "tilt": P["seesaw_tilt"], "pivot_offset": P["seesaw_pivot"]}},
        {"id": "ball2", "type": "plastic-ball", "name": "Ball 2", "x": S["ball2"]["at"]["x"], "y": S["ball2"]["at"]["y"]},
        {"id": "box", "type": "box", "name": "Box", "x": P["box_x"], "y": P["box_y"], "props": {"width": P["box_width"], "wall": P["box_wall"]}},
        {"id": "ball1", "type": ball_key, "name": "Ball 1", "x": S["ball1"]["at"]["x"], "y": S["ball1"]["at"]["y"], "held": True},
    ]
    ppm = doc["camera"]["pixelsPerMeter"]
    x0, y0 = -doc["camera"]["pixel"]["x"] / ppm, -(1024 - doc["camera"]["pixel"]["y"]) / ppm
    return {"version": 2, "id": "rube-goldberg", "name": "Rube Goldberg machine", "seconds": P["seconds"], "release": 0.5,
            "stage": {"x0": x0, "x1": x0 + 1536 / ppm, "y0": y0, "y1": y0 + 1024 / ppm}, "items": items,
            "goals": [{"kind": "in", "item": "ball2", "container": "box", "label": "Ball 2 lands in the box"}]}


if __name__ == "__main__":
    json.dump(rg_scene(), open(sys.argv[1], "w"), indent=1) if len(sys.argv) > 1 else print(json.dumps(rg_scene(), indent=1))
