# The plan (JSON)
```
{
  "title": "short name of the scene (2-6 words)",
  "seconds": 5,                      // how long the run lasts, 0.5-20: long enough for the whole story to finish, plus about 1 s
  "release": 0.5,                    // optional: when held items let go (s), default 0.5
  "items": [                         // everything in the scene except the table (it is always there, id "table")
    {
      "id": "ramp",                  // unique, short, lowercase: letters, digits, - or _ (not "table" or "air")
      "type": "plank",               // a catalog key, exactly
      "name": "Ramp",                // what the user would call it
      "props": {"length": 0.8},      // only props listed for that type, inside their ranges; leave out what stays at its default
      "place": {"on": "air", "lean": {"from": {"on": "air", "x": 0.0, "y": 0.4}, "to": {"on": "table", "x": 0.7}}},
      "held": false, "fixed": false,  // optional (dynamic items only)
      "why": "what it is for, in a few words (and what it stands in for, when it is a substitute)"
    }
  ],
  "missing": [                       // EVERY requested thing the catalog does not have (or cannot do), honestly; [] if none
    {"asked": "a dog", "reason": "there are no animals in the library", "substitute_type": null, "substitute_id": null}
  ],
  "goals": [                         // only when the request states an outcome that can be checked; [] otherwise
    {"label": "The ball lands in the bucket", "item": "ball", "container": "bucket"}   // container: a box, cup, bucket or basket item
  ],
  "tune": [                          // knobs a tuner may turn to make the goals happen (1-4 is typical; [] without goals)
    {"id": "bucket", "param": "x", "min": 1.4, "max": 2.4}                             // param: "x", "y", "angle" or a number prop of that item
  ],
  "notes": "one or two sentences: how the scene works and anything the user should know",
  "assumptions": ["choices you made that the request did not settle"]
}
```
Optional, only when the request needs it: `"table": {"props": {"width": 5, "material": "steel"}}` (the table's own props) and `"stage": {"x0": ..., "x1": ..., "y0": ..., "y1": ...}` (a bigger or smaller frame, in metres).
